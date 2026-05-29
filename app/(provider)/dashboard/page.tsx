/**
 * Provider Dashboard — Server Component.
 *
 * Composition:
 *   - Hero banner (gradient, title + subline)
 *   - 8 KPI cards (2 rows × 4)
 *   - 3 chart cards (Pipeline / Service Type / Top Payers)
 *   - Recent activity table
 *
 * All data computed at render time from `getDashboardStats()`.  No client
 * interactivity — the page is fully SSRable.
 */

import Link from 'next/link'
import DashboardKpiCard from '@/components/pa/DashboardKpiCard'
import DashboardBars from '@/components/pa/DashboardBars'
import DashboardRecentActivity from '@/components/pa/DashboardRecentActivity'
import { getDashboardStats } from '@/lib/dashboard/queries'

// Don't cache — counts update on every page load.
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const stats = await getDashboardStats()
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-0.5">
        <h1 className="text-2xl font-bold text-primary">Dashboard</h1>
        <p className="text-sm text-muted-foreground">{today}</p>
      </div>

      {/* Hero banner */}
      <div className="rounded-2xl px-6 py-5 flex flex-col gap-1 text-white" style={{
        background: 'linear-gradient(90deg, #6e2bf4 0%, #fc459d 100%)',
      }}>
        <h2 className="text-xl font-semibold">Prior Authorization Command Center</h2>
        <p className="text-sm opacity-90">
          Live view of prior-auth pipeline, AI-extracted criteria coverage, and payer outcomes.
        </p>
      </div>

      {/* Row 1 — main KPIs (all clickable → filtered queue) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <DashboardKpiCard
          label="Total Active"
          value={String(stats.totals.totalActive)}
          sublabel="in flight today"
          iconBg="bg-blue-500"
          icon={<IconLines />}
          href="/queue?view=active"
        />
        <DashboardKpiCard
          label="Needs Review"
          value={String(stats.totals.needsReview)}
          sublabel="flagged criteria or RFI"
          iconBg="bg-orange-500"
          icon={<IconWarning />}
          href="/queue?view=needs-review"
        />
        <DashboardKpiCard
          label="Approved"
          value={String(stats.totals.approved)}
          sublabel={
            stats.totals.approvalRatePct === null
              ? 'no decisions yet'
              : `${stats.totals.approvalRatePct}% approval rate`
          }
          iconBg="bg-green-500"
          icon={<IconCheck />}
          href="/queue?view=approved"
        />
        <DashboardKpiCard
          label="Denied"
          value={String(stats.totals.denied)}
          sublabel={stats.totals.denied === 0 ? 'no denials' : 'appeal available'}
          iconBg="bg-red-500"
          icon={<IconX />}
          href="/queue?view=denied"
        />
      </div>

      {/* Row 2 — secondary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <DashboardKpiCard
          label="Ready to Submit"
          value={String(stats.totals.readyForSubmission)}
          sublabel="all criteria met"
          iconBg="bg-purple-500"
          icon={<IconSpark />}
          href="/queue?view=ready"
        />
        <DashboardKpiCard
          label="Awaiting Outcome"
          value={String(stats.totals.awaitingOutcome)}
          sublabel="submitted, payer review"
          iconBg="bg-sky-500"
          icon={<IconClock />}
          href="/queue?view=awaiting"
        />
        <DashboardKpiCard
          label="Avg Confidence"
          value={
            stats.totals.avgConfidencePct === null
              ? '—'
              : `${stats.totals.avgConfidencePct}%`
          }
          sublabel="lowest first"
          iconBg="bg-indigo-500"
          icon={<IconChart />}
          href="/queue?view=low-confidence"
        />
        <DashboardKpiCard
          label="Approval Rate"
          value={
            stats.totals.approvalRatePct === null
              ? '—'
              : `${stats.totals.approvalRatePct}%`
          }
          sublabel="approved vs denied"
          iconBg="bg-teal-500"
          icon={<IconTrendUp />}
          href="/queue?view=decisions"
        />
      </div>

      {/* Row 3 — 3 chart cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <DashboardBars
          title="Pipeline Status"
          rows={stats.pipeline.map((p) => ({
            key: p.status,
            label: p.label,
            chipClass: pipelineChipClass(p.status),
            count: p.count,
          }))}
          emptyMessage="No active prior auths."
        />
        <DashboardBars
          title="By Service Type"
          rows={stats.byServiceCategory.map((s) => ({
            key: s.key,
            label: s.label,
            chipClass: s.chipClass,
            count: s.count,
          }))}
          emptyMessage="No service breakdown yet."
        />
        <DashboardBars
          title="Top Payers by Volume"
          rows={stats.topPayers.map((p, i) => ({
            key: p.name,
            label: p.name,
            rank: i + 1,
            count: p.count,
          }))}
          emptyMessage="No payer activity yet."
        />
      </div>

      {/* Row 4 — recent activity */}
      <DashboardRecentActivity rows={stats.recentActivity} />

      {/* Quick CTAs at the bottom */}
      <div className="flex flex-wrap gap-3">
        <Link
          href="/pa/new"
          className="inline-flex items-center justify-center bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          Start Prior Authorization
        </Link>
        <Link
          href="/queue"
          className="inline-flex items-center justify-center border border-border bg-surface text-surface-foreground rounded-lg px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Open Work Queue
        </Link>
      </div>
    </div>
  )
}

// ─── Pipeline-status chip color helpers ────────────────────────────────────

function pipelineChipClass(status: string): string {
  switch (status) {
    case 'draft':
      return 'bg-gray-100 text-gray-700'
    case 'pending_submission':
      return 'bg-amber-100 text-amber-700'
    case 'ready_for_submission':
      return 'bg-blue-100 text-blue-700'
    case 'pending':
      return 'bg-sky-100 text-sky-700'
    case 'in_progress':
      return 'bg-purple-100 text-purple-700'
    case 'rfi':
      return 'bg-orange-100 text-orange-700'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

// ─── Inline icon glyphs — sized 6×6 with currentColor stroke ──────────────

function IconLines() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  )
}
function IconWarning() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 9v4" />
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}
function IconCheck() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
function IconX() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}
function IconSpark() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v6M12 16v6M2 12h6M16 12h6" />
    </svg>
  )
}
function IconClock() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}
function IconChart() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  )
}
function IconTrendUp() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  )
}
