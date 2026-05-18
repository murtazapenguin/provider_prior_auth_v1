/**
 * lib/fhir/documentReference.ts
 *
 * Typed adapter for FHIR R4 DocumentReference + Binary fetch.
 * Spec: https://www.hl7.org/fhir/R4/documentreference.html
 *
 * Epic quirk: DocumentReference pagination uses `?_count` up to 1000 max.
 * We default to 100 because Epic latency degrades on larger pages and
 * 100 is enough for typical encounter-scoped reads. Caller can override.
 */

import { fhirSearch, fhirFetchBinary, type FhirCallOpts } from './client'
import { DocumentReferenceSchema, type DocumentReference } from './types'

export interface SearchDocumentReferencesParams {
  /** "Patient/{id}" reference. */
  patient: string
  /** "Encounter/{id}" reference. */
  encounter?: string
  /** Document type token, e.g. "http://loinc.org|11506-3". */
  type?: string
  /** Date comparator (ge/lt etc.) e.g. "ge2024-01-01". */
  date?: string
  category?: string
  _count?: number
}

const DEFAULT_COUNT = 100
const MAX_COUNT = 1000

export async function searchDocumentReferences(
  params: SearchDocumentReferencesParams,
  opts: FhirCallOpts = {},
): Promise<DocumentReference[]> {
  const requested = params._count ?? DEFAULT_COUNT
  const count = Math.min(Math.max(requested, 1), MAX_COUNT)

  return fhirSearch<DocumentReference>({
    resourceType: 'DocumentReference',
    searchParams: {
      patient: params.patient,
      encounter: params.encounter,
      type: params.type,
      date: params.date,
      category: params.category,
      _count: String(count),
    },
    entrySchema: DocumentReferenceSchema,
    ...opts,
  })
}

/**
 * Fetch the raw bytes of an attachment. Pass the absolute URL from
 * `DocumentReference.content[0].attachment.url`. Returns a Node Buffer so
 * downstream callers can pipe to S3, OCR, or PyMuPDF without a base64
 * round-trip.
 */
export async function fetchBinary(url: string, opts: FhirCallOpts = {}): Promise<Buffer> {
  return fhirFetchBinary({ url, ...opts })
}
