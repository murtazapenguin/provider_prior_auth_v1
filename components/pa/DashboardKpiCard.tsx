import type { ReactNode } from 'react'
import Link from 'next/link'

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
  /** When set, the whole card becomes a Link to this URL with hover affordance. */
  href?: string
}

/**
 * One KPI card on the dashboard grid. Server-component-safe (no client state).
 *
 * Visual: icon tile on the left, value + label + sublabel stacked on the
 * right, rounded card on a white surface. When `href` is provided, the
 * whole card becomes a clickable link with a hover state.
 */
export default function DashboardKpiCard({
  label,
  value,
  sublabel,
  iconBg,
  icon,
  href,
}: DashboardKpiCardProps) {
  const body = (
    <>
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
    </>
  )

  if (href) {
    return (
      <Link
        href={href}
        className="bg-surface rounded-xl border border-border p-5 flex items-start gap-4 shadow-sm hover:shadow-md hover:border-primary/40 transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        {body}
      </Link>
    )
  }
  return (
    <div className="bg-surface rounded-xl border border-border p-5 flex items-start gap-4 shadow-sm">
      {body}
    </div>
  )
}
