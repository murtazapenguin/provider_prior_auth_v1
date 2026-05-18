/**
 * __tests__/lib/smart/session.test.ts
 *
 * SmartSession persistence with encrypted tokens, retrieval/decryption,
 * refresh-token rotation, revocation. Mocks the Prisma singleton and
 * the global fetch (for the refresh path).
 *
 * Mirrors the pattern from __tests__/lib/payer/simulator.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import smartConfigFixture from '../../fixtures/smart/smart-configuration.json'
import tokenResponseFixture from '../../fixtures/smart/token-response.json'
import { errorResponse, jsonResponse, withEncryptionKey } from './_testEnv'
import { _clearDiscoveryCache } from '@/lib/smart/discovery'

// ─── Mock the prisma client BEFORE importing the session module ──────────
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
          const row: SmartSessionRow = {
            id,
            createdAt: now,
            lastUsedAt: now,
            revokedAt: null,
            ...data,
          }
          rows.set(row.sessionToken, row)
          return row
        }),
        findUnique: vi.fn(async ({ where }: { where: { sessionToken: string } }) => {
          return rows.get(where.sessionToken) ?? null
        }),
        update: vi.fn(async ({ where, data }: { where: { sessionToken: string }; data: Partial<SmartSessionRow> }) => {
          const row = rows.get(where.sessionToken)
          if (!row) throw new Error('row not found')
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
  }
})

// ─── Import the module under test AFTER mocks are in place ───────────────
import {
  createSmartSession,
  getSessionByToken,
  refreshSession,
  revokeSession,
} from '@/lib/smart/session'

describe('createSmartSession', () => {
  let teardown: () => void
  beforeEach(() => {
    teardown = withEncryptionKey()
    rows.clear()
  })
  afterEach(() => {
    teardown()
  })

  it('persists a row with ENCRYPTED tokens (plaintext not in DB)', async () => {
    const { sessionToken } = await createSmartSession({
      iss: 'https://fhir.epic.com',
      tokenResponse: tokenResponseFixture,
      fhirUser: 'Practitioner/abc',
    })
    const stored = rows.get(sessionToken)!
    expect(stored).toBeDefined()
    expect(stored.accessTokenEnc).not.toBe(tokenResponseFixture.access_token)
    expect(stored.accessTokenEnc).not.toContain(tokenResponseFixture.access_token)
    expect(stored.refreshTokenEnc).not.toBe(tokenResponseFixture.refresh_token)
    expect(stored.refreshTokenEnc).not.toContain(tokenResponseFixture.refresh_token)
  })

  it('persists patient + encounter launch context', async () => {
    const { sessionToken } = await createSmartSession({
      iss: 'https://fhir.epic.com',
      tokenResponse: tokenResponseFixture,
      fhirUser: 'Practitioner/abc',
    })
    const stored = rows.get(sessionToken)!
    expect(stored.patientContext).toBe(tokenResponseFixture.patient)
    expect(stored.encounterContext).toBe(tokenResponseFixture.encounter)
  })

  it('persists the GRANTED scope (Epic echo), not the requested scope', async () => {
    const grantedFixture = {
      ...tokenResponseFixture,
      scope: 'openid fhirUser patient/Patient.read',
    }
    const { sessionToken } = await createSmartSession({
      iss: 'https://fhir.epic.com',
      tokenResponse: grantedFixture,
      fhirUser: 'Practitioner/abc',
    })
    expect(rows.get(sessionToken)!.scope).toBe('openid fhirUser patient/Patient.read')
  })

  it('sets expiresAt = now + expires_in seconds', async () => {
    const before = Date.now()
    const { expiresAt } = await createSmartSession({
      iss: 'https://fhir.epic.com',
      tokenResponse: tokenResponseFixture,
      fhirUser: 'Practitioner/abc',
    })
    const after = Date.now()
    const expected = tokenResponseFixture.expires_in * 1000
    expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(expected - 100)
    expect(expiresAt.getTime() - after).toBeLessThanOrEqual(expected + 100)
  })
})

describe('getSessionByToken', () => {
  let teardown: () => void
  beforeEach(() => {
    teardown = withEncryptionKey()
    rows.clear()
  })
  afterEach(() => {
    teardown()
  })

  it('returns null when sessionToken not found', async () => {
    const result = await getSessionByToken('does-not-exist')
    expect(result).toBeNull()
  })

  it('returns null when session is revoked', async () => {
    const { sessionToken } = await createSmartSession({
      iss: 'https://fhir.epic.com',
      tokenResponse: tokenResponseFixture,
      fhirUser: 'Practitioner/abc',
    })
    await revokeSession(sessionToken)
    const result = await getSessionByToken(sessionToken)
    expect(result).toBeNull()
  })

  it('returns DECRYPTED accessToken and refreshToken', async () => {
    const { sessionToken } = await createSmartSession({
      iss: 'https://fhir.epic.com',
      tokenResponse: tokenResponseFixture,
      fhirUser: 'Practitioner/abc',
    })
    const session = await getSessionByToken(sessionToken)
    expect(session).not.toBeNull()
    expect(session!.accessToken).toBe(tokenResponseFixture.access_token)
    expect(session!.refreshToken).toBe(tokenResponseFixture.refresh_token)
    expect(session!.patientContext).toBe(tokenResponseFixture.patient)
    expect(session!.encounterContext).toBe(tokenResponseFixture.encounter)
  })
})

describe('refreshSession', () => {
  let teardown: () => void
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    teardown = withEncryptionKey()
    rows.clear()
    _clearDiscoveryCache()
    process.env.EPIC_SANDBOX_CLIENT_ID = 'test-client-id-fixture'
    fetchSpy = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.endsWith('/.well-known/smart-configuration')) {
        return jsonResponse(smartConfigFixture)
      }
      // assume token endpoint
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

  it('rotates encrypted tokens after Epic refresh exchange', async () => {
    const { sessionToken } = await createSmartSession({
      iss: 'https://fhir.epic.com',
      tokenResponse: tokenResponseFixture,
      fhirUser: 'Practitioner/abc',
    })
    const before = rows.get(sessionToken)!.accessTokenEnc

    const refreshed = await refreshSession(sessionToken)
    expect(refreshed).not.toBeNull()
    expect(refreshed!.accessToken).toBe('rotated-access-token')
    expect(refreshed!.refreshToken).toBe('rotated-refresh-token')

    const after = rows.get(sessionToken)!.accessTokenEnc
    expect(after).not.toBe(before)
  })

  it('returns null and revokes when Epic returns 401 on refresh', async () => {
    const { sessionToken } = await createSmartSession({
      iss: 'https://fhir.epic.com',
      tokenResponse: tokenResponseFixture,
      fhirUser: 'Practitioner/abc',
    })

    fetchSpy.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.endsWith('/.well-known/smart-configuration')) {
        return jsonResponse(smartConfigFixture)
      }
      return errorResponse(401, { error: 'invalid_grant' })
    })

    const result = await refreshSession(sessionToken)
    expect(result).toBeNull()
    expect(rows.get(sessionToken)!.revokedAt).not.toBeNull()
  })

  it('returns null when refreshToken is missing', async () => {
    const noRt = { ...tokenResponseFixture, refresh_token: undefined }
    const { sessionToken } = await createSmartSession({
      iss: 'https://fhir.epic.com',
      tokenResponse: noRt,
      fhirUser: 'Practitioner/abc',
    })
    const result = await refreshSession(sessionToken)
    expect(result).toBeNull()
  })
})

describe('revokeSession', () => {
  let teardown: () => void
  beforeEach(() => {
    teardown = withEncryptionKey()
    rows.clear()
  })
  afterEach(() => {
    teardown()
  })

  it('sets revokedAt on the row', async () => {
    const { sessionToken } = await createSmartSession({
      iss: 'https://fhir.epic.com',
      tokenResponse: tokenResponseFixture,
      fhirUser: 'Practitioner/abc',
    })
    await revokeSession(sessionToken)
    expect(rows.get(sessionToken)!.revokedAt).toBeInstanceOf(Date)
  })

  it('is idempotent — revoking twice does not error', async () => {
    const { sessionToken } = await createSmartSession({
      iss: 'https://fhir.epic.com',
      tokenResponse: tokenResponseFixture,
      fhirUser: 'Practitioner/abc',
    })
    await revokeSession(sessionToken)
    await revokeSession(sessionToken)
    expect(rows.get(sessionToken)!.revokedAt).toBeInstanceOf(Date)
  })
})
