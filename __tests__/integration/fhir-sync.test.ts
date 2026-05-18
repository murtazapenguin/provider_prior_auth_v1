/**
 * __tests__/integration/fhir-sync.test.ts
 *
 * Phase 6 integration test: `syncPatientFromFhir` end-to-end against the
 * mock FHIR adapter for each of the four demo patients.
 *
 * Why this lives outside `__tests__/lib/` — it crosses multiple modules
 * (mock adapter + mappers + Prisma upserts inside a transaction). Pure-mapper
 * tests live under `__tests__/lib/domain/mappers/`.
 *
 * Strategy:
 *   1. vi.mock('@/lib/db/client') with an in-memory Prisma fake that
 *      supports the calls `syncPatientFromFhir` actually makes:
 *        - patient.findUnique, patient.upsert
 *        - encounter.findUnique, encounter.upsert
 *        - coverage.findMany, coverage.upsert
 *        - provider.findUnique, provider.upsert
 *        - payer.findUnique
 *        - $transaction(callback)
 *   2. Pass an explicit `adapter` arg into `syncPatientFromFhir` to bypass
 *      the FHIR_MODE env switch — keeps the test deterministic and lets us
 *      spy on individual adapter calls.
 *   3. Assert: Prisma rows match expected shape; second call within TTL
 *      doesn't re-fetch; force=true bypasses TTL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

/* ───────────────────────────────────────────────────────────────────────────
 *  Fake Prisma store + module mock
 *  Tables: patient, encounter, coverage, provider, payer
 *  Behavior: in-memory upsert (id-keyed), $transaction passes the same
 *  object as the tx client so model.* calls inside the callback hit the
 *  same store.
 *
 *  vi.mock factories are hoisted above the test file's top level — they
 *  cannot reference outer `const`s. We work around that by attaching the
 *  fake store + client to `globalThis` inside the factory itself and
 *  reading them back from the test body.
 * ───────────────────────────────────────────────────────────────────────── */

vi.mock('@/lib/db/client', () => {
  type Row = Record<string, unknown>
  const stores: Record<string, Map<string, Row>> = {
    patient: new Map(),
    encounter: new Map(),
    coverage: new Map(),
    provider: new Map(),
    payer: new Map(),
  }
  function table(name: string) {
    return {
      findUnique: vi.fn(async (args: { where: { id?: string; shortCode?: string } }) => {
        if (args.where.id) return stores[name].get(args.where.id) ?? null
        if (args.where.shortCode) {
          return (
            Array.from(stores[name].values()).find((r) => r.shortCode === args.where.shortCode) ?? null
          )
        }
        return null
      }),
      findMany: vi.fn(async (args: { where?: Record<string, unknown> } = {}) => {
        const rows = Array.from(stores[name].values())
        if (!args.where) return rows
        return rows.filter((r) =>
          Object.entries(args.where!).every(([key, val]) => (r as Record<string, unknown>)[key] === val),
        )
      }),
      upsert: vi.fn(async (args: { where: { id: string }; create: Row; update: Row }) => {
        const existing = stores[name].get(args.where.id)
        const next = existing ? { ...existing, ...args.update } : { ...args.create }
        stores[name].set(args.where.id, next)
        return next
      }),
    }
  }
  const prisma = {
    patient: table('patient'),
    encounter: table('encounter'),
    coverage: table('coverage'),
    provider: table('provider'),
    payer: table('payer'),
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
  }
  // Expose the mock + stores for the test body.
  ;(globalThis as Record<string, unknown>).__fhirSyncFakePrisma = prisma
  ;(globalThis as Record<string, unknown>).__fhirSyncFakeStores = stores
  return { prisma }
})

// Pull the hoisted mock state back out for use in the test body.
const fakePrisma = (globalThis as Record<string, unknown>).__fhirSyncFakePrisma as {
  patient: { upsert: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> }
  encounter: { upsert: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> }
  coverage: { upsert: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> }
  provider: { upsert: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> }
  payer: { findUnique: ReturnType<typeof vi.fn> }
  $transaction: ReturnType<typeof vi.fn>
}
const stores = (globalThis as Record<string, unknown>).__fhirSyncFakeStores as Record<
  string,
  Map<string, Record<string, unknown>>
>
const store = {
  patient: stores.patient,
  encounter: stores.encounter,
  coverage: stores.coverage,
  provider: stores.provider,
  payer: stores.payer,
}

/* ───────────────────────────────────────────────────────────────────────────
 *  Imports (after mocks)
 * ───────────────────────────────────────────────────────────────────────── */

import {
  syncPatientFromFhir,
  PATIENT_TTL_MS,
  COVERAGE_TTL_MS,
  type FhirAdapter,
} from '@/lib/domain/syncFromFhir'
import * as mockFhir from '@/lib/fhir/mock'
import type { SmartSessionLike } from '@/lib/fhir/client'

/* ───────────────────────────────────────────────────────────────────────────
 *  Helpers
 * ───────────────────────────────────────────────────────────────────────── */

function makeSession(): SmartSessionLike {
  return {
    sessionToken: 'test-token',
    accessToken: 'test-access',
    iss: 'https://fhir.example/api/FHIR/R4',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  }
}

/**
 * Wrap the mock module so each adapter method is a spy we can assert on.
 * Each fresh call to this resets call counts.
 */
function makeSpyAdapter(): FhirAdapter & { _spies: Record<string, ReturnType<typeof vi.fn>> } {
  const spies = {
    getPatient: vi.fn(mockFhir.getPatient),
    getEncounter: vi.fn(mockFhir.getEncounter),
    searchEncounters: vi.fn(mockFhir.searchEncounters),
    searchCoverages: vi.fn(mockFhir.searchCoverages),
    getPractitioner: vi.fn(mockFhir.getPractitioner),
    searchServiceRequests: vi.fn(mockFhir.searchServiceRequests),
    searchDocumentReferences: vi.fn(mockFhir.searchDocumentReferences),
  }
  return {
    getPatient: spies.getPatient,
    getEncounter: spies.getEncounter,
    searchEncounters: spies.searchEncounters,
    searchCoverages: spies.searchCoverages,
    getPractitioner: spies.getPractitioner,
    searchServiceRequests: spies.searchServiceRequests,
    searchDocumentReferences: spies.searchDocumentReferences,
    _spies: spies,
  }
}

function resetStore() {
  store.patient.clear()
  store.encounter.clear()
  store.coverage.clear()
  store.provider.clear()
  store.payer.clear()
  // Seed the demo Payer rows so coverage lookups resolve.
  store.payer.set('payer-uhc', { id: 'payer-uhc', name: 'United Healthcare', shortCode: 'UHC' })
  store.payer.set('payer-cms', { id: 'payer-cms', name: 'Medicare (CMS)', shortCode: 'CMS' })
}

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
})

/* ───────────────────────────────────────────────────────────────────────────
 *  Tests
 * ───────────────────────────────────────────────────────────────────────── */

describe('syncPatientFromFhir — Jordan Avery (head-ct)', () => {
  it('populates Patient, Encounter, Provider, Coverage rows from the mock adapter', async () => {
    const adapter = makeSpyAdapter()
    const result = await syncPatientFromFhir(makeSession(), 'patient-jordan-avery', {
      encounterId: 'encounter-head-ct',
      adapter,
    })

    // Returned contract shape.
    expect(result.patient.id).toBe('patient-jordan-avery')
    expect(result.patient.firstName).toBe('Jordan')
    expect(result.patient.lastName).toBe('Avery')
    expect(result.patient.sex).toBe('female')
    expect(result.patient.fhirResourceId).toBe('patient-jordan-avery')
    expect(result.patient.fhirVersionId).toBe('1')
    expect(result.patient.lastFetchedAt).toBeInstanceOf(Date)

    expect(result.encounter?.id).toBe('encounter-head-ct')
    expect(result.encounter?.placeOfService).toBe('11')
    expect(result.encounter?.providerId).toBe('provider-pcp-sarah-chen')
    expect(result.encounter?.fhirResourceId).toBe('encounter-head-ct')

    expect(result.coverages).toHaveLength(1)
    expect(result.coverages[0].planName).toBe('Choice Plus')
    expect(result.coverages[0].memberId).toBe('UHC9JA00142')
    expect(result.coverages[0].groupNumber).toBe('GRP-00142')
    expect(result.coverages[0].benefitCategory).toBe('Medical')
    expect(result.coverages[0].payerId).toBe('payer-uhc')

    expect(result.serviceRequests).toHaveLength(1)
    expect(result.serviceRequests[0].id).toBe('sr-headct-jordan-1')
    expect(result.serviceRequests[0].code?.coding?.[0]?.code).toBe('70450')

    expect(result.provider?.id).toBe('provider-pcp-sarah-chen')
    expect(result.provider?.npi).toBe('1234567890')
    expect(result.provider?.specialty).toBe('Internal Medicine')
  })

  it('writes through the $transaction wrapper exactly once', async () => {
    const adapter = makeSpyAdapter()
    await syncPatientFromFhir(makeSession(), 'patient-jordan-avery', {
      encounterId: 'encounter-head-ct',
      adapter,
    })
    expect(fakePrisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('does not re-fetch from FHIR on a second call within TTL', async () => {
    const adapter = makeSpyAdapter()
    await syncPatientFromFhir(makeSession(), 'patient-jordan-avery', {
      encounterId: 'encounter-head-ct',
      adapter,
    })
    expect(adapter._spies.getPatient).toHaveBeenCalledTimes(1)
    expect(adapter._spies.getEncounter).toHaveBeenCalledTimes(1)
    expect(adapter._spies.searchCoverages).toHaveBeenCalledTimes(1)
    expect(adapter._spies.getPractitioner).toHaveBeenCalledTimes(1)

    // Second call within TTL — Patient/Coverage/Practitioner should NOT
    // re-fetch. Encounter has a 5-min TTL, so within seconds it shouldn't
    // re-fetch either.
    await syncPatientFromFhir(makeSession(), 'patient-jordan-avery', {
      encounterId: 'encounter-head-ct',
      adapter,
    })

    expect(adapter._spies.getPatient).toHaveBeenCalledTimes(1)
    expect(adapter._spies.searchCoverages).toHaveBeenCalledTimes(1)
    expect(adapter._spies.getPractitioner).toHaveBeenCalledTimes(1)
    expect(adapter._spies.getEncounter).toHaveBeenCalledTimes(1)
    // ServiceRequest search runs unconditionally — orders can change rapidly.
    expect(adapter._spies.searchServiceRequests).toHaveBeenCalledTimes(2)
  })

  it('force=true bypasses TTL and re-fetches every resource', async () => {
    const adapter = makeSpyAdapter()
    await syncPatientFromFhir(makeSession(), 'patient-jordan-avery', {
      encounterId: 'encounter-head-ct',
      adapter,
    })
    expect(adapter._spies.getPatient).toHaveBeenCalledTimes(1)

    await syncPatientFromFhir(makeSession(), 'patient-jordan-avery', {
      encounterId: 'encounter-head-ct',
      adapter,
      force: true,
    })
    expect(adapter._spies.getPatient).toHaveBeenCalledTimes(2)
    expect(adapter._spies.getEncounter).toHaveBeenCalledTimes(2)
    expect(adapter._spies.searchCoverages).toHaveBeenCalledTimes(2)
  })

  it('re-fetches the Patient when its lastFetchedAt is older than the TTL', async () => {
    const adapter = makeSpyAdapter()

    // Initial sync.
    await syncPatientFromFhir(makeSession(), 'patient-jordan-avery', {
      encounterId: 'encounter-head-ct',
      adapter,
    })
    expect(adapter._spies.getPatient).toHaveBeenCalledTimes(1)

    // Move the lastFetchedAt back in time so the next call sees a stale row.
    const stale = new Date(Date.now() - PATIENT_TTL_MS - 1000)
    const existing = store.patient.get('patient-jordan-avery')!
    store.patient.set('patient-jordan-avery', { ...existing, lastFetchedAt: stale })
    for (const cov of store.coverage.values()) {
      store.coverage.set(cov.id as string, {
        ...cov,
        lastFetchedAt: new Date(Date.now() - COVERAGE_TTL_MS - 1000),
      })
    }

    await syncPatientFromFhir(makeSession(), 'patient-jordan-avery', {
      encounterId: 'encounter-head-ct',
      adapter,
    })
    expect(adapter._spies.getPatient).toHaveBeenCalledTimes(2)
    expect(adapter._spies.searchCoverages).toHaveBeenCalledTimes(2)
  })
})

describe('syncPatientFromFhir — Sam Rodriguez (knee MRI)', () => {
  it('maps the orthopedic encounter and provider', async () => {
    const adapter = makeSpyAdapter()
    const result = await syncPatientFromFhir(makeSession(), 'patient-sam-rodriguez', {
      encounterId: 'encounter-knee-mri',
      adapter,
    })
    expect(result.patient.firstName).toBe('Sam')
    expect(result.encounter?.id).toBe('encounter-knee-mri')
    expect(result.encounter?.providerId).toBe('provider-ortho-james-patel')
    expect(result.provider?.specialty).toBe('Orthopedic Surgery')
    expect(result.coverages[0].planName).toBe('Choice Plus')
  })
})

describe('syncPatientFromFhir — Priya Shah (botox)', () => {
  it('maps the neurology encounter and provider', async () => {
    const adapter = makeSpyAdapter()
    const result = await syncPatientFromFhir(makeSession(), 'patient-priya-shah', {
      encounterId: 'encounter-botox',
      adapter,
    })
    expect(result.patient.firstName).toBe('Priya')
    expect(result.encounter?.providerId).toBe('provider-neuro-aisha-washington')
    expect(result.provider?.specialty).toBe('Neurology')
  })
})

describe('syncPatientFromFhir — Eleanor Vance (power wheelchair)', () => {
  it('maps the PM&R encounter and Medicare Advantage coverage', async () => {
    const adapter = makeSpyAdapter()
    const result = await syncPatientFromFhir(makeSession(), 'patient-eleanor-vance', {
      encounterId: 'encounter-power-wheelchair',
      adapter,
    })
    expect(result.patient.firstName).toBe('Eleanor')
    expect(result.encounter?.providerId).toBe('provider-pmr-robert-klein')
    expect(result.provider?.specialty).toBe('Physical Medicine & Rehabilitation')
    expect(result.coverages[0].planName).toBe('Heritage Medicare Advantage HMO - Premier')
    expect(result.coverages[0].memberId).toBe('UHC9EV00713')
    expect(result.coverages[0].groupNumber).toBe('GRP-MA-00713')
  })
})

describe('syncPatientFromFhir — adapter selection', () => {
  it('throws a clear error when the patient is unknown to the mock adapter', async () => {
    const adapter = makeSpyAdapter()
    await expect(
      syncPatientFromFhir(makeSession(), 'patient-does-not-exist', { adapter }),
    ).rejects.toMatchObject({ code: 'fhir_request_failed' })
  })
})
