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
  /** When true, render as the currently-active filter (selected state). */
  isActive?: boolean
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
  isActive,
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

  // Custom soft shadow matching the reference design — diffuse, low-opacity
  // shadow that lifts the card off the muted background.
  const baseShadow = 'shadow-[0_2px_8px_-1px_rgba(15,23,42,0.06),0_4px_18px_-2px_rgba(15,23,42,0.04)]'
  const hoverShadow = 'hover:shadow-[0_4px_14px_-2px_rgba(15,23,42,0.08),0_8px_28px_-4px_rgba(15,23,42,0.06)]'
  const activeRing = 'ring-2 ring-primary border-primary'

  if (href) {
    return (
      <Link
        href={href}
        scroll={false}
        aria-current={isActive ? 'true' : undefined}
        className={`bg-surface rounded-xl p-5 flex items-start gap-4 transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${baseShadow} ${hoverShadow} ${
          isActive ? activeRing : 'border border-border hover:border-primary/40'
        }`}
      >
        {body}
      </Link>
    )
  }
  return (
    <div className={`bg-surface rounded-xl border border-border p-5 flex items-start gap-4 ${baseShadow}`}>
      {body}
    </div>
  )
}
