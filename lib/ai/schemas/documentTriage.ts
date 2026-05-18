import { z } from 'zod'

/**
 * Wire schemas for the FastAPI `/triage-documents` endpoint.
 *
 * Mirrors `services/ai/document_triage.py` Pydantic models field-for-field.
 * Run-time validate the FastAPI response with `TriageResponseSchema.parse()`
 * before returning to callers (defense in depth across the HTTP hop, per
 * AI_INTEGRATION.md "Strict structured outputs" rule).
 */

export const CriterionMetaSchema = z.object({
  id: z.string(),
  text: z.string(),
  evidence_hint: z.string().nullish(),
  required_codes: z.array(z.string()).default([]),
})
export type TriageCriterionMeta = z.infer<typeof CriterionMetaSchema>

export const DocMetaSchema = z.object({
  id: z.string(),
  fhir_id: z.string(),
  doc_type: z.string().default(''),
  authored_at: z.string().default(''),
  author_role: z.string().default(''),
  snippet: z.string().default(''),
})
export type TriageDocMeta = z.infer<typeof DocMetaSchema>

export const TriageRequestSchema = z.object({
  criteria: z.array(CriterionMetaSchema),
  documents: z.array(DocMetaSchema),
  pa_id: z.string().nullish(),
  provider_id: z.string().nullish(),
  top_k: z.number().int().positive().default(5),
  threshold: z.number().min(0).max(1).default(0.4),
})
export type TriageRequest = z.infer<typeof TriageRequestSchema>

export const RelevanceScoreSchema = z.object({
  criterion_id: z.string(),
  document_id: z.string(),
  score: z.number().min(0).max(1),
  reasoning: z.string().default(''),
  recommended_for_extraction: z.boolean().default(false),
})
export type RelevanceScore = z.infer<typeof RelevanceScoreSchema>

export const TriageResponseSchema = z.object({
  scores: z.array(RelevanceScoreSchema),
  prompt_version: z.string(),
  model: z.string(),
  trace_id: z.string().nullish(),
  cached: z.boolean().default(false),
})
export type TriageResponse = z.infer<typeof TriageResponseSchema>
