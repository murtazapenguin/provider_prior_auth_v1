import Link from 'next/link'
import { StatusPill } from '@/components/ui'
import type { FilteredPaRow } from '@/lib/dashboard/queueViews'

interface QueueFilteredListProps {
  title: string
  subline: string
  rows: FilteredPaRow[]
}

/**
 * Flat filtered PA list — rendered when /queue?view=<key> is set.
 * Server-component safe. Empty state has a CTA back to the dashboard.
 */
export default function QueueFilteredList({ title, subline, rows }: QueueFilteredListProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-surface-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground">{subline}</p>
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          {rows.length} {rows.length === 1 ? 'record' : 'records'}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing matches this filter yet. Try the{' '}
            <Link href="/dashboard" className="text-primary hover:underline">
              dashboard
            </Link>{' '}
            or{' '}
            <Link href="/pa/new" className="text-primary hover:underline">
              start a new PA
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-2.5 text-left font-medium">Patient</th>
                <th className="px-5 py-2.5 text-left font-medium">Service</th>
                <th className="px-5 py-2.5 text-left font-medium">Payer</th>
                <th className="px-5 py-2.5 text-left font-medium">Status</th>
                <th className="px-5 py-2.5 text-right font-medium">Confidence</th>
                <th className="px-5 py-2.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.paId}
                  className="border-t border-border hover:bg-muted/40 transition-colors"
                >
                  <td className="px-5 py-3">
                    <span className="font-medium text-surface-foreground">{row.patientName}</span>
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${row.service.category.chipClass}`}
                      title={row.service.description}
                    >
                      {row.service.category.label}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground tabular-nums">{row.service.code}</span>
                  </td>
                  <td className="px-5 py-3 text-surface-foreground">{row.payerName}</td>
                  <td className="px-5 py-3">
                    <StatusPill status={row.status} />
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {row.avgConfidencePct === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span
                        className={`font-medium ${
                          row.avgConfidencePct >= 80
                            ? 'text-green-600'
                            : row.avgConfidencePct >= 60
                              ? 'text-orange-600'
                              : 'text-red-600'
                        }`}
                      >
                        {row.avgConfidencePct}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/pa/${row.paId}`}
                      className="inline-flex items-center justify-center bg-primary text-primary-foreground rounded-lg px-3 py-1 text-xs font-medium hover:opacity-90"
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
