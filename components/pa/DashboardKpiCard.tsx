import type { ReactNode } from 'react'

interface DashboardKpiCardProps {
  /** Short title above the value, e.g. "Needs Review". */
  label: string
  /** Big value — string so we can format pre-render ("46", "69.5%", "—"). */
  value: string
  /** Optional tiny sub-label under the value. */
  sublabel?: string
  /** Tailwind background class for the icon tile (e.g. "bg-orange-500"). */
  iconBg: string
  /** Icon — inline SVG path data or a React node. */
  icon: ReactNode
}

/**
 * One KPI card on the dashboard grid. Server-component-safe (no client state).
 *
 * Visual: icon tile on the left, value + label + sublabel stacked on the
 * right, rounded card on a white surface.
 */
export default function DashboardKpiCard({
  label,
  value,
  sublabel,
  iconBg,
  icon,
}: DashboardKpiCardProps) {
  return (
    <div className="bg-surface rounded-xl border border-border p-5 flex items-start gap-4 shadow-sm">
      <div
        className={`shrink-0 w-12 h-12 rounded-lg flex items-center justify-center text-white ${iconBg}`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="text-3xl font-semibold text-surface-foreground tabular-nums mt-1">{value}</p>
        {sublabel && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{sublabel}</p>
        )}
      </div>
    </div>
  )
}
