/**
 * POST /api/pa/[id]/upload
 *
 * Step 3 of the direct-to-S3 upload flow:
 *
 *   1. Client → POST /api/uploads/presign  → { attachmentId, s3Key, uploadUrl }
 *   2. Client → PUT  <uploadUrl>           → file goes straight to S3
 *   3. Client → POST /api/pa/[id]/upload   ← we are here
 *
 * This route fetches the uploaded file via the sidecar's /ingest-attachment
 * (which OCRs + renders pages + uploads PNGs to S3), persists the Attachment
 * row with the resulting pdfviewer-data payload, then re-runs the match
 * engine so the criteria pane updates with citations from the new content.
 *
 * Status guard: only PAs in `draft` or `pending_submission` accept uploads.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'

import { triggerIngestForAttachment } from '@/lib/ai/attachmentIntake'
import { getProviderId } from '@/lib/api/auth'
import { recordEvent } from '@/lib/audit/log'
import { prisma } from '@/lib/db/client'
import { runMatchEngine } from '@/lib/policies/matchEngine'
import { applyTransition } from '@/lib/statusMachine/applyTransition'

// Sidecar OCR + page-image generation typically takes 5–30 s on a clinical
// PDF. 60 s is the Vercel Hobby function-duration cap; Pro tier raises it.
export const maxDuration = 60

const BodySchema = z.object({
  attachmentId: z.string().min(1),
  filename: z.string().min(1).max(255),
  mimeType: z.literal('application/pdf'),
  s3Key: z.string().min(1),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const providerId = getProviderId(request)

  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { detail: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 },
    )
  }
  const { attachmentId, filename, mimeType, s3Key } = parsed.data

  const pa = await prisma.priorAuth.findUnique({ where: { id } })
  if (!pa) {
    return NextResponse.json({ detail: `PA '${id}' not found` }, { status: 404 })
  }
  if (pa.status !== 'draft' && pa.status !== 'pending_submission') {
    return NextResponse.json(
      { detail: `Cannot upload to PA in status '${pa.status}'` },
      { status: 422 },
    )
  }

  // ── 1. Sidecar — OCR + render + upload pages back to S3 ─────────────────
  let ingestion
  try {
    ingestion = await triggerIngestForAttachment({
      pa_id: id,
      attachment_id: attachmentId,
      s3_key: s3Key,
      filename,
      mime_type: mimeType,
    })
  } catch (err) {
    return NextResponse.json(
      { detail: `Attachment ingestion failed: ${(err as Error).message}` },
      { status: 502 },
    )
  }

  // ── 2. Persist the Attachment row with the pdfviewer payload ────────────
  //
  // We pass the server-minted attachmentId as the row's id so the S3 key
  // path and the row id align (debuggability + idempotent re-uploads).
  const attachment = await prisma.attachment.create({
    data: {
      id: attachmentId,
      priorAuthId: id,
      filename,
      mimeType,
      // storageUrl holds the canonical S3 key — the file-stream route
      // presigns on demand when serving "Open original".
      storageUrl: s3Key,
      uploadedBy: providerId,
      extractedText: ingestion.extracted_text,
      pageImages: ingestion.page_images,
      ocrLineCount: ingestion.ocr_line_count,
    },
  })

  await recordEvent({
    priorAuthId: id,
    type: 'upload',
    actor: providerId,
    metadata: {
      filename,
      attachmentId: attachment.id,
      ocrLineCount: ingestion.ocr_line_count,
      cachedOcr: ingestion.cached,
    },
  })

  // ── 3. Re-run criteria evaluation against the new content ───────────────
  await prisma.citation.deleteMany({
    where: { criterionResult: { priorAuthId: id } },
  })
  await prisma.criterionResult.deleteMany({ where: { priorAuthId: id } })

  const matchResult = await runMatchEngine(prisma, id)

  let updatedPa = await prisma.priorAuth.findUniqueOrThrow({ where: { id } })
  if (matchResult.overallStatus === 'all_passed' && updatedPa.status === 'draft') {
    const txResult = await applyTransition(prisma, updatedPa, {
      type: 'criteria_all_met',
      actor: providerId,
    })
    if (txResult.ok) updatedPa = txResult.pa
  }

  return NextResponse.json({ pa: updatedPa, attachment, matchResult })
}
