import { z } from 'zod'

export const BboxObjectSchema = z.object({
  document_name: z.string(),
  page_number: z.number().int().positive(),
  bbox: z.array(z.array(z.number()).length(8)),
  line_numbers: z.array(z.number().int()).default([]),
})

export const EvidenceCitationSchema = z.object({
  // Source attribution — Phase 3 embeds these on the citation directly.
  // Phase 2 matchEngine currently reads them from a side-channel (CANNED_RESPONSES);
  // future matchEngine cleanup can read them here instead.
  source_type: z.string().default('clinical_note'),
  source_id: z.string().default(''),
  supporting_texts: z.array(z.string()),
  reasoning: z.string().nullish(),
  confidence: z.number().min(0).max(1),
  bboxes: z.array(BboxObjectSchema),
  line_numbers: z.array(z.number().int()).default([]),
})

export const ExtractEvidenceResponseSchema = z.object({
  criterion_id: z.string(),
  status: z.enum(['passed', 'failed', 'needs_info']),
  // 'rationale' is the TS surface name — matchEngine reads aiResult.rationale.
  // 'reasoning' is the canonical Python-side name; both carry the same value.
  rationale: z.string().nullish(),
  reasoning: z.string().nullish(),
  confidence: z.number().min(0).max(1),
  citations: z.array(EvidenceCitationSchema),
  model: z.string(),
  prompt_version: z.string(),
  cached: z.boolean().default(false),
  trace_id: z.string().nullish(),
  citation_validation: z
    .enum(['all_valid', 'some_invalid', 'none_returned'])
    .default('none_returned'),
})

export type BboxObject = z.infer<typeof BboxObjectSchema>
export type EvidenceCitation = z.infer<typeof EvidenceCitationSchema>
export type ExtractEvidenceResponse = z.infer<typeof ExtractEvidenceResponseSchema>
