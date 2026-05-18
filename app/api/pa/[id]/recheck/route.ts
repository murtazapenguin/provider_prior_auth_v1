import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { getProviderId } from '@/lib/api/auth'
import { runMatchEngine } from '@/lib/policies/matchEngine'
import { applyTransition } from '@/lib/statusMachine/applyTransition'

// Re-runs evidence extraction across all criteria — heavy AI workload.
// 60s = Vercel Hobby max; bump to 300 on Pro for policies with many criteria.
export const maxDuration = 60

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const providerId = getProviderId(request)

  const pa = await prisma.priorAuth.findUnique({ where: { id } })
  if (!pa) return NextResponse.json({ detail: `PA '${id}' not found` }, { status: 404 })

  if (pa.status === 'voided' || pa.status === 'cancelled' || pa.status === 'expired') {
    return NextResponse.json({ detail: `Cannot recheck PA in terminal status '${pa.status}'` }, { status: 422 })
  }

  // Clear previous criterion results before re-running
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

  return NextResponse.json({ pa: updatedPa, matchResult })
}
