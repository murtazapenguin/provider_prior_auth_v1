/**
 * __tests__/app/api/auth/smart/callback.test.ts
 *
 * GET /api/auth/smart/callback — verifies state cookie, exchanges code,
 * persists SmartSession with encrypted tokens, sets session cookie,
 * redirects to /queue or /queue?encounter=...
 *
 * Uses the same prisma+fetch mocking pattern as session.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SignJWT } from 'jose'
import smartConfigFixture from '../../../../fixtures/smart/smart-configuration.json'
import tokenResponseFixture from '../../../../fixtures/smart/token-response.json'
import idTokenClaimsFixture from '../../../../fixtures/smart/id-token-claims.json'
import { jsonResponse, withEncryptionKey } from '../../../../lib/smart/_testEnv'
import { _clearDiscoveryCache } from '@/lib/smart/discovery'
import { encodeStateCookie, STATE_COOKIE_NAME, STATE_TTL_MS } from '@/lib/smart/state'
import type { StatePayload } from '@/lib/smart/types'

const ISS = 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4'

// ─── Prisma mock — keeps inserted rows accessible to the test ─────────────
type SmartSessionRow = {
  id: string
  sessionToken: string
  iss: string
  accessTokenEnc: string
  refreshTokenEnc: string | null
  idTokenEnc: string | null
  expiresAt: Date
  fhirUser: string
  patientContext: string | null
  encounterContext: string | null
  scope: string
  createdAt: Date
  lastUsedAt: Date
  revokedAt: Date | null
}

const rows = new Map<string, SmartSessionRow>()

vi.mock('@/lib/db/client', () => {
  return {
    prisma: {
      smartSession: {
        create: vi.fn(async ({ data }: { data: Omit<SmartSessionRow, 'id' | 'createdAt' | 'lastUsedAt' | 'revokedAt'> }) => {
          const id = `cuid-${rows.size + 1}`
          const now = new Date()
          const row: SmartSessionRow = { id, createdAt: now, lastUsedAt: now, revokedAt: null, ...data }
          rows.set(row.sessionToken, row)
          return row
        }),
        findUnique: vi.fn(async ({ where }: { where: { sessionToken: string } }) => rows.get(where.sessionToken) ?? null),
        update: vi.fn(async ({ where, data }: { where: { sessionToken: string }; data: Partial<SmartSessionRow> }) => {
          const row = rows.get(where.sessionToken)!
          Object.assign(row, data)
          return row
        }),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      // Phase 6 T10: callback now consumes computePostLaunchDestination, which
      // queries priorAuth by encounterId. Tests default to "no PA exists" so
      // the destination falls through to /queue?encounter={id} branch.
      priorAuth: {
        findFirst: vi.fn(async () => null),
      },
    },
  }
})

// ─── Helpers ─────────────────────────────────────────────────────────────

async function signFixtureIdToken(claims: Record<string, unknown>): Promise<string> {
  // 32-byte test key. jose accepts any non-empty Uint8Array for HS256.
  const key = new TextEncoder().encode('test-secret-padding-padding-padding-padding-x')
  return new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).sign(key)
}

function makeStatePayload(over: Partial<StatePayload> = {}): StatePayload {
  return {
    iss: ISS,
    launch: 'epic-launch-token',
    codeVerifier: 'verifier-from-state-cookie',
    redirectAfterAuth: undefined,
    nonce: 'state-nonce-abc',
    createdAt: Date.now(),
    ...over,
  }
}

function makeCallbackRequest(opts: {
  code?: string
  state?: string
  error?: string
  stateCookieValue?: string
}): Request {
  const search = new URLSearchParams()
  if (opts.code) search.set('code', opts.code)
  if (opts.state) search.set('state', opts.state)
  if (opts.error) search.set('error', opts.error)
  const url = `http://localhost:3000/api/auth/smart/callback?${search.toString()}`
  const headers = new Headers()
  if (opts.stateCookieValue) {
    headers.set('cookie', `${STATE_COOKIE_NAME}=${opts.stateCookieValue}`)
  }
  return new Request(url, { headers })
}

describe('GET /api/auth/smart/callback', () => {
  let teardown: () => void
  let fetchSpy: ReturnType<typeof vi.fn>
  let idTokenJwt: string

  beforeEach(async () => {
    teardown = withEncryptionKey()
    _clearDiscoveryCache()
    rows.clear()
    process.env.EPIC_SANDBOX_CLIENT_ID = 'test-client-id-fixture'
    process.env.EPIC_SANDBOX_REDIRECT_URI = 'http://localhost:3000/api/auth/smart/callback'

    idTokenJwt = await signFixtureIdToken({ ...idTokenClaimsFixture })

    fetchSpy = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.endsWith('/.well-known/smart-configuration')) {
        return jsonResponse(smartConfigFixture)
      }
      // token endpoint
      return jsonResponse({ ...tokenResponseFixture, id_token: idTokenJwt })
    })
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    teardown()
    delete process.env.EPIC_SANDBOX_CLIENT_ID
    delete process.env.EPIC_SANDBOX_REDIRECT_URI
    vi.unstubAllGlobals()
  })

  it('happy path: valid state+code → SmartSession created with encrypted tokens, session cookie set, redirects to /queue?encounter=...', async () => {
    const { GET } = await import('@/app/api/auth/smart/callback/route')
    const payload = makeStatePayload({ nonce: 'happy-nonce' })
    const stateCookie = encodeStateCookie(payload)

    const req = makeCallbackRequest({
      code: 'auth-code-abc',
      state: 'happy-nonce',
      stateCookieValue: stateCookie,
    })
    const res = await GET(req)

    expect(res.status).toBe(307)
    const location = res.headers.get('location')!
    expect(location).toContain('/queue')
    expect(location).toContain(`encounter=${encodeURIComponent(tokenResponseFixture.encounter)}`)

    // SmartSession row was persisted
    expect(rows.size).toBe(1)
    const [stored] = rows.values()
    // Tokens are encrypted in storage
    expect(stored.accessTokenEnc).not.toBe(tokenResponseFixture.access_token)
    expect(stored.accessTokenEnc).not.toContain(tokenResponseFixture.access_token)
    expect(stored.refreshTokenEnc).not.toContain(tokenResponseFixture.refresh_token)
    // Granted scope is persisted
    expect(stored.scope).toBe(tokenResponseFixture.scope)
    // Launch context is persisted
    expect(stored.patientContext).toBe(tokenResponseFixture.patient)
    expect(stored.encounterContext).toBe(tokenResponseFixture.encounter)
    // fhirUser comes from id_token claims
    expect(stored.fhirUser).toBe(idTokenClaimsFixture.fhirUser)

    // Session cookie is set
    const setCookie = res.headers.get('set-cookie')!
    expect(setCookie).toContain('smart_session=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie.toLowerCase()).toContain('samesite=lax')
    // State cookie is cleared
    expect(setCookie).toMatch(/smart_launch_state=;/i)
  })

  it('400 when state query param is missing', async () => {
    const { GET } = await import('@/app/api/auth/smart/callback/route')
    const req = makeCallbackRequest({ code: 'x' })
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('400 when code query param is missing', async () => {
    const { GET } = await import('@/app/api/auth/smart/callback/route')
    const req = makeCallbackRequest({ state: 'x' })
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('400 when state nonce does not match cookie', async () => {
    const { GET } = await import('@/app/api/auth/smart/callback/route')
    const stateCookie = encodeStateCookie(makeStatePayload({ nonce: 'expected' }))
    const req = makeCallbackRequest({
      code: 'x',
      state: 'attacker-nonce',
      stateCookieValue: stateCookie,
    })
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('400 when state cookie is older than 10 min TTL', async () => {
    const { GET } = await import('@/app/api/auth/smart/callback/route')
    const stateCookie = encodeStateCookie(
      makeStatePayload({ nonce: 'n', createdAt: Date.now() - STATE_TTL_MS - 5000 }),
    )
    const req = makeCallbackRequest({
      code: 'x',
      state: 'n',
      stateCookieValue: stateCookie,
    })
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('400 when state cookie is missing', async () => {
    const { GET } = await import('@/app/api/auth/smart/callback/route')
    const req = makeCallbackRequest({ code: 'x', state: 'y' })
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('400 when Epic granted scope lacks patient/Patient.read', async () => {
    fetchSpy.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.endsWith('/.well-known/smart-configuration')) {
        return jsonResponse(smartConfigFixture)
      }
      return jsonResponse({
        ...tokenResponseFixture,
        id_token: idTokenJwt,
        scope: 'openid fhirUser', // missing patient/Patient.read
      })
    })
    const { GET } = await import('@/app/api/auth/smart/callback/route')
    const stateCookie = encodeStateCookie(makeStatePayload({ nonce: 'n' }))
    const req = makeCallbackRequest({ code: 'x', state: 'n', stateCookieValue: stateCookie })
    const res = await GET(req)
    expect(res.status).toBe(400)
    expect(rows.size).toBe(0) // no row created on scope failure
  })

  it('redirects to /login when Epic returns error in query', async () => {
    const { GET } = await import('@/app/api/auth/smart/callback/route')
    const req = makeCallbackRequest({ error: 'access_denied' })
    const res = await GET(req)
    expect(res.status).toBe(307)
    const location = res.headers.get('location')!
    expect(location).toContain('/login')
    expect(location).toContain('smart_error=access_denied')
  })
})
