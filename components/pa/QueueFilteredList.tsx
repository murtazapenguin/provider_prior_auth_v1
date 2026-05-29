import Link from 'next/link'
import { StatusPill } from '@/components/ui'
import type { FilteredPaRow } from '@/lib/dashboard/queueViews'

interface QueueFilteredListProps {
  /** Optional banner title above the table (dashboard inline view uses this). */
  title?: string
  /** Optional banner subline (dashboard inline view uses this). */
  subline?: string
  rows: FilteredPaRow[]
}

/**
 * Flat PA list — used by both the dashboard inline filter and the Work
 * Queue page.  Server-component safe.
 *
 * Columns: Patient (+ MRN), PA ID, Service (chip + code), Payer, Priority,
 * Status, Confidence (number + tiny bar + Auto/Review badge), Action.
 */
export default function QueueFilteredList({ title, subline, rows }: QueueFilteredListProps) {
  return (
    <div className="flex flex-col gap-4">
      {(title || subline) && (
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <div>
            {title && <h2 className="text-lg font-semibold text-surface-foreground">{title}</h2>}
            {subline && <p className="text-xs text-muted-foreground">{subline}</p>}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">
            No prior authorizations match these filters yet.{' '}
            <Link href="/pa/new" className="text-primary hover:underline">
              Start a new PA
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 text-left font-medium">Patient</th>
                <th className="px-4 py-3 text-left font-medium">PA ID</th>
                <th className="px-4 py-3 text-left font-medium">Service</th>
                <th className="px-4 py-3 text-left font-medium">Payer</th>
                <th className="px-4 py-3 text-left font-medium">Priority</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Confidence</th>
                <th className="px-4 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.paId}
                  className="border-t border-border hover:bg-muted/40 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <span className="font-medium text-surface-foreground">{row.patientName}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{row.patientMrn}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{row.paIdShort}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${row.service.category.chipClass}`}
                      title={row.service.description}
                    >
                      {row.service.category.label}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground tabular-nums">{row.service.code}</span>
                  </td>
                  <td className="px-4 py-3 text-surface-foreground">{row.payerName}</td>
                  <td className="px-4 py-3">
                    <PriorityChip priority={row.priority} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill status={row.status} />
                  </td>
                  <td className="px-4 py-3">
                    <ConfidenceCell pct={row.avgConfidencePct} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/pa/${row.paId}`}
                      className="inline-flex items-center justify-center bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-medium hover:opacity-90"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function PriorityChip({ priority }: { priority: string }) {
  let cls = 'bg-gray-100 text-gray-700'
  let label = 'Standard'
  if (priority === 'urgent') {
    cls = 'bg-red-100 text-red-700'
    label = 'Urgent'
  } else if (priority === 'expedited') {
    cls = 'bg-amber-100 text-amber-700'
    label = 'Expedited'
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}

function ConfidenceCell({ pct }: { pct: number | null }) {
  if (pct === null) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="inline-block w-6 h-6 rounded-full border-2 border-dashed border-muted-foreground/50" aria-hidden />
        <span className="text-muted-foreground">Not scored</span>
      </div>
    )
  }
  const color = pct >= 80 ? 'text-green-600' : pct >= 60 ? 'text-orange-600' : 'text-red-600'
  const barColor = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-orange-500' : 'bg-red-500'
  const badge = pct >= 80 ? 'Auto' : 'Review'
  const badgeColor = pct >= 80 ? 'text-green-700' : 'text-orange-700'
  return (
    <div className="flex items-center gap-2">
      <span className={`font-semibold tabular-nums ${color}`}>{pct}</span>
      <div className="w-12 h-1 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${barColor}`} style={{ width: `${Math.max(8, pct)}%` }} />
      </div>
      <span className={`text-xs ${badgeColor}`}>{badge}</span>
    </div>
  )
}
