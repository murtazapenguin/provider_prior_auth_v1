import { prisma } from '@/lib/db/client'
import type { Prisma } from '@/app/generated/prisma/client'

export interface RecordEventInput {
  priorAuthId: string
  type: string
  fromStatus?: string
  toStatus?: string
  actor: string
  metadata: Record<string, unknown>
}

export async function recordEvent(input: RecordEventInput): Promise<void> {
  await prisma.paEvent.create({
    data: {
      priorAuthId: input.priorAuthId,
      type: input.type,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      actor: input.actor,
      metadata: input.metadata as unknown as Prisma.InputJsonValue,
    },
  })
}
