/**
 * Uploaded-attachment ingest trigger.
 *
 * `triggerIngestForAttachment()` POSTs to the sidecar's `/ingest-attachment`
 * route, which fetches the S3-uploaded file (already PUT by the client),
 * OCRs it via Textract, renders page images, uploads the PNGs back to S3,
 * and returns the pdfviewer-data shape + extracted text. The caller (the
 * Next.js upload route) writes the resulting payload onto the Attachment row.
 *
 * Idempotent on (attachment_id, content_sha256) via the sidecar's
 * ai_call_cache layer — re-ingesting the same content is a free hit.
 */

import { aiFetch } from './penguinClient'
import {
  IngestAttachmentResponseSchema,
  type IngestAttachmentRequest,
  type IngestAttachmentResponse,
} from './schemas/attachmentIntake'

export type {
  IngestAttachmentRequest,
  IngestAttachmentResponse,
  PageImages,
} from './schemas/attachmentIntake'

export class AttachmentIntakeError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'AttachmentIntakeError'
  }
}

export async function triggerIngestForAttachment(
  req: IngestAttachmentRequest,
): Promise<IngestAttachmentResponse> {
  const raw = await aiFetch<unknown>('/ingest-attachment', req)
  return IngestAttachmentResponseSchema.parse(raw)
}
