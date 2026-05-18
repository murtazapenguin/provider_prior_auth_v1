/**
 * __tests__/app/(admin)/policies/publishRoute.test.ts
 *
 * Unit tests for POST /policies/[id]/publish (the only mutation surface in
 * the admin route group).
 *
 * Covers:
 *   - 401 when getCurrentSession returns null
 *   - 404 when the policy id is unknown
 *   - 409 when the policy is not in 'draft' status
 *   - 200 + status flip when called on a draft policy (JSON caller)
 *   - 303 redirect to the detail page for browser form POSTs
 *   - The publishedBy field is the SmartSession.fhirUser
 *   - The error envelope shape: { error: { code, message } }
 *   - The success envelope shape: { ok: true, policy: {...} }
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  policyFindUnique: vi.fn(),
  policyUpdate: vi.fn(),
  getCurrentSession: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({
  prisma: {
    policy: {
      findUnique: hoisted.policyFindUnique,
      update: hoisted.policyUpdate,
    },
  },
}))

vi.mock('@/lib/smart/session', () => ({
  getCurrentSession: hoisted.getCurrentSession,
}))

import { POST } from '@/app/(admin)/policies/[id]/publish/route'

// Build a minimal Request with optional body.
function buildRequest(
  body: unknown,
  opts: { contentType?: string } = {},
): Request {
  const headers: Record<string, string> = {}
  if (opts.contentType) headers['content-type'] = opts.contentType
  const init: RequestInit = { method: 'POST', headers }
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
    if (!opts.contentType && typeof body !== 'string') {
      headers['content-type'] = 'application/json'
    }
  }
  return new Request('http://localhost/policies/p1/publish', init)
}

function buildCtx(id: string) {
  return { params: Promise.resolve({ id }) }
}

const VALID_SESSION = {
  id: 'sess-1',
  sessionToken: 'opaque',
  iss: 'https://fhir.epic.example/api/FHIR/R4',
  accessToken: 'at',
  refreshToken: null,
  idToken: null,
  expiresAt: new Date('2099-01-01T00:00:00Z'),
  fhirUser: 'Practitioner/abc',
  patientContext: null,
  encounterContext: null,
  scope: 'openid',
  createdAt: new Date(),
  lastUsedAt: new Date(),
}

describe('POST /policies/[id]/publish', () => {
  beforeEach(() => {
    hoisted.policyFindUnique.mockReset()
    hoisted.policyUpdate.mockReset()
    hoisted.getCurrentSession.mockReset()
  })

  it('returns 401 when no session is present', async () => {
    hoisted.getCurrentSession.mockResolvedValue(null)
    const res = await POST(buildRequest(undefined), buildCtx('p1'))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({
      error: { code: 'unauthorized', message: 'A valid session is required' },
    })
    // Did NOT query Prisma when unauthorized.
    expect(hoisted.policyFindUnique).not.toHaveBeenCalled()
  })

  it('returns 404 when the policy id is unknown', async () => {
    hoisted.getCurrentSession.mockResolvedValue(VALID_SESSION)
    hoisted.policyFindUnique.mockResolvedValue(null)

    const res = await POST(buildRequest(undefined), buildCtx('missing-id'))

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('not_found')
    expect(body.error.message).toContain('missing-id')
    expect(hoisted.policyUpdate).not.toHaveBeenCalled()
  })

  it("returns 409 when the policy is not in 'draft' status", async () => {
    hoisted.getCurrentSession.mockResolvedValue(VALID_SESSION)
    hoisted.policyFindUnique.mockResolvedValue({
      id: 'p1',
      publishStatus: 'published',
    })

    const res = await POST(buildRequest(undefined), buildCtx('p1'))

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.code).toBe('invalid_state')
    expect(body.error.message).toContain("not in 'draft'")
    expect(body.error.details).toEqual({ currentStatus: 'published' })
    expect(hoisted.policyUpdate).not.toHaveBeenCalled()
  })

  it('returns 409 when policy is retired', async () => {
    hoisted.getCurrentSession.mockResolvedValue(VALID_SESSION)
    hoisted.policyFindUnique.mockResolvedValue({
      id: 'p1',
      publishStatus: 'retired',
    })
    const res = await POST(buildRequest(undefined), buildCtx('p1'))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.details).toEqual({ currentStatus: 'retired' })
  })

  it('flips draft → published with publishedBy = session.fhirUser', async () => {
    hoisted.getCurrentSession.mockResolvedValue(VALID_SESSION)
    hoisted.policyFindUnique.mockResolvedValue({
      id: 'p1',
      publishStatus: 'draft',
    })
    hoisted.policyUpdate.mockImplementation(async (args) => ({
      id: 'p1',
      publishStatus: args.data.publishStatus,
      publishedAt: args.data.publishedAt,
      publishedBy: args.data.publishedBy,
      policyVersion: null,
    }))

    // JSON caller → JSON envelope. The browser form-POST path (303 redirect)
    // is covered by the form-encoded test below.
    const res = await POST(buildRequest({}), buildCtx('p1'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.policy.id).toBe('p1')
    expect(body.policy.publishStatus).toBe('published')
    expect(body.policy.publishedBy).toBe('Practitioner/abc')

    expect(hoisted.policyUpdate).toHaveBeenCalledTimes(1)
    const updateArgs = hoisted.policyUpdate.mock.calls[0][0]
    expect(updateArgs.where).toEqual({ id: 'p1' })
    expect(updateArgs.data.publishStatus).toBe('published')
    expect(updateArgs.data.publishedBy).toBe('Practitioner/abc')
    expect(updateArgs.data.publishedAt).toBeInstanceOf(Date)
  })

  it('accepts JSON body with an optional note field', async () => {
    hoisted.getCurrentSession.mockResolvedValue(VALID_SESSION)
    hoisted.policyFindUnique.mockResolvedValue({
      id: 'p1',
      publishStatus: 'draft',
    })
    hoisted.policyUpdate.mockResolvedValue({
      id: 'p1',
      publishStatus: 'published',
      publishedAt: new Date(),
      publishedBy: 'Practitioner/abc',
      policyVersion: null,
    })

    const res = await POST(
      buildRequest({ note: 'Looked good after the AI re-extract' }),
      buildCtx('p1'),
    )
    expect(res.status).toBe(200)
  })

  it('rejects JSON body with the wrong shape (note > 2000 chars)', async () => {
    hoisted.getCurrentSession.mockResolvedValue(VALID_SESSION)
    const longNote = 'x'.repeat(2001)

    const res = await POST(buildRequest({ note: longNote }), buildCtx('p1'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('bad_request')
    expect(hoisted.policyFindUnique).not.toHaveBeenCalled()
  })

  it('accepts an empty form-encoded body (admin UI POST)', async () => {
    hoisted.getCurrentSession.mockResolvedValue(VALID_SESSION)
    hoisted.policyFindUnique.mockResolvedValue({
      id: 'p1',
      publishStatus: 'draft',
    })
    hoisted.policyUpdate.mockResolvedValue({
      id: 'p1',
      publishStatus: 'published',
      publishedAt: new Date(),
      publishedBy: 'Practitioner/abc',
      policyVersion: null,
    })

    const res = await POST(
      buildRequest('', { contentType: 'application/x-www-form-urlencoded' }),
      buildCtx('p1'),
    )
    // Browser form POST → 303 redirect back to the detail page, not raw JSON.
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('/policies/p1')
    expect(hoisted.policyUpdate).toHaveBeenCalledTimes(1)
  })

  it("error responses match the canonical { error: { code, message } } shape", async () => {
    hoisted.getCurrentSession.mockResolvedValue(null)
    const res = await POST(buildRequest(undefined), buildCtx('p1'))
    const body = await res.json()
    expect(body).toHaveProperty('error.code')
    expect(body).toHaveProperty('error.message')
    expect(typeof body.error.code).toBe('string')
    expect(typeof body.error.message).toBe('string')
  })
})
