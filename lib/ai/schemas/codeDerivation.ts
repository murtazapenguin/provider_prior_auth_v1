import { z } from 'zod'

// ─── Procedure codes (CPT / HCPCS / J / Q) ───────────────────────────────────

export const ProcedureCodeSchema = z.object({
  code_type: z.enum(['CPT', 'HCPCS', 'J', 'Q']),
  code: z.string(),
  modifier: z.string().nullish(),
  description: z.string(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
})

// ─── Diagnosis codes (ICD-10) ─────────────────────────────────────────────────

export const DiagnosisCodeSchema = z.object({
  code_type: z.literal('ICD10'),
  code: z.string(),
  description: z.string(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  is_primary: z.boolean(),
})

// ─── Full request / response shapes ──────────────────────────────────────────

export const NoteSchema = z.object({
  id: z.string(),
  note_type: z.string(),
  author_role: z.string(),
  text: z.string(),
})

export const DeriveCodesRequestSchema = z.object({
  encounter_id: z.string(),
  notes: z.array(NoteSchema),
  indication: z.string().nullish(),
  pa_id: z.string().nullish(),
  provider_id: z.string().nullish(),
})

export const DeriveCodesResponseSchema = z.object({
  procedures: z.array(ProcedureCodeSchema),
  diagnoses: z.array(DiagnosisCodeSchema),
  prompt_version: z.string(),
  trace_id: z.string().nullish(),
  cached: z.boolean().default(false),
})

export type ProcedureCode = z.infer<typeof ProcedureCodeSchema>
export type DiagnosisCode = z.infer<typeof DiagnosisCodeSchema>
export type Note = z.infer<typeof NoteSchema>
export type DeriveCodesRequest = z.infer<typeof DeriveCodesRequestSchema>
export type DeriveCodesResponse = z.infer<typeof DeriveCodesResponseSchema>
