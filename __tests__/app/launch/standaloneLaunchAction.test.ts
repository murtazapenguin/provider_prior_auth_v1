/**
 * __tests__/app/launch/standaloneLaunchAction.test.ts
 *
 * Mock-mode standalone-launch server action. Covers:
 *   - rejects when FHIR_MODE != mock
 *   - rejects an unknown patientId
 *   - creates a SmartSession row directly (NOT via OAuth callback)
 *   - encrypts the access token at rest (plaintext not stored)
 *   - patientContext is set to the picked id; encounterContext null
 *   - iss is sourced from EPIC_SANDBOX_FHIR_BASE
 *   - sets the signed session cookie
 *   - redirects via next/navigation.redirect to the computed destination
 *
 * Maps to TC-ID: WF-PROV-launch-standalone (and reuses post-launch routing
 * exercised under WF-X-encounter-context-switch).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withEncryptionKey } from '../../lib/smart/_testEnv'

// ─── Prisma mock — keeps the inserted SmartSession row visible ────────────
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
}

// vi.hoisted ensures these references are available inside the (also
// hoisted) vi.mock factories. Without this, the mock factory accesses
// `redirectSpy` before the const initializer runs and throws.
const hoisted = vi.hoisted(() => {
  return {
    rows: [] as SmartSessionRow[],
    cookiesSetSpy: vi.fn(),
    redirectSpy: vi.fn((_url: string) => {
      const err = new Error('NEXT_REDIRECT')
      ;(err as Error & { digest: string }).digest = `NEXT_REDIRECT;push;${_url};303;`
      throw err
    }),
  }
})
const { rows, cookiesSetSpy, redirectSpy } = hoisted

vi.mock('@/lib/db/client', () => {
  return {
    prisma: {
      smartSession: {
        create: vi.fn(async ({ data }: { data: Omit<SmartSessionRow, 'id'> }) => {
          const row: SmartSessionRow = { id: `cuid-${hoisted.rows.length + 1}`, ...data }
          hoisted.rows.push(row)
          return row
        }),
      },
      priorAuth: {
        findFirst: vi.fn(async () => null),
      },
    },
  }
})

// ─── next/headers mock — captures the cookie set call ─────────────────────
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    set: hoisted.cookiesSetSpy,
  })),
}))

// ─── next/navigation mock — captures the redirect target ──────────────────
// Next's real `redirect()` throws an internal NEXT_REDIRECT error so the
// server-action runtime can short-circuit. Mirror that contract here.
vi.mock('next/navigation', () => ({
  redirect: hoisted.redirectSpy,
}))

// ─── Import the action AFTER all mocks are wired ──────────────────────────
import { selectPatientForMockLaunch } from '@/app/launch/standalone/actions'

function buildFormData(patientId: string): FormData {
  const fd = new FormData()
  fd.set('patientId', patientId)
  return fd
}

describe('selectPatientForMockLaunch', () => {
  let teardownKey: () => void
  let originalMode: string | undefined
  let originalIss: string | undefined

  beforeEach(() => {
    teardownKey = withEncryptionKey()
    originalMode = process.env.FHIR_MODE
    originalIss = process.env.EPIC_SANDBOX_FHIR_BASE
    process.env.FHIR_MODE = 'mock'
    process.env.EPIC_SANDBOX_FHIR_BASE = 'https://fhir.epic.com/test-base'
    rows.length = 0
    cookiesSetSpy.mockClear()
    redirectSpy.mockClear()
  })

  afterEach(() => {
    teardownKey()
    if (originalMode === undefined) delete process.env.FHIR_MODE
    else process.env.FHIR_MODE = originalMode
    if (originalIss === undefined) delete process.env.EPIC_SANDBOX_FHIR_BASE
    else process.env.EPIC_SANDBOX_FHIR_BASE = originalIss
  })

  it('rejects when FHIR_MODE is not mock (real standalone deferred)', async () => {
    process.env.FHIR_MODE = 'real'
    await expect(
      selectPatientForMockLaunch(buildFormData('patient-priya-shah')),
    ).rejects.toThrow(/mock mode/i)
    expect(rows).toHaveLength(0)
    expect(cookiesSetSpy).not.toHaveBeenCalled()
    expect(redirectSpy).not.toHaveBeenCalled()
  })

  it('rejects an unknown patient id', async () => {
    await expect(
      selectPatientForMockLaunch(buildFormData('patient-unknown-mallory')),
    ).rejects.toThrow(/demo patients/i)
    expect(rows).toHaveLength(0)
  })

  it('creates a SmartSession row directly in Prisma (not via OAuth callback)', async () => {
    await expect(
      selectPatientForMockLaunch(buildFormData('patient-priya-shah')),
    ).rejects.toThrow('NEXT_REDIRECT') // expected — redirect throws
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.patientContext).toBe('patient-priya-shah')
    expect(row.encounterContext).toBeNull()
    expect(row.iss).toBe('https://fhir.epic.com/test-base')
    expect(row.fhirUser).toBe('Practitioner/mock-provider-1')
    expect(row.refreshTokenEnc).toBeNull()
    expect(row.idTokenEnc).toBeNull()
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(row.scope).toContain('openid')
    expect(row.scope).toContain('patient/Patient.read')
  })

  it('encrypts the access token at rest (plaintext not stored)', async () => {
    await expect(
      selectPatientForMockLaunch(buildFormData('patient-jordan-avery')),
    ).rejects.toThrow('NEXT_REDIRECT')
    const row = rows[0]
    expect(row.accessTokenEnc).not.toBe('mock-token-for-patient-jordan-avery')
    expect(row.accessTokenEnc).not.toContain('mock-token-for-patient-jordan-avery')
    // base64 length sanity — at least IV+ciphertext+authTag.
    expect(row.accessTokenEnc.length).toBeGreaterThan(40)
  })

  it('sets a signed httpOnly session cookie', async () => {
    await expect(
      selectPatientForMockLaunch(buildFormData('patient-sam-rodriguez')),
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(cookiesSetSpy).toHaveBeenCalledTimes(1)
    const cookieArg = cookiesSetSpy.mock.calls[0][0]
    expect(cookieArg.name).toBe('smart_session')
    expect(typeof cookieArg.value).toBe('string')
    expect(cookieArg.httpOnly).toBe(true)
    expect(cookieArg.sameSite).toBe('lax')
    expect(cookieArg.path).toBe('/')
  })

  it('redirects through next/navigation.redirect to /queue?patient=...', async () => {
    await expect(
      selectPatientForMockLaunch(buildFormData('patient-eleanor-vance')),
    ).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectSpy).toHaveBeenCalledTimes(1)
    const target = redirectSpy.mock.calls[0][0]
    expect(target).toBe('/queue?patient=patient-eleanor-vance')
  })
})
