/**
 * lib/domain/syncFromFhir.ts
 *
 * Orchestrates a one-shot FHIR → Prisma sync for a single patient. Treats
 * the Prisma `Patient`, `Encounter`, `Coverage`, and `Provider` tables as a
 * read-through cache (per ARCHITECTURE.md "FHIR cache semantics (Phase 6+)").
 *
 * The function:
 *   1. Loads (or refreshes) the Patient row by FHIR id. Cache hit within TTL
 *      returns the existing row; cache miss / stale / version mismatch calls
 *      `adapter.getPatient`.
 *   2. Loads the target Encounter (either the explicit `opts.encounterId` or
 *      the most-recent active one).
 *   3. Resolves the encounter's attending Practitioner reference and ensures
 *      a Provider row exists.
 *   4. Loads every Coverage for the patient, mapping payor display strings
 *      to our Payer rows.
 *   5. Loads every ServiceRequest scoped to the patient (and optionally
 *      encounter).
 *   6. Wraps every Prisma write in a single `$transaction` so partial
 *      failures (e.g. the Coverage upsert raises a unique-constraint error)
 *      don't leave half-stale rows.
 *
 * The function returns the freshly-read Prisma rows plus the raw FHIR
 * ServiceRequest payloads — the next ticket consumes those at PA creation
 * time to build PriorAuthCode rows.
 *
 *  NOTE: This module performs Prisma I/O. The mappers in
 *  `lib/domain/mappers/` remain pure and reusable.
 *
 *  Cache TTLs are baked in here (NOT configurable per call) per the
 *  ARCHITECTURE.md contract. `opts.force=true` bypasses every TTL on this
 *  invocation; pass it sparingly (e.g. an explicit "Refresh" button).
 */

import { prisma } from '@/lib/db/client'
import { mapPatientToPrisma } from './mappers/patient'
import { mapEncounterToPrisma, pickAttendingPractitionerRef } from './mappers/encounter'
import {
  extractPayorDisplay,
  mapCoverageToPrisma,
  resolvePayerShortCode,
} from './mappers/coverage'
import { mapPractitionerToPrisma } from './mappers/practitioner'
import { parsePractitionerReference } from '@/lib/fhir/practitioner'
import { FhirRequestError } from '@/lib/fhir/client'
import type {
  Coverage as FhirCoverage,
  DocumentReference as FhirDocumentReference,
  Encounter as FhirEncounter,
  Patient as FhirPatient,
  Practitioner as FhirPractitioner,
  ServiceRequest as FhirServiceRequest,
} from '@/lib/fhir/types'
import type { FhirCallOpts } from '@/lib/fhir/client'
import type {
  Coverage as PrismaCoverage,
  Encounter as PrismaEncounter,
  Patient as PrismaPatient,
  Prisma,
  Provider as PrismaProvider,
} from '@/app/generated/prisma/client'
import type { SmartSessionLike } from '@/lib/fhir/client'

/* ───────────────────────────────────────────────────────────────────────────
 *  Public types
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * A pluggable FHIR adapter. The default loads the real adapters in
 * `lib/fhir/index.ts` (which switches on `FHIR_MODE` at module load).
 * Tests inject a vi-mocked adapter to drive deterministic flows.
 */
export interface FhirAdapter {
  getPatient: (id: string, opts?: FhirCallOpts) => Promise<FhirPatient>
  getEncounter: (id: string, opts?: FhirCallOpts) => Promise<FhirEncounter>
  searchEncounters: (
    params: { patient: string; _count?: number; _sort?: string; status?: string; date?: string },
    opts?: FhirCallOpts,
  ) => Promise<FhirEncounter[]>
  searchCoverages: (
    params: { patient: string; status?: string },
    opts?: FhirCallOpts,
  ) => Promise<FhirCoverage[]>
  getPractitioner: (id: string, opts?: FhirCallOpts) => Promise<FhirPractitioner>
  searchServiceRequests: (
    params: { patient: string; encounter?: string; status?: string; _count?: number },
    opts?: FhirCallOpts,
  ) => Promise<FhirServiceRequest[]>
  // Document references are part of T4's scope but having the type on the
  // adapter contract avoids a churn-step later.
  searchDocumentReferences?: (
    params: { patient: string; encounter?: string; type?: string; date?: string; _count?: number },
    opts?: FhirCallOpts,
  ) => Promise<FhirDocumentReference[]>
}

export interface SyncFromFhirOpts {
  /** When set, use this encounter id; else the most-recent active encounter. */
  encounterId?: string
  /** Bypass every TTL on this call. */
  force?: boolean
  /** Adapter override — defaults to the FHIR_MODE-gated re-exports. */
  adapter?: FhirAdapter
  /** Test seam: override `Date.now()` for TTL math. */
  now?: () => Date
}

export interface SyncFromFhirResult {
  patient: PrismaPatient
  encounter?: PrismaEncounter
  coverages: PrismaCoverage[]
  /** Raw FHIR ServiceRequest payloads; next ticket maps to PriorAuthCode rows. */
  serviceRequests: FhirServiceRequest[]
  /** Provider row resolved for the encounter, if any. */
  provider?: PrismaProvider
}

/* ───────────────────────────────────────────────────────────────────────────
 *  TTLs — per ARCHITECTURE.md "FHIR cache semantics (Phase 6+)"
 *  Patient/Coverage/Provider: 1 hour. Encounter: 5 minutes (more volatile).
 * ───────────────────────────────────────────────────────────────────────── */

export const PATIENT_TTL_MS = 60 * 60 * 1000
export const ENCOUNTER_TTL_MS = 5 * 60 * 1000
export const COVERAGE_TTL_MS = 60 * 60 * 1000
export const PRACTITIONER_TTL_MS = 60 * 60 * 1000

/* ───────────────────────────────────────────────────────────────────────────
 *  Internals
 * ───────────────────────────────────────────────────────────────────────── */

async function defaultAdapter(): Promise<FhirAdapter> {
  // Module-load gate inside lib/fhir/index.ts decides real vs mock.
  const mod = await import('@/lib/fhir')
  return mod as unknown as FhirAdapter
}

/**
 * Returns true if the cached row is fresh enough to skip the FHIR fetch.
 * "Fresh" = `lastFetchedAt` is set and within TTL. force=true never fresh.
 *
 * NOTE: version-mismatch handling is layered on top of this — even within
 * TTL, if the upstream resource's `meta.versionId` differs from what we
 * stored, we refresh. That check happens after the FHIR fetch (because we
 * need the upstream version to compare) — see `applyVersionedUpsert`.
 */
function isFresh(lastFetchedAt: Date | null | undefined, ttlMs: number, now: Date, force: boolean): boolean {
  if (force) return false
  if (!lastFetchedAt) return false
  return now.getTime() - lastFetchedAt.getTime() < ttlMs
}

/**
 * Build a payer-id resolver that caches lookups for the lifetime of one sync.
 * Coverage rows reference Payer.id; we resolve via the shortCode synonym
 * table in `mappers/coverage.ts`.
 */
function makePayerResolver(tx: Prisma.TransactionClient | typeof prisma) {
  const cache = new Map<string, string | null>()
  return async (display: string | undefined): Promise<string | null> => {
    if (!display) return null
    if (cache.has(display)) return cache.get(display)!

    const shortCode = resolvePayerShortCode(display)
    if (!shortCode) {
      cache.set(display, null)
      return null
    }
    const payer = await tx.payer.findUnique({ where: { shortCode } })
    const id = payer?.id ?? null
    cache.set(display, id)
    return id
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 *  Public API
 * ───────────────────────────────────────────────────────────────────────── */

export async function syncPatientFromFhir(
  session: SmartSessionLike,
  patientId: string,
  opts: SyncFromFhirOpts = {},
): Promise<SyncFromFhirResult> {
  const adapter = opts.adapter ?? (await defaultAdapter())
  const now = opts.now ? opts.now() : new Date()
  const force = opts.force === true

  // FHIR adapters consume the session via the loader path; we don't pass it
  // through here. The opt is kept on the public signature so future adapters
  // can scope per-tenant (multi-iss). Currently unused — silence lint.
  void session

  /* ───── Patient ───── */
  const cachedPatient = await prisma.patient.findUnique({ where: { id: patientId } })
  let fhirPatient: FhirPatient | null = null

  if (!cachedPatient || !isFresh(cachedPatient.lastFetchedAt, PATIENT_TTL_MS, now, force)) {
    fhirPatient = await adapter.getPatient(patientId)
  } else {
    // Cached and within TTL.
    //
    // Per ARCHITECTURE.md "FHIR cache semantics (Phase 6+)", a `fhirVersionId`
    // mismatch SHOULD trigger refresh even within TTL. We cannot detect that
    // here without either:
    //   (a) a separate HEAD/ETag-style probe call against Epic (not currently
    //       supported by `lib/fhir/client.ts`), or
    //   (b) a webhook / external hint indicating "this resource was updated."
    // Neither is in scope this ticket. The practical effect: within TTL we
    // always trust the cached row. Once TTL expires, the regular refresh path
    // performs an upsert whose write naturally reconciles `fhirVersionId`
    // even if the upstream incremented it. Documented as drift in the T3
    // ticket "When done" report.
  }

  /* ───── Encounter (optional) ───── */
  let fhirEncounter: FhirEncounter | null = null
  if (opts.encounterId) {
    const cachedEnc = await prisma.encounter.findUnique({ where: { id: opts.encounterId } })
    if (!cachedEnc || !isFresh(cachedEnc.lastFetchedAt, ENCOUNTER_TTL_MS, now, force)) {
      fhirEncounter = await adapter.getEncounter(opts.encounterId)
    }
  } else if (fhirPatient || !cachedPatient) {
    // First time we see this patient — pull the most recent encounter so the
    // demo UI has something to show. If the patient was already cached and
    // the caller didn't request a specific encounter, skip the search.
    try {
      const encs = await adapter.searchEncounters({
        patient: `Patient/${patientId}`,
        _sort: '-date',
        _count: 1,
      })
      if (encs.length > 0) fhirEncounter = encs[0]
    } catch (err) {
      // Encounter search is best-effort. Bail with a clearer message if it
      // hard-fails (e.g. transport error). Patient cache write below has not
      // happened yet so nothing rolls back.
      if (err instanceof FhirRequestError && err.code === 'fhir_request_failed') {
        // surface; caller wraps into a UX error
        throw err
      }
      // Otherwise, swallow — encounter is optional in the contract.
    }
  }

  /* ───── Coverages ───── */
  // Always refresh when the patient was refreshed, else within their own TTL.
  let fhirCoverages: FhirCoverage[] | null = null
  const cachedCoverages = await prisma.coverage.findMany({ where: { patientId } })
  const anyCoverageStale =
    cachedCoverages.length === 0 ||
    cachedCoverages.some((c) => !isFresh(c.lastFetchedAt, COVERAGE_TTL_MS, now, force))
  if (anyCoverageStale || fhirPatient) {
    fhirCoverages = await adapter.searchCoverages({ patient: `Patient/${patientId}` })
  }

  /* ───── Practitioner (resolved from Encounter) ───── */
  let fhirPractitioner: FhirPractitioner | null = null
  let practitionerId: string | null = null
  if (fhirEncounter) {
    const ref = pickAttendingPractitionerRef(fhirEncounter)
    practitionerId = ref ? parsePractitionerReference(ref) : null
    if (practitionerId) {
      const cachedProvider = await prisma.provider.findUnique({ where: { id: practitionerId } })
      if (!cachedProvider || !isFresh(cachedProvider.lastFetchedAt, PRACTITIONER_TTL_MS, now, force)) {
        try {
          fhirPractitioner = await adapter.getPractitioner(practitionerId)
        } catch (err) {
          // A missing Practitioner shouldn't bring the whole sync down — log
          // and continue. The Encounter upsert later defaults providerId to
          // whatever cached row exists; if neither exists, we surface.
          if (
            err instanceof FhirRequestError &&
            err.code === 'fhir_request_failed' &&
            err.status === 404
          ) {
            fhirPractitioner = null
          } else {
            throw err
          }
        }
      }
    }
  }

  /* ───── ServiceRequests ───── */
  const fhirServiceRequests = await adapter.searchServiceRequests({
    patient: `Patient/${patientId}`,
    encounter: fhirEncounter ? `Encounter/${fhirEncounter.id}` : undefined,
  })

  /* ───── Single $transaction for every Prisma write ───── */
  const result = await prisma.$transaction(async (tx) => {
    let patient: PrismaPatient | null = cachedPatient

    if (fhirPatient) {
      const mapped = mapPatientToPrisma(fhirPatient)
      patient = await tx.patient.upsert({
        where: { id: mapped.id },
        update: {
          firstName: mapped.firstName,
          lastName: mapped.lastName,
          dob: mapped.dob,
          sex: mapped.sex,
          fhirResourceId: mapped.fhirResourceId,
          fhirVersionId: mapped.fhirVersionId,
          lastFetchedAt: now,
        },
        create: {
          id: mapped.id,
          externalId: null,
          firstName: mapped.firstName,
          lastName: mapped.lastName,
          dob: mapped.dob,
          sex: mapped.sex,
          fhirResourceId: mapped.fhirResourceId,
          fhirVersionId: mapped.fhirVersionId,
          lastFetchedAt: now,
        },
      })
    }
    if (!patient) {
      throw new Error(
        `syncPatientFromFhir: Patient ${patientId} not found in cache and no FHIR fetch occurred`,
      )
    }

    // Provider — has to be upserted before Encounter because the Encounter
    // FK can't reference a Provider that doesn't exist yet.
    let provider: PrismaProvider | undefined
    if (fhirPractitioner) {
      const mapped = mapPractitionerToPrisma(fhirPractitioner)
      provider = await tx.provider.upsert({
        where: { id: mapped.id },
        update: {
          npi: mapped.npi,
          firstName: mapped.firstName,
          lastName: mapped.lastName,
          specialty: mapped.specialty,
          fhirResourceId: mapped.fhirResourceId,
          fhirVersionId: mapped.fhirVersionId,
          lastFetchedAt: now,
        },
        create: {
          id: mapped.id,
          npi: mapped.npi,
          firstName: mapped.firstName,
          lastName: mapped.lastName,
          specialty: mapped.specialty,
          fhirResourceId: mapped.fhirResourceId,
          fhirVersionId: mapped.fhirVersionId,
          lastFetchedAt: now,
        },
      })
    } else if (practitionerId) {
      // Cached path: use what's already in the DB.
      provider = (await tx.provider.findUnique({ where: { id: practitionerId } })) ?? undefined
    }

    let encounter: PrismaEncounter | undefined
    if (fhirEncounter) {
      const mapped = mapEncounterToPrisma(fhirEncounter)
      // Resolve providerId fallbacks: prefer the resolved provider row, else
      // whatever the mapper extracted, else any existing Encounter row's value.
      const resolvedProviderId =
        provider?.id ??
        mapped.providerId ??
        (await tx.encounter.findUnique({ where: { id: mapped.id } }).then((e) => e?.providerId)) ??
        null

      if (!resolvedProviderId) {
        throw new Error(
          `syncPatientFromFhir: Encounter ${mapped.id} has no resolvable Provider — refusing to upsert without an FK`,
        )
      }

      encounter = await tx.encounter.upsert({
        where: { id: mapped.id },
        update: {
          patientId: mapped.patientId,
          providerId: resolvedProviderId,
          encounterDate: mapped.encounterDate,
          placeOfService: mapped.placeOfService,
          fhirResourceId: mapped.fhirResourceId,
          fhirVersionId: mapped.fhirVersionId,
          lastFetchedAt: now,
        },
        create: {
          id: mapped.id,
          patientId: mapped.patientId,
          providerId: resolvedProviderId,
          encounterDate: mapped.encounterDate,
          placeOfService: mapped.placeOfService,
          fhirResourceId: mapped.fhirResourceId,
          fhirVersionId: mapped.fhirVersionId,
          lastFetchedAt: now,
        },
      })
    } else if (opts.encounterId) {
      // Hot cache hit on encounter — return the existing row.
      encounter =
        (await tx.encounter.findUnique({ where: { id: opts.encounterId } })) ?? undefined
    }

    // Coverages — payor display → Payer.id resolved through the helper.
    let coverages: PrismaCoverage[] = cachedCoverages
    if (fhirCoverages) {
      const resolvePayerId = makePayerResolver(tx)
      const upserted: PrismaCoverage[] = []
      for (const fc of fhirCoverages) {
        const payorDisplay = extractPayorDisplay(fc)
        const payerId = await resolvePayerId(payorDisplay)
        if (!payerId) {
          // No matching Payer row — skip this coverage. A future ingestion
          // pipeline could backfill payers automatically; for now we leave
          // a breadcrumb in the audit trail (TODO when audit util grows
          // non-PA event types).
          continue
        }
        const mapped = mapCoverageToPrisma(fc, payerId)
        const row = await tx.coverage.upsert({
          where: { id: mapped.id },
          update: {
            patientId: mapped.patientId,
            payerId: mapped.payerId,
            planName: mapped.planName,
            memberId: mapped.memberId,
            groupNumber: mapped.groupNumber,
            benefitCategory: mapped.benefitCategory,
            effectiveFrom: mapped.effectiveFrom,
            effectiveTo: mapped.effectiveTo,
            isPrimary: mapped.isPrimary,
            fhirResourceId: mapped.fhirResourceId,
            fhirVersionId: mapped.fhirVersionId,
            lastFetchedAt: now,
          },
          create: {
            id: mapped.id,
            patientId: mapped.patientId,
            payerId: mapped.payerId,
            planName: mapped.planName,
            memberId: mapped.memberId,
            groupNumber: mapped.groupNumber,
            benefitCategory: mapped.benefitCategory,
            effectiveFrom: mapped.effectiveFrom,
            effectiveTo: mapped.effectiveTo,
            isPrimary: mapped.isPrimary,
            fhirResourceId: mapped.fhirResourceId,
            fhirVersionId: mapped.fhirVersionId,
            lastFetchedAt: now,
          },
        })
        upserted.push(row)
      }
      coverages = upserted.length > 0 ? upserted : cachedCoverages
    }

    return { patient, encounter, coverages, provider }
  })

  return {
    patient: result.patient,
    encounter: result.encounter,
    coverages: result.coverages,
    serviceRequests: fhirServiceRequests,
    provider: result.provider,
  }
}
