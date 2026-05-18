/**
 * __tests__/lib/smart/tokenExchange.test.ts
 *
 * Public-client PKCE token exchange + refresh + id_token verification.
 */

import { describe, it, expect, vi } from 'vitest'
import { SignJWT } from 'jose'
import {
  exchangeCodeForTokens,
  refreshTokens,
  verifyIdToken,
} from '@/lib/smart/tokenExchange'
import tokenResponseFixture from '../../fixtures/smart/token-response.json'
import idTokenClaimsFixture from '../../fixtures/smart/id-token-claims.json'
import { jsonResponse, errorResponse } from './_testEnv'

const TOKEN_ENDPOINT = 'https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token'

describe('exchangeCodeForTokens', () => {
  it('builds form-urlencoded body with PKCE verifier and NO client_secret', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(tokenResponseFixture))
    const result = await exchangeCodeForTokens({
      tokenEndpoint: TOKEN_ENDPOINT,
      code: 'auth-code-xyz',
      redirectUri: 'http://localhost:3000/api/auth/smart/callback',
      clientId: 'test-client-id-fixture',
      codeVerifier: 'verifier-from-state-cookie',
      fetchImpl: fetchSpy,
    })

    expect(fetchSpy).toHaveBeenCalledOnce()
    const firstCall = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    const [calledUrl, init] = firstCall
    expect(calledUrl).toBe(TOKEN_ENDPOINT)
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded')

    const body = init.body as string
    const params = new URLSearchParams(body)
    expect(params.get('grant_type')).toBe('authorization_code')
    expect(params.get('code')).toBe('auth-code-xyz')
    expect(params.get('redirect_uri')).toBe('http://localhost:3000/api/auth/smart/callback')
    expect(params.get('client_id')).toBe('test-client-id-fixture')
    expect(params.get('code_verifier')).toBe('verifier-from-state-cookie')
    expect(params.has('client_secret')).toBe(false)

    expect(result.access_token).toBe(tokenResponseFixture.access_token)
    expect(result.scope).toBe(tokenResponseFixture.scope)
    expect(result.patient).toBe(tokenResponseFixture.patient)
    expect(result.encounter).toBe(tokenResponseFixture.encounter)
  })

  it('throws SmartLaunchError on Epic 4xx', async () => {
    const fetchSpy = vi.fn(async () => errorResponse(400, { error: 'invalid_grant' }))
    await expect(
      exchangeCodeForTokens({
        tokenEndpoint: TOKEN_ENDPOINT,
        code: 'bad',
        redirectUri: 'http://localhost:3000/api/auth/smart/callback',
        clientId: 'test-client-id-fixture',
        codeVerifier: 'x',
        fetchImpl: fetchSpy,
      }),
    ).rejects.toThrow(/token/i)
  })

  it('throws on schema validation failure', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ token_type: 'bearer' }))
    await expect(
      exchangeCodeForTokens({
        tokenEndpoint: TOKEN_ENDPOINT,
        code: 'x',
        redirectUri: 'http://localhost:3000/api/auth/smart/callback',
        clientId: 'test-client-id-fixture',
        codeVerifier: 'x',
        fetchImpl: fetchSpy,
      }),
    ).rejects.toThrow(/token/i)
  })
})

describe('refreshTokens', () => {
  it('uses grant_type=refresh_token and excludes client_secret', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(tokenResponseFixture))
    await refreshTokens({
      tokenEndpoint: TOKEN_ENDPOINT,
      refreshToken: 'rt-1',
      clientId: 'test-client-id-fixture',
      fetchImpl: fetchSpy,
    })

    const refreshCall = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    const [, init] = refreshCall
    const params = new URLSearchParams(init.body as string)
    expect(params.get('grant_type')).toBe('refresh_token')
    expect(params.get('refresh_token')).toBe('rt-1')
    expect(params.get('client_id')).toBe('test-client-id-fixture')
    expect(params.has('client_secret')).toBe(false)
  })

  it('throws SmartLaunchError code=refresh_failed when Epic returns 401', async () => {
    const fetchSpy = vi.fn(async () => errorResponse(401, { error: 'invalid_grant' }))
    await expect(
      refreshTokens({
        tokenEndpoint: TOKEN_ENDPOINT,
        refreshToken: 'revoked-rt',
        clientId: 'test-client-id-fixture',
        fetchImpl: fetchSpy,
      }),
    ).rejects.toThrow(/refresh/i)
  })
})

describe('verifyIdToken (fixture-mode, no jwksUri)', () => {
  // Sign a fixture JWT with a test key — verifyIdToken without jwksUri uses
  // decodeJwt which doesn't verify signatures, but we still want the test
  // to use a real well-formed JWT to validate the claim shape.
  async function fixtureJwt(claims: Record<string, unknown>): Promise<string> {
    const key = new TextEncoder().encode('test-hmac-secret-not-real-32-bytes-padding-padding-padding')
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .sign(key)
  }

  it('decodes the expected claim shape — fhirUser, sub, aud, exp', async () => {
    const jwt = await fixtureJwt(idTokenClaimsFixture as unknown as Record<string, unknown>)
    const claims = await verifyIdToken(jwt, { audience: 'test-client-id-fixture' })
    expect(claims.aud).toBe(idTokenClaimsFixture.aud)
    expect(claims.sub).toBe(idTokenClaimsFixture.sub)
    expect(claims.fhirUser).toBe(idTokenClaimsFixture.fhirUser)
    expect(claims.exp).toBe(idTokenClaimsFixture.exp)
  })

  it('throws when id_token claims fail schema (missing exp)', async () => {
    const jwt = await fixtureJwt({ sub: 'x', iss: 'y', aud: 'z' })
    // jose's SignJWT auto-adds exp when setExpirationTime is called, but
    // here we didn't set it and didn't include it manually. However jose
    // may not require exp itself; our zod schema does.
    await expect(verifyIdToken(jwt, { audience: 'z' })).rejects.toThrow(/id_token/i)
  })
})
