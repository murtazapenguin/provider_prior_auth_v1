import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { getProviderId } from '@/lib/api/auth'
import { applyTransition } from '@/lib/statusMachine/applyTransition'
import { notifyRfiResponse } from '@/lib/payer/simulator'
import { recordEvent } from '@/lib/audit/log'

const BodySchema = z.object({ rationale: z.string().min(1) })

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const providerId = getProviderId(request)

  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ detail: 'rationale is required' }, { status: 400 })
  }

  const pa = await prisma.priorAuth.findUnique({ where: { id } })
  if (!pa) return NextResponse.json({ detail: `PA '${id}' not found` }, { status: 404 })

  if (pa.status !== 'rfi') {
    return NextResponse.json({ detail: `PA is not in RFI status (current: ${pa.status})` }, { status: 422 })
  }

  await recordEvent({
    priorAuthId: id,
    type: 'rfi_response',
    actor: providerId,
    metadata: { rationale: parsed.data.rationale },
  })

  await notifyRfiResponse(prisma, id)

  const result = await applyTransition(prisma, pa, { type: 'rfi_responded', actor: providerId })
  if (!result.ok) return NextResponse.json({ detail: result.reason }, { status: 422 })

  return NextResponse.json(result.pa)
}
