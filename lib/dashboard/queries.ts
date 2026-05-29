/**
 * Dashboard aggregation queries — Server-Component-only.
 *
 * Returns the KPIs + chart data + recent activity feed for the dashboard.
 * Designed to be a single round-trip's worth of Prisma calls; the numbers
 * are computed against the *current* state of the database, not a snapshot.
 */

import { prisma } from '@/lib/db/client'
import { categorizeCode } from './serviceCategory'

/** UI-display label for each status. Kept here (not imported) so the
 *  dashboard doesn't depend on the status-machine module. */
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

/** Statuses considered "active" (not terminal) — used for total-line counts. */
const ACTIVE_STATUSES = new Set([
  'draft',
  'pending_submission',
  'ready_for_submission',
  'pending',
  'in_progress',
  'rfi',
])

/** Pipeline order for the dashboard chart — left-to-right represents
 *  pre-submission → in-flight progression. Terminal statuses are excluded. */
const PIPELINE_ORDER = [
  'draft',
  'pending_submission',
  'ready_for_submission',
  'pending',
  'in_progress',
  'rfi',
]

export interface KpiTotals {
  totalActive: number
  needsReview: number
  approved: number
  denied: number
  readyForSubmission: number
  awaitingOutcome: number
  avgConfidencePct: number | null
  approvalRatePct: number | null
}

export interface PipelineBucket {
  status: string
  label: string
  count: number
}

export interface ServiceBucket {
  key: string
  label: string
  chipClass: string
  count: number
}

export interface PayerBucket {
  name: string
  count: number
}

export interface RecentActivityRow {
  paId: string
  patientName: string
  service: { code: string; description: string; category: ServiceBucket }
  payerName: string
  status: string
  statusLabel: string
  avgConfidencePct: number | null
  createdAt: Date
}

export interface DashboardStats {
  totals: KpiTotals
  pipeline: PipelineBucket[]
  byServiceCategory: ServiceBucket[]
  topPayers: PayerBucket[]
  recentActivity: RecentActivityRow[]
}

export async function getDashboardStats(): Promise<DashboardStats> {
  // ── Status counts (single groupBy) ───────────────────────────────────────
  const statusGroup = await prisma.priorAuth.groupBy({
    by: ['status'],
    _count: { _all: true },
  })
  const statusCounts: Record<string, number> = {}
  for (const row of statusGroup) {
    statusCounts[row.status] = row._count._all
  }
  const countOr0 = (s: string): number => statusCounts[s] ?? 0

  const totalActive = Array.from(ACTIVE_STATUSES).reduce(
    (acc, s) => acc + countOr0(s),
    0,
  )
  const approved = countOr0('approved') + countOr0('partial_approval')
  const denied = countOr0('denied') + countOr0('partial_denial')
  const awaitingOutcome = countOr0('pending') + countOr0('in_progress')
  const readyForSubmission = countOr0('ready_for_submission')
  // "Needs Review" = anything currently sitting in RFI, plus draft PAs that
  // have at least one criterion in `failed` or `needs_info` state.
  const needsReviewFromRfi = countOr0('rfi')
  const needsReviewFromCriteria = await prisma.priorAuth.count({
    where: {
      status: { in: ['draft', 'pending_submission'] },
      criteriaResults: {
        some: { status: { in: ['failed', 'needs_info'] } },
      },
    },
  })
  const needsReview = needsReviewFromRfi + needsReviewFromCriteria

  // ── Avg confidence across all CriterionResult rows for ACTIVE PAs ────────
  const confAgg = await prisma.criterionResult.aggregate({
    _avg: { confidence: true },
    where: {
      confidence: { not: null },
      priorAuth: { status: { in: Array.from(ACTIVE_STATUSES) } },
    },
  })
  const avgConfidence = confAgg._avg.confidence
  const avgConfidencePct = avgConfidence === null ? null : Math.round(avgConfidence * 100)

  const approvalRatePct =
    approved + denied > 0 ? Math.round((approved / (approved + denied)) * 100) : null

  // ── Pipeline buckets (in canonical order) ────────────────────────────────
  const pipeline: PipelineBucket[] = PIPELINE_ORDER.map((s) => ({
    status: s,
    label: STATUS_LABEL[s] ?? s,
    count: countOr0(s),
  }))

  // ── Top payers ───────────────────────────────────────────────────────────
  const payerGroup = await prisma.priorAuth.groupBy({
    by: ['payerId'],
    _count: { _all: true },
    orderBy: { _count: { payerId: 'desc' } },
    take: 5,
  })
  const payerIds = payerGroup.map((p) => p.payerId)
  const payerRows =
    payerIds.length > 0
      ? await prisma.payer.findMany({
          where: { id: { in: payerIds } },
          select: { id: true, name: true },
        })
      : []
  const payerName = (id: string): string =>
    payerRows.find((p) => p.id === id)?.name ?? 'Unknown'
  const topPayers: PayerBucket[] = payerGroup.map((p) => ({
    name: payerName(p.payerId),
    count: p._count._all,
  }))

  // ── Service-category breakdown — pull primary codes for non-terminal PAs ─
  const activePAs = await prisma.priorAuth.findMany({
    where: { status: { in: Array.from(ACTIVE_STATUSES) } },
    select: { id: true, codes: { where: { isPrimary: true }, take: 1 } },
  })
  const categoryCounts: Record<string, number> = {}
  for (const pa of activePAs) {
    const primary = pa.codes[0]
    if (!primary) continue
    const cat = categorizeCode(primary.codeType, primary.code)
    categoryCounts[cat.key] = (categoryCounts[cat.key] ?? 0) + 1
  }
  const byServiceCategory: ServiceBucket[] = Object.entries(categoryCounts)
    .map(([key, count]) => {
      const cat = categorizeCode(
        // Synthesize a representative pair so categorizeCode returns the
        // same ServiceCategory object — `byServiceCategory` doesn't need
        // a row, just the category metadata.
        key === 'drug' ? 'HCPCS' : key === 'dme' ? 'HCPCS' : 'CPT',
        key === 'drug' ? 'J0000' : key === 'dme' ? 'E0000' : key === 'imaging' ? '70000' : key === 'lab' ? '80000' : key === 'evaluation' ? '99000' : '10000',
      )
      return { key: cat.key, label: cat.label, chipClass: cat.chipClass, count }
    })
    .sort((a, b) => b.count - a.count)

  // ── Recent activity (latest 8 PAs) ───────────────────────────────────────
  const recent = await prisma.priorAuth.findMany({
    orderBy: { createdAt: 'desc' },
    take: 8,
    include: {
      encounter: { include: { patient: true } },
      payer: { select: { name: true } },
      codes: { where: { isPrimary: true }, take: 1 },
      criteriaResults: { select: { confidence: true } },
    },
  })
  const recentActivity: RecentActivityRow[] = recent.map((pa) => {
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
        category: { key: category.key, label: category.label, chipClass: category.chipClass, count: 0 },
      },
      payerName: pa.payer.name,
      status: pa.status,
      statusLabel: STATUS_LABEL[pa.status] ?? pa.status,
      avgConfidencePct: avgConf === null ? null : Math.round(avgConf * 100),
      createdAt: pa.createdAt,
    }
  })

  return {
    totals: {
      totalActive,
      needsReview,
      approved,
      denied,
      readyForSubmission,
      awaitingOutcome,
      avgConfidencePct,
      approvalRatePct,
    },
    pipeline,
    byServiceCategory,
    topPayers,
    recentActivity,
  }
}
