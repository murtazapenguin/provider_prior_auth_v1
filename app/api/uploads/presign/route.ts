/**
 * POST /api/uploads/presign
 *
 * Mints a presigned PUT URL for the direct-to-S3 attachment-upload flow.
 * Server-mints the attachmentId (a UUID — Attachment.id when the row is
 * created post-upload) so the S3 key is set up in one place and the client
 * never has to invent IDs.
 *
 * Body:  { paId, filename, mimeType }
 * Reply: { attachmentId, s3Key, uploadUrl }
 *
 * The client then PUTs the file to `uploadUrl` and finally POSTs to
 * `/api/pa/[id]/upload` with `{ attachmentId, filename, mimeType, s3Key }`
 * — that route calls the sidecar's `/ingest-attachment` and persists the
 * Attachment row.
 *
 * Auth: requires a valid provider session (same gating as the PA upload).
 */

import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getProviderId } from '@/lib/api/auth'
import { buildUploadKey, presignUploadUrl } from '@/lib/storage/s3'

const BodySchema = z.object({
  paId: z.string().min(1),
  filename: z.string().min(1).max(255),
  // Hard-restrict to PDFs — the viewer pipeline downstream renders only PDFs.
  mimeType: z.literal('application/pdf'),
})

export async function POST(request: Request) {
  // Throws on unauth'd — propagates the standard 401.
  getProviderId(request)

  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { detail: parsed.error.issues[0]?.message ?? 'invalid request' },
      { status: 400 },
    )
  }
  const { paId, filename, mimeType } = parsed.data

  const attachmentId = randomUUID()
  const s3Key = buildUploadKey(paId, attachmentId, filename)

  let uploadUrl: string
  try {
    uploadUrl = await presignUploadUrl({ key: s3Key, contentType: mimeType })
  } catch (err) {
    return NextResponse.json(
      { detail: `Could not mint upload URL: ${(err as Error).message}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ attachmentId, s3Key, uploadUrl })
}
