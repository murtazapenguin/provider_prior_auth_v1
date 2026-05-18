import type { ReactNode } from 'react'
import Link from 'next/link'

interface AppShellProps {
  children: ReactNode
}

export default function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-muted flex flex-col">
      <header className="glass-effect border-b border-border sticky top-0 z-30 px-6 py-3 flex items-center gap-4">
        <Link href="/queue" className="flex items-center gap-2 text-primary font-semibold text-sm hover:opacity-80 transition-opacity">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
          </svg>
          PA Workflow
        </Link>
        <nav className="flex items-center gap-1 ml-2">
          <NavLink href="/queue">Work Queue</NavLink>
          <NavLink href="/demo">Demo Launcher</NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground">
          <span>Demo Provider</span>
        </div>
      </header>
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-surface-foreground hover:bg-muted transition-colors"
    >
      {children}
    </Link>
  )
}
