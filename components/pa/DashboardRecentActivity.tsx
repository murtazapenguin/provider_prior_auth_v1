import Link from 'next/link'
import { StatusPill } from '@/components/ui'
import type { RecentActivityRow } from '@/lib/dashboard/queries'

interface DashboardRecentActivityProps {
  rows: RecentActivityRow[]
}

/**
 * Recent activity table — last 8 PAs sorted by createdAt desc.
 * Each row links to the PA detail page.
 */
export default function DashboardRecentActivity({ rows }: DashboardRecentActivityProps) {
  return (
    <div className="bg-surface rounded-xl border border-border shadow-sm">
      <div className="px-5 py-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-surface-foreground">Recent Activity</h3>
        <Link href="/queue" className="text-xs font-medium text-primary hover:underline">
          View all →
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            No prior authorizations yet — start one from{' '}
            <Link href="/pa/new" className="text-primary hover:underline">
              Start Prior Authorization
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-muted-foreground border-t border-border">
                <th className="px-5 py-2.5 text-left font-medium">Patient</th>
                <th className="px-5 py-2.5 text-left font-medium">Service</th>
                <th className="px-5 py-2.5 text-left font-medium">Payer</th>
                <th className="px-5 py-2.5 text-left font-medium">Status</th>
                <th className="px-5 py-2.5 text-right font-medium">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.paId}
                  className="border-t border-border hover:bg-muted/40 transition-colors"
                >
                  <td className="px-5 py-3">
                    <Link href={`/pa/${row.paId}`} className="font-medium text-surface-foreground hover:text-primary">
                      {row.patientName}
                    </Link>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
