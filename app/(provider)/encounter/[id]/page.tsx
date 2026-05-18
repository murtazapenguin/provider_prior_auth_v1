/**
 * /encounter/[id] — Encounter intake + code review.
 *
 * Server Component: loads encounter data (patient, coverage, provider, notes)
 * and any existing draft PA with codes directly from Prisma.
 *
 * Left panel  → EncounterSummary (patient + encounter + collapsible notes)
 * Right panel → CodeReview (create PA, derived codes, edit/confirm, continue)
 */

import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db/client'
import EncounterSummary, { type EncounterSummaryData } from '@/components/pa/EncounterSummary'
import CodeReview, { type CodeItem } from '@/components/pa/CodeReview'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EncounterPage({ params }: PageProps) {
  const { id } = await params

  // Load encounter with all related data
  const encounter = await prisma.encounter.findUnique({
    where: { id },
    include: {
      patient: {
        include: {
          coverages: {
            where: { effectiveTo: null },
            orderBy: { effectiveFrom: 'desc' },
            take: 3,
          },
        },
      },
      provider: true,
      notes: {
        orderBy: { authoredAt: 'asc' },
      },
      priorAuths: {
        where: { status: 'draft' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          codes: {
            orderBy: [{ codeType: 'asc' }, { isPrimary: 'desc' }],
          },
        },
      },
    },
  })

  if (!encounter) {
    notFound()
  }

  // Build EncounterSummary data shape
  const summaryData: EncounterSummaryData = {
    encounterId: encounter.id,
    encounterDate: encounter.encounterDate.toISOString(),
    placeOfService: encounter.placeOfService,
    patient: {
      id: encounter.patient.id,
      firstName: encounter.patient.firstName,
      lastName: encounter.patient.lastName,
      dob: encounter.patient.dob.toISOString(),
      sex: encounter.patient.sex,
      coverages: encounter.patient.coverages.map((c) => ({
        planName: c.planName,
        payerId: c.payerId,
        memberId: c.memberId,
        groupNumber: c.groupNumber ?? null,
        benefitCategory: c.benefitCategory,
      })),
    },
    provider: {
      firstName: encounter.provider.firstName,
      lastName: encounter.provider.lastName,
      specialty: encounter.provider.specialty,
      npi: encounter.provider.npi,
    },
    notes: encounter.notes.map((n) => ({
      id: n.id,
      noteType: n.noteType,
      authoredAt: n.authoredAt.toISOString(),
      authorRole: n.authorRole,
      text: n.text,
      source: n.source,
    })),
  }

  // Extract any existing draft PA and its codes
  const draftPa = encounter.priorAuths[0] ?? null
  const existingPaId = draftPa?.id ?? null
  const initialCodes: CodeItem[] = draftPa?.codes.map((c) => ({
    id: c.id,
    codeType: c.codeType as CodeItem['codeType'],
    code: c.code,
    modifier: c.modifier ?? null,
    description: c.description,
    isPrimary: c.isPrimary,
    derivedBy: c.derivedBy as CodeItem['derivedBy'],
    confidence: c.confidence ?? null,
  })) ?? []

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-surface-foreground">
          Encounter Intake
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Review clinical notes, confirm derived codes, and start a prior authorization.
        </p>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 items-start">
        {/* Left: encounter summary */}
        <aside>
          <EncounterSummary data={summaryData} />
        </aside>

        {/* Right: code review */}
        <main>
          <CodeReview
            encounterId={encounter.id}
            existingPaId={existingPaId}
            initialCodes={initialCodes}
          />
        </main>
      </div>
    </div>
  )
}
