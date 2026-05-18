'use client'

/**
 * components/pa/QueueTabs.tsx
 *
 * Tab UI for the work queue. Extracted from app/(provider)/queue/page.tsx
 * unchanged so the page itself can become a Server Component that does
 * Prisma reads above the tabs (encounter / patient context banners).
 *
 * The logic, styling, ARIA roles, and behavior are byte-for-byte the same
 * as the previous client page — this is a hoist, not a rewrite.
 */

import { useState } from 'react'
import QueueTable from '@/components/pa/QueueTable'
import type { QueueBucket } from '@/components/pa/QueueTable'

const TABS: Array<{ id: QueueBucket; label: string; description: string }> = [
  {
    id: 'action',
    label: 'Action needed',
    description: 'Drafts, ready-to-submit PAs, and payer RFIs awaiting your response.',
  },
  {
    id: 'parked',
    label: 'Parked',
    description: 'Saved for later. Expire after 60 days.',
  },
  {
    id: 'submitted',
    label: 'Submitted',
    description: 'Sent to the payer. Includes pending, in-review, and adjudicated outcomes.',
  },
]

export default function QueueTabs() {
  const [activeTab, setActiveTab] = useState<QueueBucket>('action')
  const [activated, setActivated] = useState<Set<QueueBucket>>(new Set(['action']))

  function selectTab(tab: QueueBucket) {
    setActiveTab(tab)
    setActivated((prev) => {
      if (prev.has(tab)) return prev
      const next = new Set(prev)
      next.add(tab)
      return next
    })
  }

  const activeTabDef = TABS.find((t) => t.id === activeTab)!

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">{activeTabDef.description}</p>

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="-mb-px flex gap-1" role="tablist">
          {TABS.map((tab) => {
            const active = tab.id === activeTab
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={active}
                aria-controls={`panel-${tab.id}`}
                id={`tab-${tab.id}`}
                onClick={() => selectTab(tab.id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap focus:outline-none ${
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-surface-foreground hover:border-border'
                }`}
              >
                {tab.label}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Tab panels — render all but hide inactive so data is preserved */}
      {TABS.map((tab) => (
        <div
          key={tab.id}
          id={`panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab.id}`}
          hidden={tab.id !== activeTab}
        >
          <QueueTable bucket={tab.id} active={activated.has(tab.id)} />
        </div>
      ))}
    </div>
  )
}
