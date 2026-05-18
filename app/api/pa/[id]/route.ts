import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const pa = await prisma.priorAuth.findUnique({
    where: { id },
    include: {
      encounter: { include: { patient: true, notes: true } },
      provider: true,
      payer: true,
      codes: true,
      criteriaResults: {
        orderBy: { evaluatedAt: 'desc' },
        include: { citations: true, criterion: true },
      },
      attachments: true,
      events: { orderBy: { createdAt: 'asc' } },
    },
  })

  if (!pa) {
    return NextResponse.json({ detail: `PA '${id}' not found` }, { status: 404 })
  }

  return NextResponse.json(pa)
}
