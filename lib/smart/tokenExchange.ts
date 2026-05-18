/**
 * lib/smart/tokenExchange.ts
 *
 * Token endpoint helpers for the SMART on FHIR PKCE flow.
 *
 * Public-client PKCE: no `client_secret` ever lands in the request body.
 * Wire shape from Epic is validated against `TokenResponseSchema` before
 * being returned to callers.
 */

import { decodeJwt, createRemoteJWKSet, jwtVerify } from 'jose'
import {
  IdTokenClaimsSchema,
  type IdTokenClaims,
  SmartLaunchError,
  TokenResponseSchema,
  type TokenResponse,
} from './types'

export interface ExchangeCodeOpts {
  tokenEndpoint: string
  code: string
  redirectUri: string
  clientId: string
  codeVerifier: string
  // Optional fetch override for tests; defaults to global fetch.
  fetchImpl?: typeof fetch
}

/**
 * Exchange an authorization code for tokens via SMART's PKCE flow.
 * Throws `SmartLaunchError({ code: 'token_exchange_failed' })` on HTTP error
 * or schema mismatch. The thrown error never contains the `code` value.
 */
export async function exchangeCodeForTokens(opts: ExchangeCodeOpts): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    code_verifier: opts.codeVerifier,
  })

  const fetchImpl = opts.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(opts.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    })
  } catch (err) {
    throw new SmartLaunchError({
      code: 'token_exchange_failed',
      message: 'Token endpoint fetch failed',
      details: { cause: err instanceof Error ? err.message : String(err) },
    })
  }

  if (!response.ok) {
    // Body may contain `{ error, error_description }` per OAuth2. We log
    // only the error code, never the body — body could include `code` echo
    // or other sensitive bits in non-conformant servers.
    let errorCode: string | undefined
    try {
      const data = (await response.json()) as { error?: string }
      errorCode = data.error
    } catch {
      // ignore
    }
    throw new SmartLaunchError({
      code: 'token_exchange_failed',
      message: `Token endpoint returned ${response.status}`,
      details: { status: response.status, errorCode },
    })
  }

  let raw: unknown
  try {
    raw = await response.json()
  } catch (err) {
    throw new SmartLaunchError({
      code: 'token_exchange_failed',
      message: 'Token endpoint response was not JSON',
      details: { cause: err instanceof Error ? err.message : String(err) },
    })
  }

  const parsed = TokenResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new SmartLaunchError({
      code: 'token_exchange_failed',
      message: 'Token endpoint response failed schema validation',
      details: { issues: parsed.error.issues },
    })
  }
  return parsed.data
}

export interface RefreshTokensOpts {
  tokenEndpoint: string
  refreshToken: string
  clientId: string
  fetchImpl?: typeof fetch
}

/**
 * Refresh tokens via the refresh_token grant. Returns the parsed token
 * response. If Epic returns a new refresh_token it'll be in
 * `result.refresh_token`; otherwise callers keep the old one.
 */
export async function refreshTokens(opts: RefreshTokensOpts): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
  })

  const fetchImpl = opts.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(opts.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    })
  } catch (err) {
    throw new SmartLaunchError({
      code: 'refresh_failed',
      message: 'Refresh endpoint fetch failed',
      details: { cause: err instanceof Error ? err.message : String(err) },
    })
  }

  if (!response.ok) {
    throw new SmartLaunchError({
      code: 'refresh_failed',
      message: `Refresh endpoint returned ${response.status}`,
      details: { status: response.status },
    })
  }

  let raw: unknown
  try {
    raw = await response.json()
  } catch (err) {
    throw new SmartLaunchError({
      code: 'refresh_failed',
      message: 'Refresh response was not JSON',
      details: { cause: err instanceof Error ? err.message : String(err) },
    })
  }

  const parsed = TokenResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new SmartLaunchError({
      code: 'refresh_failed',
      message: 'Refresh response failed schema validation',
      details: { issues: parsed.error.issues },
    })
  }
  return parsed.data
}

export interface VerifyIdTokenOpts {
  /** Expected `aud` claim — Epic sets this to our client_id. */
  audience: string
  /** Expected `iss` claim — typically the SMART discovery issuer URL. */
  issuer?: string
  /**
   * JWKS endpoint to fetch signing keys from. When supplied we run real
   * signature verification. When omitted (fixture-mode for tests prior to
   * Epic registration), we decode without signature verification. Real-Epic
   * verification is enforced in `tasks/phase-6-epic-verification.md`.
   */
  jwksUri?: string
}

/**
 * Verify and decode an id_token, returning the typed claim payload.
 *
 * Decoding-without-signature is acceptable in fixture-mode (no Epic
 * registration yet, per orchestrator override #2). When `jwksUri` is
 * present we do full signature verification via `jose`.
 */
export async function verifyIdToken(
  idToken: string,
  opts: VerifyIdTokenOpts,
): Promise<IdTokenClaims> {
  let rawClaims: unknown
  try {
    if (opts.jwksUri) {
      const jwks = createRemoteJWKSet(new URL(opts.jwksUri))
      const { payload } = await jwtVerify(idToken, jwks, {
        audience: opts.audience,
        issuer: opts.issuer,
      })
      rawClaims = payload
    } else {
      rawClaims = decodeJwt(idToken)
    }
  } catch (err) {
    throw new SmartLaunchError({
      code: 'id_token_invalid',
      message: 'id_token verification failed',
      details: { cause: err instanceof Error ? err.message : String(err) },
    })
  }

  const parsed = IdTokenClaimsSchema.safeParse(rawClaims)
  if (!parsed.success) {
    throw new SmartLaunchError({
      code: 'id_token_invalid',
      message: 'id_token claims failed schema validation',
      details: { issues: parsed.error.issues },
    })
  }

  return parsed.data
}
