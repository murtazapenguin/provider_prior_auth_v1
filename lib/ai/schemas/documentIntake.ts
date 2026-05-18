import { z } from 'zod'

/**
 * Wire schemas for the FastAPI `/ingest-documents` endpoint.
 *
 * Mirrors `services/ai/document_intake.py` Pydantic models field-for-field.
 * Run-time validate the FastAPI response with `IngestDocumentsResponseSchema.parse()`
 * before returning to callers (defense in depth across the HTTP hop, per
 * AI_INTEGRATION.md "Strict structured outputs" rule).
 */

export const DocRefRefSchema = z.object({
  fhir_id: z.string(),
  version_id: z.string(),
  content_type: z.string(),
  title: z.string().default(''),
  // Base64-encoded Binary bytes — TS wrapper base64s the Buffer it gets from
  // `lib/fhir/documentReference.fetchBinary`.
  content_b64: z.string(),
})
export type DocRefRef = z.infer<typeof DocRefRefSchema>

export const IngestedDocumentRowSchema = z.object({
  id: z.string(),
  fhir_resource_id: z.string(),
  fhir_version_id: z.string(),
  fhir_content_type: z.string(),
  ocr_line_count: z.number().int().nonnegative(),
  pdf_url: z.string(),
  cached: z.boolean().default(false),
})
export type IngestedDocumentRow = z.infer<typeof IngestedDocumentRowSchema>

export const IngestDocumentsRequestSchema = z.object({
  pa_id: z.string(),
  encounter_id: z.string(),
  document_references: z.array(DocRefRefSchema),
})
export type IngestDocumentsRequest = z.infer<typeof IngestDocumentsRequestSchema>

export const IngestDocumentsResponseSchema = z.object({
  pa_id: z.string(),
  documents: z.array(IngestedDocumentRowSchema),
})
export type IngestDocumentsResponse = z.infer<typeof IngestDocumentsResponseSchema>
