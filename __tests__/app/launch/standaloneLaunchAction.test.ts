/**
 * __tests__/app/launch/standaloneLaunchAction.test.ts
 *
 * Tester sign-in server action (`signInAsTester`). Covers:
 *   - rejects when FHIR_MODE != mock
 *   - rejects when EPIC_SANDBOX_FHIR_BASE is unset
 *   - creates a SmartSession row directly (NOT via OAuth callback)
 *   - patientContext + encounterContext are null (tester picks via /pa/new)
 *   - encrypts the access token at rest (plaintext not stored)
 *   - iss is sourced from EPIC_SANDBOX_FHIR_BASE
 *   - sets the signed session cookie
 *   - redirects via next/navigation.redirect
 *
 * Note: the prior `selectPatientForMockLaunch` flow (whitelisted demo
 * patients + /queue?patient=... redirect) was removed when we de-demo'd
 * for expert testing — testers create patients via /pa/new instead.
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

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    set: hoisted.cookiesSetSpy,
  })),
}))

vi.mock('next/navigation', () => ({
  redirect: hoisted.redirectSpy,
}))

import { signInAsTester } from '@/app/launch/standalone/actions'

describe('signInAsTester', () => {
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

  it('rejects when FHIR_MODE is not mock (real Epic launches go through /launch?iss=...)', async () => {
    process.env.FHIR_MODE = 'real'
    await expect(signInAsTester(new FormData())).rejects.toThrow(/mock mode/i)
    expect(rows).toHaveLength(0)
    expect(cookiesSetSpy).not.toHaveBeenCalled()
    expect(redirectSpy).not.toHaveBeenCalled()
  })

  it('rejects when EPIC_SANDBOX_FHIR_BASE is unset', async () => {
    delete process.env.EPIC_SANDBOX_FHIR_BASE
    await expect(signInAsTester(new FormData())).rejects.toThrow(/EPIC_SANDBOX_FHIR_BASE/)
    expect(rows).toHaveLength(0)
  })

  it('creates a SmartSession row with null patient/encounter context', async () => {
    await expect(signInAsTester(new FormData())).rejects.toThrow('NEXT_REDIRECT')
    expect(rows).toHaveLength(1)
    const row = rows[0]
    // No specific patient — the tester picks via /pa/new.
    expect(row.patientContext).toBeNull()
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
    await expect(signInAsTester(new FormData())).rejects.toThrow('NEXT_REDIRECT')
    const row = rows[0]
    expect(row.accessTokenEnc).not.toBe('mock-token-for-tester')
    expect(row.accessTokenEnc).not.toContain('mock-token-for-tester')
    // base64 length sanity — at least IV+ciphertext+authTag.
    expect(row.accessTokenEnc.length).toBeGreaterThan(40)
  })

  it('sets a signed httpOnly session cookie', async () => {
    await expect(signInAsTester(new FormData())).rejects.toThrow('NEXT_REDIRECT')
    expect(cookiesSetSpy).toHaveBeenCalledTimes(1)
    const cookieArg = cookiesSetSpy.mock.calls[0][0]
    expect(cookieArg.name).toBe('smart_session')
    expect(typeof cookieArg.value).toBe('string')
    expect(cookieArg.httpOnly).toBe(true)
    expect(cookieArg.sameSite).toBe('lax')
    expect(cookieArg.path).toBe('/')
  })

  it('redirects through next/navigation.redirect', async () => {
    await expect(signInAsTester(new FormData())).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectSpy).toHaveBeenCalledTimes(1)
    const target = redirectSpy.mock.calls[0][0]
    // computePostLaunchDestination returns /queue when no patient context.
    expect(typeof target).toBe('string')
    expect(target.length).toBeGreaterThan(0)
  })
})
