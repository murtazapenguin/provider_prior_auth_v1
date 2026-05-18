import { z } from 'zod'
import { BboxObjectSchema } from './evidenceExtraction'

export const IngestedCriterionSchema = z.object({
  ordinal: z.number().int(),
  text: z.string(),
  evidence_hint: z.string().nullish(),
  upload_hint: z.string().nullish(),
  group: z.string().nullish(),
  group_operator: z.enum(['ALL', 'ANY']).nullish(),
  source_bboxes: z.array(BboxObjectSchema).default([]),
  source_line_numbers: z.array(z.number().int()).default([]),
})

export const IngestPolicyResponseSchema = z.object({
  policy_id: z.string(),
  criteria: z.array(IngestedCriterionSchema),
  model: z.string(),
  prompt_version: z.string(),
  cached: z.boolean().default(false),
})

export type IngestedCriterion = z.infer<typeof IngestedCriterionSchema>
export type IngestPolicyResponse = z.infer<typeof IngestPolicyResponseSchema>
