import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { applyTransition } from '@/lib/statusMachine/applyTransition'
import type { PaTransitionEvent } from '@/lib/statusMachine/transitions'

const BodySchema = z.object({
  paId: z.string(),
  event: z.enum([
    'simulator_in_progress',
    'simulator_rfi',
    'simulator_approved',
    'simulator_denied',
    'simulator_partial_approval',
    'simulator_partial_denial',
  ]),
})

export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ detail: 'paId and event are required' }, { status: 400 })
  }

  const pa = await prisma.priorAuth.findUnique({ where: { id: parsed.data.paId } })
  if (!pa) {
    return NextResponse.json({ detail: `PA '${parsed.data.paId}' not found` }, { status: 404 })
  }

  const event: PaTransitionEvent = { type: parsed.data.event, actor: 'system' }
  const result = await applyTransition(prisma, pa, event)
  if (!result.ok) return NextResponse.json({ detail: result.reason }, { status: 422 })

  return NextResponse.json(result.pa)
}
