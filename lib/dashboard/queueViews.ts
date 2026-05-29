/**
 * Queue filter "views" — the destination of each clickable dashboard KPI card.
 *
 * Each view maps to:
 *   - a display title + subline (rendered in the queue header)
 *   - a Prisma `where` clause for selecting matching PAs
 *   - an optional ordering override (e.g. sort by AI confidence asc)
 *
 * URL contract: `/queue?view=<viewKey>` — when present, the queue page
 * renders a flat filtered list instead of the default tabbed UI.
 */

import { prisma } from '@/lib/db/client'
import { categorizeCode } from './serviceCategory'

const ACTIVE_STATUSES = [
  'draft',
  'pending_submission',
  'ready_for_submission',
  'pending',
  'in_progress',
  'rfi',
] as const

const APPROVED_STATUSES = ['approved', 'partial_approval'] as const
const DENIED_STATUSES = ['denied', 'partial_denial'] as const
const DECISION_STATUSES = [...APPROVED_STATUSES, ...DENIED_STATUSES] as const

export interface QueueViewDef {
  key: string
  title: string
  subline: string
}

export const QUEUE_VIEWS: Record<string, QueueViewDef> = {
  active: {
    key: 'active',
    title: 'All Active PAs',
    subline: 'Anything currently in flight (pre- or post-submission, not yet decided)',
  },
  'needs-review': {
    key: 'needs-review',
    title: 'Needs Review',
    subline: 'RFI requests or criteria flagged as needs-info / failed',
  },
  approved: {
    key: 'approved',
    title: 'Approved',
    subline: 'Payer authorized — proceed to scheduling',
  },
  denied: {
    key: 'denied',
    title: 'Denied',
    subline: 'Payer declined — appeal or revise and resubmit',
  },
  ready: {
    key: 'ready',
    title: 'Ready to Submit',
    subline: 'All criteria met — submit to payer',
  },
  awaiting: {
    key: 'awaiting',
    title: 'Awaiting Payer Outcome',
    subline: 'Submitted and under payer review',
  },
  'low-confidence': {
    key: 'low-confidence',
    title: 'Lowest AI Confidence First',
    subline: 'Active PAs sorted by average criterion confidence (lowest first)',
  },
  decisions: {
    key: 'decisions',
    title: 'Decisions Made',
    subline: 'All approved + denied PAs (the approval-rate denominator)',
  },
}

export function isQueueViewKey(s: string | undefined): s is keyof typeof QUEUE_VIEWS {
  return s !== undefined && s in QUEUE_VIEWS
}

export interface FilteredPaRow {
  paId: string
  patientName: string
  service: { code: string; description: string; category: { label: string; chipClass: string } }
  payerName: string
  status: string
  statusLabel: string
  avgConfidencePct: number | null
  createdAt: Date
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_submission: 'Pending Submission',
  ready_for_submission: 'Ready to Submit',
  pending: 'Pending',
  in_progress: 'In Review',
  rfi: 'RFI',
  approved: 'Approved',
  denied: 'Denied',
  partial_approval: 'Partial Approval',
  partial_denial: 'Partial Denial',
  withdrawn: 'Withdrawn',
  cancelled: 'Cancelled',
  voided: 'Voided',
  expired: 'Expired',
}

/**
 * Fetch the PA list for a given view. Returns up to 100 rows; pagination
 * isn't built yet — fine for the tester data volume.
 */
export async function getFilteredPriorAuths(viewKey: string): Promise<FilteredPaRow[]> {
  if (!isQueueViewKey(viewKey)) return []

  // Build the Prisma `where` per view.
  let where: object = {}
  switch (viewKey) {
    case 'active':
      where = { status: { in: ACTIVE_STATUSES as readonly string[] } }
      break
    case 'needs-review':
      where = {
        OR: [
          { status: 'rfi' },
          {
            status: { in: ['draft', 'pending_submission'] },
            criteriaResults: { some: { status: { in: ['failed', 'needs_info'] } } },
          },
        ],
      }
      break
    case 'approved':
      where = { status: { in: APPROVED_STATUSES as readonly string[] } }
      break
    case 'denied':
      where = { status: { in: DENIED_STATUSES as readonly string[] } }
      break
    case 'ready':
      where = { status: 'ready_for_submission' }
      break
    case 'awaiting':
      where = { status: { in: ['pending', 'in_progress'] } }
      break
    case 'low-confidence':
      where = { status: { in: ACTIVE_STATUSES as readonly string[] } }
      break
    case 'decisions':
      where = { status: { in: DECISION_STATUSES as readonly string[] } }
      break
  }

  const rows = await prisma.priorAuth.findMany({
    where,
    orderBy: viewKey === 'low-confidence' ? undefined : { createdAt: 'desc' },
    take: 100,
    include: {
      encounter: { include: { patient: true } },
      payer: { select: { name: true } },
      codes: { where: { isPrimary: true }, take: 1 },
      criteriaResults: { select: { confidence: true } },
    },
  })

  const mapped: FilteredPaRow[] = rows.map((pa) => {
    const patient = pa.encounter.patient
    const primary = pa.codes[0]
    const category = primary
      ? categorizeCode(primary.codeType, primary.code)
      : categorizeCode('OTHER', '')
    const confValues = pa.criteriaResults
      .map((r) => r.confidence)
      .filter((v): v is number => v !== null)
    const avgConf =
      confValues.length > 0
        ? confValues.reduce((s, v) => s + v, 0) / confValues.length
        : null
    return {
      paId: pa.id,
      patientName: `${patient.firstName} ${patient.lastName}`,
      service: {
        code: primary?.code ?? '—',
        description: primary?.description ?? '—',
        category: { label: category.label, chipClass: category.chipClass },
      },
      payerName: pa.payer.name,
      status: pa.status,
      statusLabel: STATUS_LABEL[pa.status] ?? pa.status,
      avgConfidencePct: avgConf === null ? null : Math.round(avgConf * 100),
      createdAt: pa.createdAt,
    }
  })

  // Post-sort for low-confidence (Prisma can't sort by derived avg directly).
  if (viewKey === 'low-confidence') {
    mapped.sort((a, b) => {
      const av = a.avgConfidencePct ?? 101
      const bv = b.avgConfidencePct ?? 101
      return av - bv
    })
  }

  return mapped
}
