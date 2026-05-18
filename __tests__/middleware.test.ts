/**
 * __tests__/middleware.test.ts
 *
 * Edge-runtime auth middleware. Tested from the Vitest Node environment;
 * jose and NextResponse both work there. Middleware never queries the DB
 * (Edge limitation), so revocation tests aren't here — revocation
 * manifests when the refresh route clears the cookie on failure, which
 * is covered by `__tests__/app/api/auth/smart/refresh.test.ts`. Once the
 * cookie is cleared, the next protected-route request takes the
 * "no session cookie → /login" branch in this file.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'
import { signSessionCookie, SESSION_COOKIE_NAME } from '@/lib/smart/sessionCookie'
import { withEncryptionKey } from './lib/smart/_testEnv'

function makeRequest(path: string, cookies: Record<string, string> = {}): NextRequest {
  const url = `http://localhost:3000${path}`
  const headers = new Headers()
  if (Object.keys(cookies).length > 0) {
    headers.set(
      'cookie',
      Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
    )
  }
  return new NextRequest(url, { headers })
}

describe('middleware', () => {
  let teardown: () => void
  beforeEach(() => {
    teardown = withEncryptionKey()
  })
  afterEach(() => {
    teardown()
  })

  it('lets /launch through unauthenticated', async () => {
    const res = await middleware(makeRequest('/launch?iss=https://fhir.epic.com'))
    // NextResponse.next() yields a response with no redirect location header
    expect(res?.headers.get('location')).toBeNull()
  })

  it('lets /launch/standalone through unauthenticated (covered by /launch prefix)', async () => {
    // Phase 6 / T9: the standalone-launch route lives under /launch/ on purpose
    // so the existing public-path prefix match grants access without
    // modifying middleware.ts (override #13 forbids that).
    const res = await middleware(makeRequest('/launch/standalone'))
    expect(res?.headers.get('location')).toBeNull()
  })

  it('lets /api/auth/smart/* through unauthenticated', async () => {
    const res = await middleware(makeRequest('/api/auth/smart/callback'))
    expect(res?.headers.get('location')).toBeNull()
  })

  it('lets /api/* through (handlers authenticate themselves)', async () => {
    const res = await middleware(makeRequest('/api/pa'))
    expect(res?.headers.get('location')).toBeNull()
  })

  it('redirects unauthenticated provider UI request to /login', async () => {
    const res = await middleware(makeRequest('/queue'))
    expect(res?.headers.get('location')).toContain('/login')
  })

  it('lets a valid SMART session cookie through', async () => {
    const cookie = await signSessionCookie({
      sessionToken: 'sess-1',
      expiresAtMs: Date.now() + 3600_000,
    })
    const res = await middleware(makeRequest('/queue', { [SESSION_COOKIE_NAME]: cookie }))
    expect(res?.headers.get('location')).toBeNull()
  })

  it('redirects near-expiry SMART cookie to /api/auth/smart/refresh', async () => {
    const cookie = await signSessionCookie({
      sessionToken: 'sess-1',
      expiresAtMs: Date.now() + 30_000, // 30s left, < 60s threshold
    })
    const res = await middleware(makeRequest('/queue', { [SESSION_COOKIE_NAME]: cookie }))
    const location = res?.headers.get('location')!
    expect(location).toContain('/api/auth/smart/refresh')
    expect(location).toContain('next=%2Fqueue')
  })

  it('clears cookie and redirects when SMART cookie is invalid (HMAC mismatch)', async () => {
    const res = await middleware(
      makeRequest('/queue', { [SESSION_COOKIE_NAME]: 'not.a.valid.jwt' }),
    )
    expect(res?.headers.get('location')).toContain('/login')
    const setCookie = res?.headers.get('set-cookie')
    expect(setCookie).toMatch(/smart_session=;/)
  })

  it('honors legacy pa_provider_id cookie outside production (backward compat)', async () => {
    // NODE_ENV defaults to 'test' under vitest, which satisfies the
    // "!== 'production'" check the middleware uses; no env mutation needed.
    expect(process.env.NODE_ENV).not.toBe('production')
    const res = await middleware(makeRequest('/queue', { pa_provider_id: 'provider-pcp-sarah-chen' }))
    expect(res?.headers.get('location')).toBeNull()
  })
})
