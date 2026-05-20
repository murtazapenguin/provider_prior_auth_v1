import { z } from 'zod'

/**
 * Wire schemas for the FastAPI `/ingest-attachment` endpoint.
 *
 * Mirrors `services/ai/attachment_intake.py` Pydantic models field-for-field.
 * Run-time validate the FastAPI response with
 * `IngestAttachmentResponseSchema.parse()` before returning to callers
 * (defense in depth across the HTTP hop — same rule as documentIntake).
 */

export const IngestAttachmentRequestSchema = z.object({
  pa_id: z.string(),
  attachment_id: z.string(),
  s3_key: z.string(),
  filename: z.string(),
  mime_type: z.string().default('application/pdf'),
})
export type IngestAttachmentRequest = z.infer<typeof IngestAttachmentRequestSchema>

// Canonical pdfviewer-data shape (matches the contract under
// penguinai-claude-artifacts-main/.claude/contracts/pdfviewer-data.md).
export const PageImagesSchema = z.object({
  files: z.array(z.string()),
  presigned_urls: z.record(z.string(), z.record(z.string(), z.string())),
})
export type PageImages = z.infer<typeof PageImagesSchema>

export const IngestAttachmentResponseSchema = z.object({
  pdf_url: z.string(),
  page_images: PageImagesSchema,
  ocr_line_count: z.number().int().nonnegative(),
  extracted_text: z.string(),
  cached: z.boolean().default(false),
})
export type IngestAttachmentResponse = z.infer<typeof IngestAttachmentResponseSchema>
