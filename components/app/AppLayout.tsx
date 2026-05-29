import type { ReactNode } from 'react'
import Sidebar from './Sidebar'

/**
 * App layout wrapper for the (provider) route group.
 * Sidebar on the left (desktop), main content fills the rest.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-muted flex">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
    </div>
  )
}
