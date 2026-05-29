/**
 * Queue filter helpers — used by both the dashboard's inline filter and the
 * full Work Queue page.
 *
 * Two entry points:
 *   getFilteredPriorAuths(viewKey)  — dashboard "preset" filter by view name.
 *   getQueueRows(filters)            — the Work Queue page's general filter
 *                                      (status, service category, priority,
 *                                      free-text search).
 *
 * Both return FilteredPaRow[] in the same shape so the underlying table
 * component is shared.
 */

import type { Prisma } from '@/app/generated/prisma/client'
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
  active: { key: 'active', title: 'All Active PAs', subline: 'Anything currently in flight' },
  'needs-review': { key: 'needs-review', title: 'Needs Review', subline: 'RFI or flagged criteria' },
  approved: { key: 'approved', title: 'Approved', subline: 'Payer authorized' },
  denied: { key: 'denied', title: 'Denied', subline: 'Payer declined' },
  ready: { key: 'ready', title: 'Ready to Submit', subline: 'All criteria met' },
  awaiting: { key: 'awaiting', title: 'Awaiting Payer Outcome', subline: 'Under payer review' },
  'low-confidence': { key: 'low-confidence', title: 'Lowest AI Confidence', subline: 'Sorted by avg criterion confidence asc' },
  decisions: { key: 'decisions', title: 'Decisions Made', subline: 'Approved + denied' },
}

export function isQueueViewKey(s: string | undefined): s is keyof typeof QUEUE_VIEWS {
  return s !== undefined && s in QUEUE_VIEWS
}

export interface FilteredPaRow {
  paId: string
  paIdShort: string
  patientName: string
  patientMrn: string
  service: { code: string; description: string; category: { key: string; label: string; chipClass: string } }
  payerName: string
  priority: string
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

export interface QueueFilterParams {
  /** Preset view from dashboard (overrides individual status if set). */
  view?: string
  /** Specific status — overridden by view. */
  status?: string
  /** Service category key (drug, imaging, etc.). Post-filter (Prisma can't query derived). */
  service?: string
  /** Priority (standard | expedited | urgent). */
  priority?: string
  /** Free-text search across patient name / payer / PA id. */
  q?: string
  /** Row limit, default 100. */
  limit?: number
}

/** Build a Prisma where clause for the preset view. */
function whereForView(viewKey: string): Prisma.PriorAuthWhereInput {
  switch (viewKey) {
    case 'active':
      return { status: { in: ACTIVE_STATUSES as readonly string[] as string[] } }
    case 'needs-review':
      return {
        OR: [
          { status: 'rfi' },
          {
            status: { in: ['draft', 'pending_submission'] },
            criteriaResults: { some: { status: { in: ['failed', 'needs_info'] } } },
          },
        ],
      }
    case 'approved':
      return { status: { in: APPROVED_STATUSES as readonly string[] as string[] } }
    case 'denied':
      return { status: { in: DENIED_STATUSES as readonly string[] as string[] } }
    case 'ready':
      return { status: 'ready_for_submission' }
    case 'awaiting':
      return { status: { in: ['pending', 'in_progress'] } }
    case 'low-confidence':
      return { status: { in: ACTIVE_STATUSES as readonly string[] as string[] } }
    case 'decisions':
      return { status: { in: DECISION_STATUSES as readonly string[] as string[] } }
    default:
      return {}
  }
}

function mapRow(pa: Prisma.PriorAuthGetPayload<{
  include: {
    encounter: { include: { patient: true } }
    payer: { select: { name: true } }
    codes: { where: { isPrimary: true }; take: 1 }
    criteriaResults: { select: { confidence: true } }
  }
}>): FilteredPaRow {
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
    paIdShort: `PA-${pa.id.slice(-6).toUpperCase()}`,
    patientName: `${patient.firstName} ${patient.lastName}`,
    patientMrn: patient.externalId ?? `MRN-${patient.id.slice(-6).toUpperCase()}`,
    service: {
      code: primary?.code ?? '—',
      description: primary?.description ?? '—',
      category: { key: category.key, label: category.label, chipClass: category.chipClass },
    },
    payerName: pa.payer.name,
    priority: pa.priority,
    status: pa.status,
    statusLabel: STATUS_LABEL[pa.status] ?? pa.status,
    avgConfidencePct: avgConf === null ? null : Math.round(avgConf * 100),
    createdAt: pa.createdAt,
  }
}

/** Dashboard preset filter — fetches the PA list for a given view. */
export async function getFilteredPriorAuths(viewKey: string): Promise<FilteredPaRow[]> {
  if (!isQueueViewKey(viewKey)) return []
  return getQueueRows({ view: viewKey })
}

/** Full-flexibility filter for the Work Queue page. */
export async function getQueueRows(params: QueueFilterParams): Promise<FilteredPaRow[]> {
  const where: Prisma.PriorAuthWhereInput = params.view && isQueueViewKey(params.view)
    ? whereForView(params.view)
    : {}

  // Individual filters (when no view is set).
  if (!params.view) {
    if (params.status) where.status = params.status
    if (params.priority) where.priority = params.priority
    if (params.q) {
      const q = params.q.trim()
      if (q) {
        where.OR = [
          { encounter: { patient: { firstName: { contains: q, mode: 'insensitive' } } } },
          { encounter: { patient: { lastName: { contains: q, mode: 'insensitive' } } } },
          { payer: { name: { contains: q, mode: 'insensitive' } } },
          { id: { contains: q, mode: 'insensitive' } },
        ]
      }
    }
  }

  const rows = await prisma.priorAuth.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: params.limit ?? 100,
    include: {
      encounter: { include: { patient: true } },
      payer: { select: { name: true } },
      codes: { where: { isPrimary: true }, take: 1 },
      criteriaResults: { select: { confidence: true } },
    },
  })

  let mapped: FilteredPaRow[] = rows.map(mapRow)

  // Service-category filter is post-fetch (categorization is derived from
  // CPT/HCPCS prefix, not a column).
  if (params.service) {
    mapped = mapped.filter((r) => r.service.category.key === params.service)
  }

  // Sort for low-confidence view (Prisma can't sort by derived avg).
  if (params.view === 'low-confidence') {
    mapped.sort((a, b) => (a.avgConfidencePct ?? 101) - (b.avgConfidencePct ?? 101))
  }

  return mapped
}

/** Count of PAs that need provider attention (sidebar badge). */
export async function getNeedsAttentionCount(): Promise<number> {
  return prisma.priorAuth.count({
    where: {
      OR: [
        { status: 'rfi' },
        {
          status: { in: ['draft', 'pending_submission'] },
          criteriaResults: { some: { status: { in: ['failed', 'needs_info'] } } },
        },
      ],
    },
  })
}
