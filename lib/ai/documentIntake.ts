/**
 * Phase 6 — FHIR DocumentReference ingest trigger.
 *
 * `triggerIngestForPa(paId)` is the thin TS wrapper around the FastAPI
 * `/ingest-documents` endpoint.  Responsibilities, in order:
 *
 *   1. Look up the PA → Encounter → Patient chain (Prisma).
 *   2. Search Epic for the encounter's DocumentReferences via `lib/fhir`.
 *   3. Fetch each Binary, base64-encode for the sidecar.
 *   4. POST to `/ingest-documents`; zod-parse the response; return ids.
 *
 * Contract overrides honored (phase-6-foundation session 4):
 *   - Caller MUST run `syncPatientFromFhir` BEFORE this so the Encounter row
 *     exists in our cache.  We do not call sync here — the orchestrator owns
 *     ordering.  We re-assert this invariant by throwing if PA / Encounter
 *     row is missing rather than silently producing nothing.
 *   - Idempotent on (paId, fhirResourceId, fhirVersionId) — second call with
 *     the same versions reuses existing rows server-side.
 */

import { Buffer } from 'node:buffer'

import { prisma } from '@/lib/db/client'
import {
  fetchBinary,
  searchDocumentReferences,
  type DocumentReference,
} from '@/lib/fhir'
import { aiFetch } from './penguinClient'
import {
  IngestDocumentsResponseSchema,
  type IngestDocumentsResponse,
  type IngestedDocumentRow,
} from './schemas/documentIntake'

export type { DocRefRef, IngestedDocumentRow, IngestDocumentsResponse } from './schemas/documentIntake'

export class DocumentIntakeError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'DocumentIntakeError'
  }
}

/**
 * Pull DocumentReferences for a PA's encounter, normalize+OCR+persist them,
 * and return the resulting CachedDocumentReference rows.
 *
 * Idempotency: re-calling with the same PA returns rows with `cached=true`
 * for any DocumentReference whose `(fhirResourceId, fhirVersionId)` already
 * has a row in our cache.  Re-OCR is also cache-hit through `ai_call_cache`.
 */
export async function triggerIngestForPa(paId: string): Promise<IngestedDocumentRow[]> {
  // 1. PA → Encounter → Patient (FK contract on PriorAuth).
  const pa = await prisma.priorAuth.findUnique({
    where: { id: paId },
    include: {
      encounter: { include: { patient: true } },
    },
  })
  if (!pa) throw new DocumentIntakeError(`PriorAuth not found: paId=${paId}`)
  if (!pa.encounter) {
    throw new DocumentIntakeError(
      `PriorAuth.encounter not in cache for paId=${paId}; run syncPatientFromFhir first`,
    )
  }

  const encounterId = pa.encounter.id
  const patientId = pa.encounter.patient.id

  // 2. Search.  Adapter selection (mock vs real) happens inside
  // `lib/fhir/index.ts` based on FHIR_MODE.  The real adapter uses
  // `defaultSessionLoader()` (reads `getCurrentSession()`); the mock adapter
  // ignores the session entirely.
  const documentReferences = await searchDocumentReferences({
    patient: `Patient/${patientId}`,
    encounter: `Encounter/${encounterId}`,
  })

  if (documentReferences.length === 0) {
    return []
  }

  // 3. Fetch + base64 each Binary.  Skips DocumentReferences with no usable
  // attachment URL (defensive — Epic returns this kind of row occasionally).
  const docRefRefs = await Promise.all(
    documentReferences.map(async (doc) => buildDocRefRef(doc)),
  )
  const usable = docRefRefs.filter((d): d is NonNullable<typeof d> => d !== null)
  if (usable.length === 0) {
    return []
  }

  // 4. Sidecar call + zod re-parse.
  const raw = await aiFetch<unknown>('/ingest-documents', {
    pa_id: paId,
    encounter_id: encounterId,
    document_references: usable,
  })
  const parsed: IngestDocumentsResponse = IngestDocumentsResponseSchema.parse(raw)
  return parsed.documents
}

/* ───── internal helpers ──────────────────────────────────────────────────── */

async function buildDocRefRef(doc: DocumentReference) {
  const attachment = doc.content?.[0]?.attachment
  if (!attachment) return null

  const versionId = doc.meta?.versionId ?? '0'
  const contentType = attachment.contentType ?? doc.type?.coding?.[0]?.system ?? 'application/octet-stream'
  const title = attachment.title ?? doc.description ?? ''

  let bytes: Buffer | null = null

  if (attachment.data) {
    // FHIR base64 path — Epic returns this on small Binary resources.
    try {
      bytes = Buffer.from(attachment.data, 'base64')
    } catch {
      bytes = null
    }
  } else if (attachment.url) {
    try {
      bytes = await fetchBinary(attachment.url)
    } catch (err) {
      // Single doc failure is non-fatal — the rest of the PA's docs still ingest.
      // The orchestrator's intake report will simply omit this doc.
      // We don't surface bearer / URL in error message.
      throw new DocumentIntakeError(
        `fetchBinary failed for DocumentReference/${doc.id}: ${(err as Error).message}`,
        err,
      )
    }
  }

  if (!bytes) return null

  return {
    fhir_id: doc.id,
    version_id: versionId,
    content_type: contentType,
    title,
    content_b64: bytes.toString('base64'),
  }
}
