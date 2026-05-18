import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { getProviderId } from '@/lib/api/auth'
import { runMatchEngine } from '@/lib/policies/matchEngine'
import { applyTransition } from '@/lib/statusMachine/applyTransition'
import { recordEvent } from '@/lib/audit/log'

// Upload + recheck triggers evidence extraction. 60s = Vercel Hobby max; bump to 300 on Pro.
export const maxDuration = 60

const BodySchema = z.object({
  filename: z.string(),
  mimeType: z.string().default('text/plain'),
  storageKey: z.string().min(1),
  extractedText: z.string(),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const providerId = getProviderId(request)

  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { detail: parsed.error.issues[0]?.message ?? 'filename, storageKey, and extractedText are required' },
      { status: 400 }
    )
  }

  const pa = await prisma.priorAuth.findUnique({ where: { id } })
  if (!pa) return NextResponse.json({ detail: `PA '${id}' not found` }, { status: 404 })

  if (pa.status !== 'draft' && pa.status !== 'pending_submission') {
    return NextResponse.json(
      { detail: `Cannot upload to PA in status '${pa.status}'` },
      { status: 422 }
    )
  }

  const attachment = await prisma.attachment.create({
    data: {
      priorAuthId: id,
      filename: parsed.data.filename,
      mimeType: parsed.data.mimeType,
      storageUrl: parsed.data.storageKey,
      uploadedBy: providerId,
      extractedText: parsed.data.extractedText,
    },
  })

  await recordEvent({
    priorAuthId: id,
    type: 'upload',
    actor: providerId,
    metadata: { filename: parsed.data.filename, attachmentId: attachment.id },
  })

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
