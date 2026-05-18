import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { applyTransition } from '@/lib/statusMachine/applyTransition'
import { runSimulatorTick } from '@/lib/payer/simulator'

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') ?? ''
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()

  // 60-day pending_submission expiration sweep
  const expiredPas = await prisma.priorAuth.findMany({
    where: {
      status: 'pending_submission',
      pendingSubmissionExpiresAt: { lte: now },
    },
  })

  const swept: string[] = []
  for (const pa of expiredPas) {
    const result = await applyTransition(prisma, pa, { type: 'sixty_day_timer', actor: 'system' })
    if (result.ok) swept.push(pa.id)
  }

  // Simulator tick
  const ticked = await runSimulatorTick(prisma, now)

  return NextResponse.json({ swept: swept.length, ticked })
}
