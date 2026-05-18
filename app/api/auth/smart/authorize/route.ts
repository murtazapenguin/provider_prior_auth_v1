/**
 * app/api/auth/smart/authorize/route.ts
 *
 * GET /api/auth/smart/authorize?iss=<EpicFHIR>&launch=<launchToken>&redirectAfterAuth=<path>
 *
 * Builds the SMART authorize URL with PKCE + state, sets the encrypted
 * state cookie, and redirects to Epic.
 *
 * Public-client PKCE. No client_secret. The launch parameter is optional —
 * standalone-launch flows omit it and rely on Epic's patient picker
 * (the `launch/patient` scope is auto-substituted for `launch`).
 */

import { NextResponse } from 'next/server'
import { getSmartConfiguration } from '@/lib/smart/discovery'
import { generatePkcePair } from '@/lib/smart/pkce'
import {
  STATE_COOKIE_NAME,
  STATE_TTL_MS,
  encodeStateCookie,
  generateStateNonce,
} from '@/lib/smart/state'
import {
  DEFAULT_SCOPES,
  MissingEpicConfigError,
  STANDALONE_LAUNCH_SCOPES,
  type StatePayload,
} from '@/lib/smart/types'

export const runtime = 'nodejs'

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: { code: 'bad_request', message } }, { status: 400 })
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

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url)
  const iss = url.searchParams.get('iss')
  const launch = url.searchParams.get('launch') ?? undefined
  const redirectAfterAuth = url.searchParams.get('redirectAfterAuth') ?? undefined

  if (!iss) return badRequest('Missing required query parameter: iss')

  // Resolve Epic config first so misconfig surfaces with a typed error.
  const { clientId, redirectUri } = requireEpicConfig()

  const config = await getSmartConfiguration(iss)

  const pkce = generatePkcePair()
  const nonce = generateStateNonce()
  const statePayload: StatePayload = {
    iss,
    launch,
    codeVerifier: pkce.verifier,
    redirectAfterAuth,
    nonce,
    createdAt: Date.now(),
  }

  // Standalone launch (no `launch` param) ⇒ use launch/patient so Epic
  // surfaces the patient picker. EHR launch keeps the bare `launch` scope.
  const requestedScope = launch ? DEFAULT_SCOPES : STANDALONE_LAUNCH_SCOPES

  const authorizeUrl = new URL(config.authorization_endpoint)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('client_id', clientId)
  authorizeUrl.searchParams.set('redirect_uri', redirectUri)
  authorizeUrl.searchParams.set('scope', requestedScope)
  authorizeUrl.searchParams.set('state', nonce)
  // aud MUST equal iss FHIR base — Epic rejects launches missing or
  // mismatched. This is the most common cause of "your launch is malformed."
  authorizeUrl.searchParams.set('aud', iss)
  authorizeUrl.searchParams.set('code_challenge', pkce.challenge)
  authorizeUrl.searchParams.set('code_challenge_method', pkce.challengeMethod)
  if (launch) authorizeUrl.searchParams.set('launch', launch)

  const response = NextResponse.redirect(authorizeUrl.toString())
  response.cookies.set({
    name: STATE_COOKIE_NAME,
    value: encodeStateCookie(statePayload),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(STATE_TTL_MS / 1000),
  })
  return response
}
