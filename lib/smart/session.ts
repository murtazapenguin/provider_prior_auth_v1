/**
 * lib/smart/session.ts
 *
 * Server-side SmartSession storage + retrieval.
 *
 *  createSmartSession  — called from the callback handler after a successful
 *                        token exchange. Encrypts tokens, writes a row,
 *                        returns the opaque sessionToken for the cookie.
 *
 *  getCurrentSession   — called from any authenticated Node-runtime path
 *                        (API routes, server components). Reads the
 *                        signed cookie, looks up the row, decrypts tokens.
 *                        Returns plaintext access/refresh tokens to the
 *                        caller — caller MUST NOT serialize them across
 *                        an API or audit boundary.
 *
 *  refreshSession      — calls Epic's refresh_token grant, rotates the
 *                        encrypted tokens in place, returns the refreshed
 *                        session data. On refresh failure, revokes the
 *                        session so the next /getCurrentSession returns null.
 *
 *  revokeSession       — sets revokedAt on the row. Used by the refresh
 *                        endpoint on failure and by sign-out paths.
 */

import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db/client'
import { decryptNullable, encrypt, encryptNullable } from './crypto'
import { getSmartConfiguration } from './discovery'
import { refreshTokens } from './tokenExchange'
import {
  SESSION_COOKIE_NAME,
  signSessionCookie,
  verifySessionCookie,
} from './sessionCookie'
import {
  MissingEpicConfigError,
  SmartLaunchError,
  type SmartSessionData,
  type TokenResponse,
} from './types'

/** 32-byte url-safe random session token (the lookup key). */
export function generateSessionToken(): string {
  return randomBytes(32)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export interface CreateSmartSessionOpts {
  iss: string
  tokenResponse: TokenResponse
  fhirUser: string
}

export interface CreateSmartSessionResult {
  id: string
  sessionToken: string
  expiresAt: Date
}

/**
 * Persist a SmartSession row with encrypted tokens and return the opaque
 * sessionToken (caller signs it into the response cookie).
 *
 * Granted scope (not requested) is persisted — Epic echoes a subset.
 */
export async function createSmartSession(
  opts: CreateSmartSessionOpts,
): Promise<CreateSmartSessionResult> {
  const sessionToken = generateSessionToken()
  const expiresAt = new Date(Date.now() + opts.tokenResponse.expires_in * 1000)

  const row = await prisma.smartSession.create({
    data: {
      sessionToken,
      iss: opts.iss,
      accessTokenEnc: encrypt(opts.tokenResponse.access_token),
      refreshTokenEnc: encryptNullable(opts.tokenResponse.refresh_token ?? null),
      idTokenEnc: encryptNullable(opts.tokenResponse.id_token ?? null),
      expiresAt,
      fhirUser: opts.fhirUser,
      patientContext: opts.tokenResponse.patient ?? null,
      encounterContext: opts.tokenResponse.encounter ?? null,
      scope: opts.tokenResponse.scope,
    },
  })

  return { id: row.id, sessionToken, expiresAt }
}

/**
 * Look up a session row by its sessionToken. Returns null on missing or
 * revoked. Decrypts tokens — tokens are returned as plaintext for the
 * caller to use with FHIR. Never serialize this struct across an API or
 * audit-log boundary.
 */
export async function getSessionByToken(
  sessionToken: string,
): Promise<SmartSessionData | null> {
  const row = await prisma.smartSession.findUnique({ where: { sessionToken } })
  if (!row) return null
  if (row.revokedAt !== null) return null

  return {
    id: row.id,
    sessionToken: row.sessionToken,
    iss: row.iss,
    accessToken: decryptNullable(row.accessTokenEnc)!,
    refreshToken: decryptNullable(row.refreshTokenEnc),
    idToken: decryptNullable(row.idTokenEnc),
    expiresAt: row.expiresAt,
    fhirUser: row.fhirUser,
    patientContext: row.patientContext,
    encounterContext: row.encounterContext,
    scope: row.scope,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  }
}

/**
 * Read the current request's SmartSession via the signed cookie.
 * Returns null when:
 *   - the cookie is absent
 *   - the cookie HMAC is invalid or expired
 *   - the row was deleted/revoked
 */
export async function getCurrentSession(): Promise<SmartSessionData | null> {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(SESSION_COOKIE_NAME)?.value
  const payload = await verifySessionCookie(cookieValue)
  if (!payload) return null
  return getSessionByToken(payload.sessionToken)
}

/**
 * Mark a session revoked.
 */
export async function revokeSession(sessionToken: string): Promise<void> {
  await prisma.smartSession.updateMany({
    where: { sessionToken, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

/**
 * Mark `lastUsedAt = now`. Best-effort — failures don't block the request.
 */
export async function touchLastUsed(sessionToken: string): Promise<void> {
  try {
    await prisma.smartSession.update({
      where: { sessionToken },
      data: { lastUsedAt: new Date() },
    })
  } catch {
    // Non-fatal: lastUsedAt is observability only.
  }
}

/**
 * Look up the current session and refresh its tokens against Epic.
 *
 * On success: rotates encrypted tokens in the DB row, returns the refreshed
 * SmartSessionData.
 *
 * On failure (refresh token revoked, Epic 5xx, etc.): revokes the session
 * row and returns null. The caller's job is to clear the cookie and redirect
 * the user.
 */
export async function refreshSession(
  sessionToken: string,
): Promise<SmartSessionData | null> {
  const existing = await getSessionByToken(sessionToken)
  if (!existing || !existing.refreshToken) return null

  const clientId = process.env.EPIC_SANDBOX_CLIENT_ID
  if (!clientId) throw new MissingEpicConfigError(['EPIC_SANDBOX_CLIENT_ID'])

  const config = await getSmartConfiguration(existing.iss)

  let refreshed: TokenResponse
  try {
    refreshed = await refreshTokens({
      tokenEndpoint: config.token_endpoint,
      refreshToken: existing.refreshToken,
      clientId,
    })
  } catch (err) {
    // Revoke + bail. Caller clears cookie + redirects.
    await revokeSession(sessionToken)
    if (err instanceof SmartLaunchError) return null
    throw err
  }

  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000)

  await prisma.smartSession.update({
    where: { sessionToken },
    data: {
      accessTokenEnc: encrypt(refreshed.access_token),
      refreshTokenEnc: encryptNullable(refreshed.refresh_token ?? existing.refreshToken),
      idTokenEnc: refreshed.id_token
        ? encryptNullable(refreshed.id_token)
        : existing.idToken
          ? encryptNullable(existing.idToken)
          : null,
      expiresAt: newExpiresAt,
      scope: refreshed.scope,
      lastUsedAt: new Date(),
    },
  })

  return getSessionByToken(sessionToken)
}

/**
 * Mint a fresh signed cookie for an existing sessionToken — used after a
 * refresh so the cookie's `exp` claim matches the new expiresAt.
 */
export async function reissueSessionCookie(sessionToken: string, expiresAtMs: number): Promise<string> {
  return signSessionCookie({ sessionToken, expiresAtMs })
}
