/**
 * app/(provider)/queue/page.tsx
 *
 * Provider work queue page.
 *
 * Two layers:
 *
 *   1. (Phase 6 / T9 addition) Server-rendered context banner above the
 *      tabs. Triggered by query params from the post-launch routing tree
 *      (lib/smart/postLaunchRouting.ts):
 *        ?encounter={id}  → "No PA exists for this encounter yet" CTA
 *        ?patient={id}    → "Pick an encounter" list of recent encounters
 *
 *   2. (Phase 4) Existing client tabs UI — Action needed / Parked /
 *      Submitted — now lives in components/pa/QueueTabs.tsx (extracted
 *      verbatim from the previous client page; logic unchanged).
 *
 * The page is a Server Component because Layer 1 needs Prisma reads.
 * Layer 2 stays a Client Component for its tab interactivity.
 */

import Link from 'next/link'
import { prisma } from '@/lib/db/client'
import QueueTabs from '@/components/pa/QueueTabs'
import QueueFilteredList from '@/components/pa/QueueFilteredList'
import { QUEUE_VIEWS, getFilteredPriorAuths, isQueueViewKey } from '@/lib/dashboard/queueViews'

interface QueuePageProps {
  searchParams: Promise<{
    encounter?: string
    patient?: string
    view?: string
  }>
}

interface EncounterListItem {
  id: string
  encounterDate: Date
  placeOfService: string
  hasPriorAuth: boolean
  paId: string | null
}

// ─── Server-side reads (Phase 6 / T9 addition) ────────────────────────────────

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

// ─── Banners ──────────────────────────────────────────────────────────────────

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
    <div
      role="status"
      className="rounded-2xl border border-warning/40 bg-warning/10 p-5"
    >
      <p className="text-sm font-semibold text-surface-foreground">
        Patient not synced yet
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Patient <code className="font-mono">{patientId}</code> is not yet in
        the local database. The next FHIR sync from Epic will pull them in;
        meanwhile, you can browse your queue below.
      </p>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function QueuePage({ searchParams }: QueuePageProps) {
  const { encounter, patient, view } = await searchParams

  // Dashboard-driven filtered view: when /queue?view=<key> is set and known,
  // render a flat filtered list instead of the tabs. This is the click
  // destination from dashboard KPI cards.
  if (isQueueViewKey(view)) {
    const def = QUEUE_VIEWS[view]
    const rows = await getFilteredPriorAuths(view)
    return (
      <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/dashboard" className="text-xs text-muted-foreground hover:text-primary">
              ← Dashboard
            </Link>
            <h1 className="text-2xl font-bold text-surface-foreground mt-1">Work Queue</h1>
          </div>
          <Link
            href="/pa/new"
            className="inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 bg-primary text-primary-foreground hover:opacity-90 px-4 py-2 text-sm"
          >
            Start new PA
          </Link>
        </div>
        <QueueFilteredList title={def.title} subline={def.subline} rows={rows} />
      </div>
    )
  }

  // Resolve banner state from query params. encounter wins over patient
  // (the routing helper guarantees encounter implies patient was set too).
  let banner: React.ReactNode = null

  if (encounter) {
    const existingPaId = await findExistingPaForEncounter(encounter)
    if (!existingPaId) {
      banner = <EncounterContextBanner encounterId={encounter} />
    }
    // If a PA already exists, the routing helper would have sent us to /pa/{id}
    // — landing here is a stale link. Show nothing extra; tabs cover the rest.
  } else if (patient) {
    const patientRow = await findPatientById(patient)
    if (!patientRow) {
      banner = <PatientNotFoundBanner patientId={patient} />
    } else {
      const encounters = await findEncountersForPatient(patient)
      banner = (
        <PatientEncountersSection patient={patientRow} encounters={encounters} />
      )
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-surface-foreground">Work Queue</h1>
        <Link
          href="/pa/new"
          className="inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 bg-primary text-primary-foreground hover:opacity-90 px-4 py-2 text-sm"
        >
          Start new PA
        </Link>
      </div>

      {/* Context banner from post-launch routing */}
      {banner}

      {/* Client tabs (action / parked / submitted) */}
      <QueueTabs />
    </div>
  )
}
