/**
 * app/(admin)/layout.tsx
 *
 * Admin route-group layout. Renders the chrome (header + side nav) for the
 * Clinical Informaticist persona's policy review surface.
 *
 * Auth: a valid SmartSession is required. We call `getCurrentSession()` and
 * redirect to `/launch` when no session is found.
 *
 * TODO(phase-6-compliance): NO RBAC YET — any authenticated provider can
 * reach this admin surface and publish policies. Add an admin-role check
 * (against an `admin_users` table or an org-level claim on SmartSession)
 * before production. Grep `TODO(phase-6-compliance)` to find every gap.
 */

import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { getCurrentSession } from '@/lib/smart/session'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // TODO(phase-6-compliance): NO RBAC YET — any authenticated provider can
  // publish. Add admin-role check here before production.
  const session = await getCurrentSession()
  if (!session) {
    redirect('/launch')
  }

  return (
    <div className="min-h-screen bg-muted flex flex-col">
      <header className="glass-effect border-b border-border sticky top-0 z-30 px-6 py-3 flex items-center gap-4">
        <Link
          href="/policies"
          className="flex items-center gap-2 text-primary font-semibold text-sm hover:opacity-80 transition-opacity"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
          </svg>
          Admin · Policies
        </Link>
        <nav className="flex items-center gap-1 ml-2" aria-label="Admin">
          <AdminNavLink href="/policies">Policies</AdminNavLink>
          <AdminNavLink href="/queue">Back to Queue</AdminNavLink>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground">
          <span title={session.fhirUser}>Signed in</span>
        </div>
      </header>
      <div className="flex flex-1 min-h-0">
        <aside className="hidden md:flex md:w-56 flex-col border-r border-border bg-surface/60">
          <nav className="px-3 py-4 space-y-1" aria-label="Admin sidebar">
            <SideNavLink href="/policies">All policies</SideNavLink>
            <SideNavLink href="/policies?status=draft">Drafts</SideNavLink>
            <SideNavLink href="/policies?status=published">Published</SideNavLink>
            <SideNavLink href="/policies?status=retired">Retired</SideNavLink>
          </nav>
        </aside>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}

function AdminNavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-surface-foreground hover:bg-muted transition-colors"
    >
      {children}
    </Link>
  )
}

function SideNavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="block px-3 py-2 text-sm text-surface-foreground rounded-md hover:bg-muted transition-colors"
    >
      {children}
    </Link>
  )
}
