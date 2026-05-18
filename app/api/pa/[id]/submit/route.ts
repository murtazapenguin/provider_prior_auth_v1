import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { getProviderId } from '@/lib/api/auth'
import { applyTransition } from '@/lib/statusMachine/applyTransition'
import { MockPayerAdapter } from '@/lib/payer/submit'
import { PENDING_TO_IN_PROGRESS_MS } from '@/lib/payer/simulator'

const payer = new MockPayerAdapter()

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const providerId = getProviderId(request)

  let pa = await prisma.priorAuth.findUnique({
    where: { id },
    include: { encounter: true, codes: true },
  })
  if (!pa) return NextResponse.json({ detail: `PA '${id}' not found` }, { status: 404 })

  // If the PA is parked, resume it first so the state machine can accept
  // provider_submit. Equivalent to clicking "Resume" then "Submit" in the UI.
  if (pa.status === 'pending_submission') {
    const resumeResult = await applyTransition(prisma, pa, { type: 'provider_resume', actor: providerId })
    if (!resumeResult.ok) {
      return NextResponse.json({ detail: resumeResult.reason }, { status: 422 })
    }
    pa = await prisma.priorAuth.findUniqueOrThrow({
      where: { id },
      include: { encounter: true, codes: true },
    })
  }

  const ack = await payer.submit({
    paId: pa.id,
    encounterId: pa.encounter.id,
    providerId: pa.providerId,
    payerId: pa.payerId,
    codes: pa.codes.map((c) => ({ codeType: c.codeType, code: c.code, modifier: c.modifier ?? undefined })),
  })

  const simulatorNextTransitionAt = new Date(ack.submittedAt.getTime() + PENDING_TO_IN_PROGRESS_MS)

  const result = await applyTransition(prisma, pa, { type: 'provider_submit', actor: providerId }, {
    trackingId: ack.trackingId,
    simulatorNextTransitionAt,
  })

  if (!result.ok) {
    return NextResponse.json({ detail: result.reason }, { status: 422 })
  }

  return NextResponse.json(result.pa)
}
