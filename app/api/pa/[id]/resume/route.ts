import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { getProviderId } from '@/lib/api/auth'
import { applyTransition } from '@/lib/statusMachine/applyTransition'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const providerId = getProviderId(request)

  const pa = await prisma.priorAuth.findUnique({ where: { id } })
  if (!pa) return NextResponse.json({ detail: `PA '${id}' not found` }, { status: 404 })

  const result = await applyTransition(prisma, pa, { type: 'provider_resume', actor: providerId })
  if (!result.ok) return NextResponse.json({ detail: result.reason }, { status: 422 })

  return NextResponse.json(result.pa)
}
