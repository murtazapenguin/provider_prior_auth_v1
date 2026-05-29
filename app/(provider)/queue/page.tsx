/**
 * app/(provider)/queue/page.tsx
 *
 * Work Queue — flat filtered table.  Two layers:
 *
 *   1. Context banner above the queue when launched from a SMART encounter
 *      or patient param (legacy post-launch routing flow).
 *   2. QueueFilters (search + 3 dropdowns) + QueueFilteredList (table).
 *
 * URL params honored:
 *   - encounter, patient — SMART launch context (banner).
 *   - view             — preset filter (from dashboard cards).
 *   - status, service, priority, q — granular filters from QueueFilters.
 */

import Link from 'next/link'
import { prisma } from '@/lib/db/client'
import QueueFilteredList from '@/components/pa/QueueFilteredList'
import QueueFilters from '@/components/pa/QueueFilters'
import {
  QUEUE_VIEWS,
  getQueueRows,
  isQueueViewKey,
} from '@/lib/dashboard/queueViews'

interface QueuePageProps {
  searchParams: Promise<{
    encounter?: string
    patient?: string
    view?: string
    status?: string
    service?: string
    priority?: string
    q?: string
  }>
}

interface EncounterListItem {
  id: string
  encounterDate: Date
  placeOfService: string
  hasPriorAuth: boolean
  paId: string | null
}

// ─── Server-side reads for context banners ────────────────────────────────────

async function findExistingPaForEncounter(encounterId: string): Promise<string | null> {
  const pa = await prisma.priorAuth.findFirst({
    where: { encounterId },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  })
  return pa?.id ?? null
}

async function findEncountersForPatient(patientId: string): Promise<EncounterListItem[]> {
  const rows = await prisma.encounter.findMany({
    where: { patientId },
    orderBy: { encounterDate: 'desc' },
    take: 20,
    select: {
      id: true,
      encounterDate: true,
      placeOfService: true,
      priorAuths: { select: { id: true }, take: 1, orderBy: { createdAt: 'desc' } },
    },
  })
  return rows.map((r) => ({
    id: r.id,
    encounterDate: r.encounterDate,
    placeOfService: r.placeOfService,
    hasPriorAuth: r.priorAuths.length > 0,
    paId: r.priorAuths[0]?.id ?? null,
  }))
}

async function findPatientById(patientId: string) {
  return prisma.patient.findUnique({
    where: { id: patientId },
    select: { id: true, firstName: true, lastName: true, dob: true },
  })
}

// ─── Banner components (preserved from the legacy queue) ──────────────────────

function EncounterContextBanner({ encounterId }: { encounterId: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-2xl border border-primary/30 bg-primary/5 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
    >
      <div>
        <p className="text-sm font-semibold text-surface-foreground">
          No PA exists for this encounter yet.
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          You launched from encounter{' '}
          <code className="font-mono">{encounterId}</code>. Start a prior
          authorization to derive codes, evaluate criteria, and assemble the packet.
        </p>
      </div>
      <Link
        href={`/encounter/${encodeURIComponent(encounterId)}`}
        className="inline-flex items-center justify-center font-medium rounded-lg px-4 py-2 text-sm bg-primary text-primary-foreground hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 whitespace-nowrap"
      >
        Create PA →
      </Link>
    </div>
  )
}

function formatEncounterDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

function PatientEncountersSection({
  patient,
  encounters,
}: {
  patient: { id: string; firstName: string; lastName: string; dob: Date }
  encounters: EncounterListItem[]
}) {
  if (encounters.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-center">
        <p className="text-sm font-semibold text-surface-foreground">
          No encounters yet for {patient.firstName} {patient.lastName}.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          When the patient has a new visit in the EHR, the encounter will show up here.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-3">
        <p className="text-sm font-semibold text-surface-foreground">
          Pick an encounter for {patient.firstName} {patient.lastName}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          You launched without an encounter context. Start from one of these recent encounters.
        </p>
      </div>
      <ul className="divide-y divide-border" aria-label={`Recent encounters for ${patient.firstName} ${patient.lastName}`}>
        {encounters.map((enc) => {
          const href = enc.hasPriorAuth && enc.paId ? `/pa/${enc.paId}` : `/encounter/${enc.id}`
          return (
            <li key={enc.id} className="py-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-surface-foreground">
                  {formatEncounterDate(enc.encounterDate)} · {enc.placeOfService}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground font-mono">{enc.id}</p>
              </div>
              <div className="flex items-center gap-2">
                {enc.hasPriorAuth ? (
                  <span className="inline-flex items-center rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                    PA started
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    No PA yet
                  </span>
                )}
                <Link
                  href={href}
                  className="inline-flex items-center justify-center font-medium rounded-lg px-3 py-1.5 text-xs border border-border text-surface-foreground bg-transparent hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 whitespace-nowrap"
                >
                  {enc.hasPriorAuth ? 'Open PA' : 'Create PA'}
                </Link>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function PatientNotFoundBanner({ patientId }: { patientId: string }) {
  return (
    <div role="status" className="rounded-2xl border border-warning/40 bg-warning/10 p-5">
      <p className="text-sm font-semibold text-surface-foreground">Patient not synced yet</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Patient <code className="font-mono">{patientId}</code> is not yet in the local
        database. The next FHIR sync from Epic will pull them in; meanwhile, you can
        browse your queue below.
      </p>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function QueuePage({ searchParams }: QueuePageProps) {
  const { encounter, patient, view, status, service, priority, q } = await searchParams

  let banner: React.ReactNode = null
  if (encounter) {
    const existingPaId = await findExistingPaForEncounter(encounter)
    if (!existingPaId) banner = <EncounterContextBanner encounterId={encounter} />
  } else if (patient) {
    const patientRow = await findPatientById(patient)
    if (!patientRow) {
      banner = <PatientNotFoundBanner patientId={patient} />
    } else {
      const encounters = await findEncountersForPatient(patient)
      banner = <PatientEncountersSection patient={patientRow} encounters={encounters} />
    }
  }

  const rows = await getQueueRows({ view, status, service, priority, q })
  const activeView = isQueueViewKey(view) ? QUEUE_VIEWS[view] : null

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-foreground">Work Queue</h1>
          {activeView ? (
            <p className="text-sm text-muted-foreground mt-0.5">
              {activeView.title} — {activeView.subline}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground mt-0.5">
              Every prior auth, filterable.
            </p>
          )}
        </div>
        <Link
          href="/pa/new"
          className="inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 bg-primary text-primary-foreground hover:opacity-90 px-4 py-2 text-sm"
        >
          Start new PA
        </Link>
      </div>

      {banner}

      <QueueFilters recordCount={rows.length} />
      <QueueFilteredList rows={rows} />
    </div>
  )
}
