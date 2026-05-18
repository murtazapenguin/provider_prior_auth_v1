import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { getProviderId } from '@/lib/api/auth'

const QUEUE_STATUSES = {
  action: ['draft', 'ready_for_submission', 'rfi'],
  parked: ['pending_submission'],
  submitted: ['pending', 'in_progress', 'approved', 'denied', 'partial_approval', 'partial_denial'],
}

type QueueKey = keyof typeof QUEUE_STATUSES

export async function GET(request: Request) {
  const providerId = getProviderId(request)
  const { searchParams } = new URL(request.url)
  const queue = searchParams.get('queue') ?? 'all'
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('page_size') ?? '20')))

  let statusFilter: string[]
  if (queue === 'action' || queue === 'parked' || queue === 'submitted') {
    statusFilter = QUEUE_STATUSES[queue as QueueKey]
  } else {
    statusFilter = Object.values(QUEUE_STATUSES).flat()
  }

  const where = {
    providerId,
    status: { in: statusFilter },
  }

  const [total, items] = await Promise.all([
    prisma.priorAuth.count({ where }),
    prisma.priorAuth.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { updatedAt: 'desc' },
      include: {
        encounter: { include: { patient: true } },
        payer: true,
        codes: { where: { isPrimary: true }, take: 1 },
      },
    }),
  ])

  return NextResponse.json({
    items,
    total,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(total / pageSize),
  })
}
