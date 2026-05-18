import type { PriorAuth, PrismaClient } from '@/app/generated/prisma/client'
import { transition, type PaStatus, type PaTransitionEvent } from './transitions'
import { recordEvent } from '@/lib/audit/log'

type UpdateData = {
  status: string
  submittedAt?: Date | null
  pendingSubmissionExpiresAt?: Date | null
  trackingId?: string | null
  simulatorNextTransitionAt?: Date | null
}

export async function applyTransition(
  prisma: PrismaClient,
  pa: Pick<PriorAuth, 'id' | 'status'>,
  event: PaTransitionEvent,
  extraData: Omit<UpdateData, 'status'> = {}
): Promise<{ ok: true; pa: PriorAuth } | { ok: false; reason: string }> {
  const result = transition(pa.status as PaStatus, event)
  if (!result.ok) return result

  const { next, sideEffects } = result
  const now = new Date()
  const data: UpdateData = { status: next, ...extraData }

  for (const fx of sideEffects) {
    if (fx.type === 'set_field' && fx.field === 'submittedAt') {
      data.submittedAt = now
    } else if (fx.type === 'start_timer' && fx.kind === 'pending_submission_60d') {
      const exp = new Date(now)
      exp.setDate(exp.getDate() + 60)
      data.pendingSubmissionExpiresAt = exp
    } else if (fx.type === 'clear_timer' && fx.kind === 'pending_submission_60d') {
      data.pendingSubmissionExpiresAt = null
    }
  }

  const auditFx = sideEffects.find((fx) => fx.type === 'audit_event')
  const auditMeta = auditFx?.type === 'audit_event' ? auditFx.metadata : {}

  const updated = await prisma.priorAuth.update({
    where: { id: pa.id },
    data,
  })

  await recordEvent({
    priorAuthId: pa.id,
    type: 'status_change',
    fromStatus: pa.status,
    toStatus: next,
    actor: event.actor,
    metadata: { event: event.type, ...auditMeta },
  })

  return { ok: true, pa: updated }
}
