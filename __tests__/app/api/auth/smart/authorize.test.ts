/**
 * __tests__/app/api/auth/smart/authorize.test.ts
 *
 * GET /api/auth/smart/authorize — drives the OAuth dance from /launch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import smartConfigFixture from '../../../../fixtures/smart/smart-configuration.json'
import { jsonResponse, withEncryptionKey } from '../../../../lib/smart/_testEnv'
import { _clearDiscoveryCache } from '@/lib/smart/discovery'
import { MIN_REQUIRED_GRANTED_SCOPES } from '@/lib/smart/types'

const ISS = 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4'

describe('GET /api/auth/smart/authorize', () => {
  let teardown: () => void
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    teardown = withEncryptionKey()
    _clearDiscoveryCache()
    process.env.EPIC_SANDBOX_CLIENT_ID = 'test-client-id-fixture'
    process.env.EPIC_SANDBOX_REDIRECT_URI = 'http://localhost:3000/api/auth/smart/callback'
    fetchSpy = vi.fn(async () => jsonResponse(smartConfigFixture))
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    teardown()
    delete process.env.EPIC_SANDBOX_CLIENT_ID
    delete process.env.EPIC_SANDBOX_REDIRECT_URI
    vi.unstubAllGlobals()
  })

  it('redirects to authorize URL with all required PKCE params and aud=iss', async () => {
    const { GET } = await import('@/app/api/auth/smart/authorize/route')
    const req = new Request(
      `http://localhost:3000/api/auth/smart/authorize?iss=${encodeURIComponent(ISS)}&launch=launch-123`,
    )
    const res = await GET(req)
    expect(res.status).toBe(307) // NextResponse.redirect default

    const location = res.headers.get('location')!
    expect(location).toContain(smartConfigFixture.authorization_endpoint)
    const url = new URL(location)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('test-client-id-fixture')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/auth/smart/callback',
    )
    expect(url.searchParams.get('aud')).toBe(ISS)
    expect(url.searchParams.get('launch')).toBe('launch-123')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')

    const challenge = url.searchParams.get('code_challenge')!
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(challenge.length).toBeGreaterThanOrEqual(43)

    const state = url.searchParams.get('state')!
    expect(state.length).toBeGreaterThanOrEqual(32)

    // scope contains all the requested patient + user scopes
    const scope = url.searchParams.get('scope')!
    for (const required of MIN_REQUIRED_GRANTED_SCOPES) {
      expect(scope).toContain(required)
    }
  })

  it('sets the smart_launch_state cookie (httpOnly, sameSite=Lax)', async () => {
    const { GET } = await import('@/app/api/auth/smart/authorize/route')
    const req = new Request(
      `http://localhost:3000/api/auth/smart/authorize?iss=${encodeURIComponent(ISS)}&launch=launch-1`,
    )
    const res = await GET(req)
    const setCookie = res.headers.get('set-cookie')!
    expect(setCookie).toContain('smart_launch_state=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie.toLowerCase()).toContain('samesite=lax')
    expect(setCookie).toContain('Path=/')
  })

  it('returns 400 when iss is missing', async () => {
    const { GET } = await import('@/app/api/auth/smart/authorize/route')
    const req = new Request('http://localhost:3000/api/auth/smart/authorize')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('throws MissingEpicConfigError when EPIC_SANDBOX_CLIENT_ID unset', async () => {
    delete process.env.EPIC_SANDBOX_CLIENT_ID
    const { GET } = await import('@/app/api/auth/smart/authorize/route')
    const req = new Request(`http://localhost:3000/api/auth/smart/authorize?iss=${encodeURIComponent(ISS)}`)
    await expect(GET(req)).rejects.toThrow(/EPIC_SANDBOX_CLIENT_ID/)
  })

  it('standalone launch (no launch param) requests launch/patient scope', async () => {
    const { GET } = await import('@/app/api/auth/smart/authorize/route')
    const req = new Request(`http://localhost:3000/api/auth/smart/authorize?iss=${encodeURIComponent(ISS)}`)
    const res = await GET(req)
    const location = res.headers.get('location')!
    const scope = new URL(location).searchParams.get('scope')!
    expect(scope).toContain('launch/patient')
    expect(scope).not.toMatch(/\blaunch\b(?!\/patient)/)
  })

  it('omits launch param from authorize URL when not provided (standalone)', async () => {
    const { GET } = await import('@/app/api/auth/smart/authorize/route')
    const req = new Request(`http://localhost:3000/api/auth/smart/authorize?iss=${encodeURIComponent(ISS)}`)
    const res = await GET(req)
    const location = res.headers.get('location')!
    expect(new URL(location).searchParams.has('launch')).toBe(false)
  })
})
