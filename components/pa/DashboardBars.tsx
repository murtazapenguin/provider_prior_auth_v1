/**
 * Generic horizontal-bar list — reused by the dashboard's Pipeline,
 * By Service Type, and Top Payers cards.  Each row shows a label,
 * an inline bar proportional to count / max, and a count.
 *
 * Server-component safe.
 */

interface BarRow {
  /** Stable key (React key + tracks update). */
  key: string
  /** Left-hand label, optionally wrapped in a chip when chipClass is set. */
  label: string
  /** Tailwind chip class — when present, label renders as a colored pill. */
  chipClass?: string
  /** Numeric value driving the bar width + right-hand label. */
  count: number
  /** Optional rank index (1-based) shown to the left of the label. */
  rank?: number
}

interface DashboardBarsProps {
  title: string
  rows: BarRow[]
  /** Tailwind background class for the bar fill (default `bg-primary`). */
  barClass?: string
  /** Shown when rows is empty. */
  emptyMessage?: string
}

export default function DashboardBars({
  title,
  rows,
  barClass = 'bg-primary',
  emptyMessage = 'No data yet.',
}: DashboardBarsProps) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0)

  return (
    <div className="bg-surface rounded-xl border border-border p-5 shadow-sm flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-surface-foreground">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyMessage}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => {
            const widthPct = max > 0 ? Math.max(4, Math.round((r.count / max) * 100)) : 0
            return (
              <li key={r.key} className="flex items-center gap-3 text-sm">
                {r.rank !== undefined && (
                  <span className="text-xs text-muted-foreground tabular-nums w-4">
                    {r.rank}.
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  {r.chipClass ? (
                    <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${r.chipClass}`}>
                      {r.label}
                    </span>
                  ) : (
                    <span className="text-surface-foreground truncate">{r.label}</span>
                  )}
                  <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full ${barClass}`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </div>
                <span className="text-sm font-medium text-surface-foreground tabular-nums">{r.count}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
