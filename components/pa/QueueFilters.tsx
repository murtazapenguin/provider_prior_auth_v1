'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { ALL_CATEGORIES } from '@/lib/dashboard/serviceCategory'

interface QueueFiltersProps {
  /** Number of records currently in the result set. */
  recordCount: number
}

/**
 * Top filter bar for the Work Queue page — search box + 3 dropdowns +
 * record count. Updates URL on every change (replace, no scroll) so the
 * server re-renders the filtered list.
 */
export default function QueueFilters({ recordCount }: QueueFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  // Local input state for the search box — debounce URL updates.
  const [search, setSearch] = useState(searchParams.get('q') ?? '')

  // Keep local state in sync when URL changes via other means (back/forward).
  useEffect(() => {
    setSearch(searchParams.get('q') ?? '')
  }, [searchParams])

  // Debounced URL update for search input.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (search === (searchParams.get('q') ?? '')) return
      updateParam('q', search)
    }, 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    // Clear preset view when any individual filter is set.
    if (key !== 'view' && value) params.delete('view')
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    })
  }

  const currentStatus = searchParams.get('status') ?? ''
  const currentService = searchParams.get('service') ?? ''
  const currentPriority = searchParams.get('priority') ?? ''
  const currentView = searchParams.get('view') ?? ''

  const anyFilterActive =
    currentStatus || currentService || currentPriority || currentView || search

  function clearAll() {
    startTransition(() => {
      router.replace(pathname, { scroll: false })
    })
    setSearch('')
  }

  return (
    <div className="bg-surface rounded-xl border border-border shadow-sm p-4 flex flex-col gap-3">
      <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
            strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patient, payer, PA id…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-muted/40 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>

        {/* Status */}
        <select
          value={currentStatus}
          onChange={(e) => updateParam('status', e.target.value)}
          className="px-3 py-2 text-sm rounded-lg border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="pending_submission">Pending Submission</option>
          <option value="ready_for_submission">Ready to Submit</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Review</option>
          <option value="rfi">RFI</option>
          <option value="approved">Approved</option>
          <option value="denied">Denied</option>
          <option value="partial_approval">Partial Approval</option>
          <option value="partial_denial">Partial Denial</option>
          <option value="withdrawn">Withdrawn</option>
        </select>

        {/* Service category */}
        <select
          value={currentService}
          onChange={(e) => updateParam('service', e.target.value)}
          className="px-3 py-2 text-sm rounded-lg border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">All Services</option>
          {ALL_CATEGORIES.filter((c) => c.key !== 'other').map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>

        {/* Priority */}
        <select
          value={currentPriority}
          onChange={(e) => updateParam('priority', e.target.value)}
          className="px-3 py-2 text-sm rounded-lg border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">All Priorities</option>
          <option value="urgent">Urgent</option>
          <option value="expedited">Expedited</option>
          <option value="standard">Standard</option>
        </select>

        {/* Record count + clear */}
        <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {pending ? 'Loading…' : `${recordCount} ${recordCount === 1 ? 'record' : 'records'}`}
          </span>
          {anyFilterActive && (
            <button
              type="button"
              onClick={clearAll}
              className="text-primary hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
