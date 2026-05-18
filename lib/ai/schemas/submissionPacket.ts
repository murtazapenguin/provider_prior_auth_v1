import { z } from 'zod'

export const GeneratePacketResponseSchema = z.object({
  pdf_url: z.string(),
  attachment_id: z.string(),
  generated_at: z.string().datetime().or(z.string()),
  narrative_paragraph: z.string(),
  prompt_version: z.string(),
  model: z.string(),
  trace_id: z.string().nullish(),
  cached: z.boolean().default(false),
  page_count: z.number().int().default(1),
})

export type GeneratePacketResponse = z.infer<typeof GeneratePacketResponseSchema>
