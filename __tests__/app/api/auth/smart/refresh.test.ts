/**
 * __tests__/app/api/auth/smart/refresh.test.ts
 *
 * POST /api/auth/smart/refresh — rotates tokens; revokes on failure.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import smartConfigFixture from '../../../../fixtures/smart/smart-configuration.json'
import tokenResponseFixture from '../../../../fixtures/smart/token-response.json'
import { errorResponse, jsonResponse, withEncryptionKey } from '../../../../lib/smart/_testEnv'
import { _clearDiscoveryCache } from '@/lib/smart/discovery'
import { signSessionCookie, SESSION_COOKIE_NAME } from '@/lib/smart/sessionCookie'
import { encrypt } from '@/lib/smart/crypto'

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

vi.mock('@/lib/db/client', () => ({
  prisma: {
    smartSession: {
      create: vi.fn(),
      findUnique: vi.fn(async ({ where }: { where: { sessionToken: string } }) => rows.get(where.sessionToken) ?? null),
      update: vi.fn(async ({ where, data }: { where: { sessionToken: string }; data: Partial<SmartSessionRow> }) => {
        const row = rows.get(where.sessionToken)!
        Object.assign(row, data)
        return row
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { sessionToken: string; revokedAt: null }; data: Partial<SmartSessionRow> }) => {
        const row = rows.get(where.sessionToken)
        if (!row || row.revokedAt !== null) return { count: 0 }
        Object.assign(row, data)
        return { count: 1 }
      }),
    },
  },
}))

function seedSessionRow(sessionToken: string): SmartSessionRow {
  // Tokens must be encrypted with the test key (see withEncryptionKey()).
  const row: SmartSessionRow = {
    id: 'cuid-test',
    sessionToken,
    iss: 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4',
    accessTokenEnc: encrypt('old-access-token'),
    refreshTokenEnc: encrypt('old-refresh-token'),
    idTokenEnc: null,
    expiresAt: new Date(Date.now() + 30_000),
    fhirUser: 'Practitioner/abc',
    patientContext: null,
    encounterContext: null,
    scope: 'openid fhirUser patient/Patient.read',
    createdAt: new Date(),
    lastUsedAt: new Date(),
    revokedAt: null,
  }
  rows.set(sessionToken, row)
  return row
}

describe('POST /api/auth/smart/refresh', () => {
  let teardown: () => void
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    teardown = withEncryptionKey()
    _clearDiscoveryCache()
    rows.clear()
    process.env.EPIC_SANDBOX_CLIENT_ID = 'test-client-id-fixture'
    fetchSpy = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.endsWith('/.well-known/smart-configuration')) {
        return jsonResponse(smartConfigFixture)
      }
      return jsonResponse({
        ...tokenResponseFixture,
        access_token: 'rotated-access-token',
        refresh_token: 'rotated-refresh-token',
      })
    })
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    teardown()
    delete process.env.EPIC_SANDBOX_CLIENT_ID
    vi.unstubAllGlobals()
  })

  it('happy path: rotates tokens, returns 200, sets new cookie', async () => {
    const sessionToken = 'sess-1'
    seedSessionRow(sessionToken)
    const cookieValue = await signSessionCookie({
      sessionToken,
      expiresAtMs: Date.now() + 30_000,
    })

    const { POST } = await import('@/app/api/auth/smart/refresh/route')
    const req = new Request('http://localhost:3000/api/auth/smart/refresh', {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.expiresAt).toBeDefined()

    const setCookie = res.headers.get('set-cookie')!
    expect(setCookie).toContain('smart_session=')
  })

  it('revokes and clears cookie when Epic returns 401', async () => {
    const sessionToken = 'sess-2'
    seedSessionRow(sessionToken)
    const cookieValue = await signSessionCookie({
      sessionToken,
      expiresAtMs: Date.now() + 30_000,
    })

    fetchSpy.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.endsWith('/.well-known/smart-configuration')) {
        return jsonResponse(smartConfigFixture)
      }
      return errorResponse(401, { error: 'invalid_grant' })
    })

    const { POST } = await import('@/app/api/auth/smart/refresh/route')
    const req = new Request('http://localhost:3000/api/auth/smart/refresh', {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.ok).toBe(false)

    expect(rows.get(sessionToken)!.revokedAt).not.toBeNull()
    const setCookie = res.headers.get('set-cookie')!
    expect(setCookie).toMatch(/smart_session=;/)
  })

  it('returns ok:false when no session cookie is present', async () => {
    const { POST } = await import('@/app/api/auth/smart/refresh/route')
    const req = new Request('http://localhost:3000/api/auth/smart/refresh', {
      method: 'POST',
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })
})
