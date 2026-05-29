'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

interface SidebarItem {
  href: string
  label: string
  icon: ReactNode
  /** Optional count badge — shown on the right when > 0. */
  countKey?: 'workQueueAttention'
}

const ITEMS: SidebarItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: <IconHome /> },
  { href: '/queue', label: 'Work Queue', icon: <IconList />, countKey: 'workQueueAttention' },
]

export interface SidebarCounts {
  workQueueAttention?: number
}

interface SidebarProps {
  counts?: SidebarCounts
}

/**
 * Left sidebar nav — desktop primary. Replaces the legacy top-header
 * AppShell for (provider) routes. Highlights the active route using
 * usePathname() (must be a client component).
 */
export default function Sidebar({ counts }: SidebarProps = {}) {
  const pathname = usePathname()

  return (
    <aside className="hidden md:flex w-60 shrink-0 border-r border-border bg-surface flex-col sticky top-0 h-screen">
      {/* Brand */}
      <div className="px-5 pt-5 pb-3 flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
          </svg>
        </div>
        <span className="font-semibold text-primary text-base">PA Workflow</span>
      </div>

      {/* Section header */}
      <div className="px-5 pt-4 pb-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          Prior Auth Workflow
        </p>
      </div>

      {/* Nav */}
      <nav className="px-3 flex flex-col gap-0.5">
        {ITEMS.map((item) => {
          const isActive =
            pathname === item.href || (pathname?.startsWith(item.href + '/') ?? false)
          const badgeCount = item.countKey ? counts?.[item.countKey] ?? 0 : 0
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-surface-foreground'
              }`}
            >
              <span
                className={`shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
              >
                {item.icon}
              </span>
              <span className="flex-1">{item.label}</span>
              {badgeCount > 0 && (
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold tabular-nums">
                  {badgeCount}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Bottom user section */}
      <div className="mt-auto p-5 border-t border-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-semibold text-xs">
            DP
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-surface-foreground truncate">Demo Provider</p>
            <p className="text-xs text-muted-foreground">Tester</p>
          </div>
        </div>
      </div>
    </aside>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────

function IconHome() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L12 3l9 6.5V21a1 1 0 01-1 1h-5v-7H9v7H4a1 1 0 01-1-1V9.5z" />
    </svg>
  )
}

function IconList() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </svg>
  )
}
