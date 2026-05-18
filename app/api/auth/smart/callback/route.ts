/**
 * app/api/auth/smart/callback/route.ts
 *
 * GET /api/auth/smart/callback?code=<>&state=<>
 *
 * Handles the redirect from Epic. Validates the state cookie, exchanges
 * the code for tokens, persists a SmartSession with encrypted tokens,
 * sets the HMAC-signed session cookie, and redirects the provider to
 * /pa/{id} or /queue.
 *
 * Never logs `code`, `access_token`, `refresh_token`, or `id_token`.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { getSmartConfiguration } from '@/lib/smart/discovery'
import { computePostLaunchDestination } from '@/lib/smart/postLaunchRouting'
import { createSmartSession } from '@/lib/smart/session'
import { signSessionCookie, SESSION_COOKIE_NAME } from '@/lib/smart/sessionCookie'
import { STATE_COOKIE_NAME, consumeStateCookie } from '@/lib/smart/state'
import { exchangeCodeForTokens, verifyIdToken } from '@/lib/smart/tokenExchange'
import {
  MIN_REQUIRED_GRANTED_SCOPES,
  MissingEpicConfigError,
  SmartLaunchError,
} from '@/lib/smart/types'

export const runtime = 'nodejs'

function badRequest(code: string, message: string): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status: 400 },
  )
}

function requireEpicConfig(): { clientId: string; redirectUri: string } {
  const clientId = process.env.EPIC_SANDBOX_CLIENT_ID
  const redirectUri = process.env.EPIC_SANDBOX_REDIRECT_URI
  const missing: string[] = []
  if (!clientId) missing.push('EPIC_SANDBOX_CLIENT_ID')
  if (!redirectUri) missing.push('EPIC_SANDBOX_REDIRECT_URI')
  if (missing.length > 0) throw new MissingEpicConfigError(missing)
  return { clientId: clientId!, redirectUri: redirectUri! }
}

function grantedScopesSatisfy(granted: string): boolean {
  const set = new Set(granted.split(/\s+/).filter(Boolean))
  return MIN_REQUIRED_GRANTED_SCOPES.every((s) => set.has(s))
}

/**
 * Phase 6 T10: consume T9's `computePostLaunchDestination` for the canonical
 * Phase 6 post-launch decision tree (PA-exists-for-encounter → /pa/{id};
 * encounter only → /queue?encounter={id}; patient only → /queue?patient={id};
 * neither → /queue). T1's `redirectAfterAuth` priority is preserved as the
 * first-match override.
 */
async function computeDestination(opts: {
  redirectAfterAuth?: string
  patient?: string
  encounter?: string
}): Promise<string> {
  if (opts.redirectAfterAuth && opts.redirectAfterAuth.startsWith('/')) {
    return opts.redirectAfterAuth
  }
  return computePostLaunchDestination(
    {
      patientContext: opts.patient ?? null,
      encounterContext: opts.encounter ?? null,
    },
    prisma,
  )
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url)
  const errorParam = url.searchParams.get('error')
  if (errorParam) {
    // Epic told us no. Surface error code only — no body, no PHI.
    const dest = new URL('/login', request.url)
    dest.searchParams.set('smart_error', errorParam)
    return NextResponse.redirect(dest)
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code) return badRequest('missing_code', 'OAuth callback missing code parameter')
  if (!state) return badRequest('missing_state', 'OAuth callback missing state parameter')

  // Read the state cookie. Consume validates ttl + nonce.
  const stateCookieValue =
    (request.headers.get('cookie') ?? '')
      .split(/;\s*/)
      .map((c) => c.split('='))
      .find(([k]) => k === STATE_COOKIE_NAME)?.[1]

  const statePayload = consumeStateCookie({
    cookieValue: stateCookieValue,
    nonceFromCallback: state,
  })
  if (!statePayload) {
    return badRequest('state_invalid', 'OAuth state validation failed (CSRF, expiry, or tamper)')
  }

  const { clientId, redirectUri } = requireEpicConfig()

  const config = await getSmartConfiguration(statePayload.iss)

  let tokens
  try {
    tokens = await exchangeCodeForTokens({
      tokenEndpoint: config.token_endpoint,
      code,
      redirectUri,
      clientId,
      codeVerifier: statePayload.codeVerifier,
    })
  } catch (err) {
    if (err instanceof SmartLaunchError) {
      return badRequest('token_exchange_failed', 'Token exchange with Epic failed')
    }
    throw err
  }

  if (!grantedScopesSatisfy(tokens.scope)) {
    return badRequest(
      'scope_missing',
      `Epic granted scopes do not include all required scopes (${MIN_REQUIRED_GRANTED_SCOPES.join(', ')})`,
    )
  }

  // Verify id_token + extract fhirUser claim.
  //
  // Signature verification against Epic's JWKS endpoint is gated by
  // FHIR_MODE === 'real'. Until Epic app registration is complete
  // (tracked in tasks/phase-6-epic-verification.md), id_tokens come from
  // fixture-signed JWTs in tests — we decode-but-don't-verify in those
  // paths. When FHIR_MODE flips to 'real' the JWKS URL from discovery
  // is fed into `jose.createRemoteJWKSet` and signature is enforced.
  const verifySignature = process.env.FHIR_MODE === 'real'
  let fhirUser: string | undefined
  if (tokens.id_token) {
    try {
      const claims = await verifyIdToken(tokens.id_token, {
        audience: clientId,
        issuer: config.issuer,
        jwksUri: verifySignature ? config.jwks_uri : undefined,
      })
      fhirUser = claims.fhirUser ?? claims.profile ?? claims.sub
    } catch (err) {
      if (err instanceof SmartLaunchError) {
        return badRequest('id_token_invalid', 'id_token validation failed')
      }
      throw err
    }
  } else {
    // Some Epic configurations may omit id_token; fall back to the top-level
    // fhirUser convenience field if Epic chose to echo it.
    fhirUser = tokens.fhirUser
  }

  if (!fhirUser) {
    return badRequest(
      'id_token_invalid',
      'Cannot determine fhirUser from token response or id_token',
    )
  }

  const sessionResult = await createSmartSession({
    iss: statePayload.iss,
    tokenResponse: tokens,
    fhirUser,
  })

  const sessionCookieValue = await signSessionCookie({
    sessionToken: sessionResult.sessionToken,
    expiresAtMs: sessionResult.expiresAt.getTime(),
  })

  const destination = await computeDestination({
    redirectAfterAuth: statePayload.redirectAfterAuth,
    patient: tokens.patient,
    encounter: tokens.encounter,
  })

  const response = NextResponse.redirect(new URL(destination, request.url))
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: sessionCookieValue,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: sessionResult.expiresAt,
  })
  // Clear the transient state cookie.
  response.cookies.set({
    name: STATE_COOKIE_NAME,
    value: '',
    path: '/',
    maxAge: 0,
  })
  return response
}
