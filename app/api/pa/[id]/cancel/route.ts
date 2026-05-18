import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { getProviderId } from '@/lib/api/auth'
import { applyTransition } from '@/lib/statusMachine/applyTransition'

const BodySchema = z.object({ initiator: z.enum(['provider', 'patient']).default('patient') })

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const providerId = getProviderId(request)

  const body = BodySchema.safeParse(await request.json().catch(() => ({})))
  const initiator = body.success ? body.data.initiator : 'patient'

  const pa = await prisma.priorAuth.findUnique({ where: { id } })
  if (!pa) return NextResponse.json({ detail: `PA '${id}' not found` }, { status: 404 })

  const event =
    initiator === 'provider'
      ? { type: 'provider_cancel' as const, actor: providerId }
      : { type: 'patient_decline' as const, actor: providerId }

  const result = await applyTransition(prisma, pa, event)
  if (!result.ok) return NextResponse.json({ detail: result.reason }, { status: 422 })

  return NextResponse.json(result.pa)
}
