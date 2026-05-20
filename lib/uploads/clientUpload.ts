/**
 * Client-side upload helper — orchestrates the three-step upload flow:
 *
 *   1. POST /api/uploads/presign  → { attachmentId, s3Key, uploadUrl }
 *   2. PUT  <uploadUrl>           → file goes straight to S3 (no function hop)
 *   3. POST /api/pa/[id]/upload   → server triggers sidecar OCR + persists row
 *
 * Why direct-to-S3:
 *   Vercel serverless function request bodies cap at 4.5 MB. A typical
 *   clinical PDF is 1–10 MB. Routing the file through the function would
 *   fail on anything meaningful, so the client uploads directly to S3.
 *
 * Size cap:
 *   Hard-coded at 10 MB here. Server-side has no equivalent enforcement on
 *   the presign endpoint (S3 presigned PUT URLs can't easily encode a
 *   content-length-range condition without switching to POST + form-policy).
 *   The cap exists for cost + UX (Textract scales with pages).
 */

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB

export class UploadError extends Error {
  constructor(message: string, public readonly stage: 'validate' | 'presign' | 's3' | 'ingest') {
    super(message)
    this.name = 'UploadError'
  }
}

export interface UploadAttachmentResult {
  /** The freshly-persisted Attachment row (id, filename, etc.). */
  attachment: {
    id: string
    filename: string
    mimeType: string
    uploadedAt: string
  }
  /** The PA after the post-upload recheck (status may have advanced). */
  pa: {
    id: string
    status: string
  }
  /** The match-engine result that ran after persisting. */
  matchResult?: unknown
}

export async function uploadAttachment(args: {
  paId: string
  file: File
}): Promise<UploadAttachmentResult> {
  const { paId, file } = args

  // ── 1. Client-side validation ────────────────────────────────────────────
  if (file.type !== 'application/pdf') {
    throw new UploadError(
      `Only PDF files are supported (got '${file.type || 'unknown'}'). Convert non-PDF documents before upload.`,
      'validate',
    )
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadError(
      `File too large: ${(file.size / 1024 / 1024).toFixed(1)} MB exceeds the 10 MB cap.`,
      'validate',
    )
  }
  if (file.size === 0) {
    throw new UploadError('File is empty.', 'validate')
  }

  // ── 2. Presign ───────────────────────────────────────────────────────────
  const presignRes = await fetch('/api/uploads/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paId, filename: file.name, mimeType: file.type }),
  })
  if (!presignRes.ok) {
    const body = await presignRes.json().catch(() => ({}))
    throw new UploadError(
      body.detail ?? `Presign failed (HTTP ${presignRes.status})`,
      'presign',
    )
  }
  const { attachmentId, s3Key, uploadUrl } = (await presignRes.json()) as {
    attachmentId: string
    s3Key: string
    uploadUrl: string
  }

  // ── 3. PUT directly to S3 ────────────────────────────────────────────────
  // IMPORTANT: Content-Type MUST match the one signed by the presign endpoint
  // — S3 verifies it as part of the signature.
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  if (!putRes.ok) {
    throw new UploadError(
      `S3 upload failed (HTTP ${putRes.status})`,
      's3',
    )
  }

  // ── 4. Server-side: trigger sidecar ingestion + persist Attachment row ────
  const uploadRes = await fetch(`/api/pa/${paId}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attachmentId,
      filename: file.name,
      mimeType: file.type,
      s3Key,
    }),
  })
  if (!uploadRes.ok) {
    const body = await uploadRes.json().catch(() => ({}))
    throw new UploadError(
      body.detail ?? `Server-side ingestion failed (HTTP ${uploadRes.status})`,
      'ingest',
    )
  }

  return (await uploadRes.json()) as UploadAttachmentResult
}
