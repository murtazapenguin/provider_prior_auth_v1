import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { getProviderId } from '@/lib/api/auth'
import { recordEvent } from '@/lib/audit/log'

const BodySchema = z.object({
  priority: z.enum(['standard', 'expedited', 'urgent']),
  priorityRationale: z.string().optional(),
})

// Priority is editable while the PA is still pre-submission. Once it leaves
// `ready_for_submission` (i.e. submitted to the payer), the value is locked
// in for audit/escalation tracking.
const EDITABLE_STATUSES = new Set([
  'draft',
  'pending_submission',
  'ready_for_submission',
])

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const providerId = getProviderId(request)

  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ detail: 'Invalid body' }, { status: 400 })
  }

  const { priority, priorityRationale } = parsed.data

  // Validate rationale BEFORE ownership / existence checks so the 400 surface is
  // stable regardless of the target PA. Avoids leaking PA existence by 404.
  if (
    priority !== 'standard' &&
    (!priorityRationale || priorityRationale.trim().length === 0)
  ) {
    return NextResponse.json(
      { detail: 'Rationale is required for Expedited / Urgent PAs' },
      { status: 400 }
    )
  }

  const pa = await prisma.priorAuth.findUnique({ where: { id } })
  if (!pa) return NextResponse.json({ detail: 'PA not found' }, { status: 404 })
  if (pa.providerId !== providerId) {
    return NextResponse.json({ detail: 'Forbidden' }, { status: 403 })
  }
  if (!EDITABLE_STATUSES.has(pa.status)) {
    return NextResponse.json(
      { detail: `Cannot edit priority once status is '${pa.status}'` },
      { status: 422 }
    )
  }

  const nextRationale =
    priority === 'standard' ? null : priorityRationale?.trim() ?? null

  const updated = await prisma.priorAuth.update({
    where: { id },
    data: { priority, priorityRationale: nextRationale },
  })

  await recordEvent({
    priorAuthId: id,
    type: 'priority_changed',
    actor: providerId,
    metadata: {
      from: pa.priority,
      to: priority,
      rationale: nextRationale,
    },
  })

  return NextResponse.json({
    priority: updated.priority,
    priorityRationale: updated.priorityRationale,
  })
}
