import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'

const BodySchema = z.object({ encounterId: z.string() })

export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ detail: 'encounterId is required' }, { status: 400 })
  }

  const encounter = await prisma.encounter.findUnique({
    where: { id: parsed.data.encounterId },
    include: {
      patient: { include: { coverages: true } },
      provider: true,
      notes: true,
      priorAuths: { select: { id: true, status: true } },
    },
  })

  if (!encounter) {
    return NextResponse.json({ detail: `Encounter '${parsed.data.encounterId}' not found` }, { status: 404 })
  }

  return NextResponse.json(encounter)
}
