import type { ReactNode } from 'react'
import Sidebar from './Sidebar'
import { getNeedsAttentionCount } from '@/lib/dashboard/queueViews'

/**
 * App layout wrapper for the (provider) route group.
 * Sidebar on the left (desktop), main content fills the rest.
 *
 * Fetches the sidebar count badges server-side on every request — keeps
 * the "Work Queue: 3" badge accurate as PAs flow through the pipeline.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const workQueueAttention = await getNeedsAttentionCount().catch(() => 0)

  return (
    <div className="min-h-screen bg-muted flex">
      <Sidebar counts={{ workQueueAttention }} />
      <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
    </div>
  )
}
