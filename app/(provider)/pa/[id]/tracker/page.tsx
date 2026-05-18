import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db/client'
import Tracker from '@/components/pa/Tracker'
import AdminFastForward from '@/components/pa/AdminFastForward'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function TrackerPage({ params }: PageProps) {
  const { id: paId } = await params

  const pa = await prisma.priorAuth.findUnique({
    where: { id: paId },
    include: {
      encounter: { include: { patient: true } },
      payer: true,
      codes: true,
      events: { orderBy: { createdAt: 'asc' } },
    },
  })

  if (!pa) notFound()

  // Serialize to a plain object for the client component
  const initialData = {
    id: pa.id,
    status: pa.status,
    trackingId: pa.trackingId ?? null,
    statusReason: pa.statusReason ?? null,
    submittedAt: pa.submittedAt?.toISOString() ?? null,
    payerExpiresAt: pa.payerExpiresAt?.toISOString() ?? null,
    payer: { name: pa.payer.name },
    encounter: {
      patient: {
        firstName: pa.encounter.patient.firstName,
        lastName: pa.encounter.patient.lastName,
      },
    },
    codes: pa.codes.map((c) => ({
      codeType: c.codeType,
      code: c.code,
      description: c.description,
      modifier: c.modifier ?? null,
    })),
    events: pa.events.map((e) => ({
      id: e.id,
      type: e.type,
      fromStatus: e.fromStatus ?? null,
      toStatus: e.toStatus ?? null,
      actor: e.actor,
      metadata: e.metadata as Record<string, unknown>,
      createdAt: e.createdAt.toISOString(),
    })),
  }

  return (
    <div className="min-h-screen bg-muted">
      <Tracker paId={paId} initialData={initialData} />
      <AdminFastForward paId={paId} />
    </div>
  )
}
