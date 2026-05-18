'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { StatusPill, Spinner, Button } from '@/components/ui'
import type { PaStatus } from '@/components/ui'

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueueBucket = 'action' | 'parked' | 'submitted'

interface PaItem {
  id: string
  status: PaStatus
  updatedAt: string
  pendingSubmissionExpiresAt: string | null
  encounter: {
    patient: {
      firstName: string
      lastName: string
    }
  }
  payer: {
    name: string
  }
  codes: Array<{
    code: string
    codeType: string
    description: string
    isPrimary: boolean
  }>
}

interface QueueResponse {
  items: PaItem[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso))
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const diff = new Date(iso).getTime() - Date.now()
  return Math.ceil(diff / 86_400_000)
}

function linkForItem(item: PaItem): string {
  // Non-terminal submitted statuses → tracker view (live payer state).
  // Terminal/adjudicated statuses → detail page (tracker isn't useful once decided).
  switch (item.status) {
    case 'pending':
    case 'in_progress':
      return `/pa/${item.id}/tracker`
    default:
      return `/pa/${item.id}`
  }
}

// ─── Sorting ──────────────────────────────────────────────────────────────────

type SortField = 'patient' | 'code' | 'payer' | 'status' | 'updatedAt' | 'expires'
type SortDir = 'asc' | 'desc'

function sortItems(items: PaItem[], field: SortField, dir: SortDir): PaItem[] {
  return [...items].sort((a, b) => {
    let va: string | number = ''
    let vb: string | number = ''
    switch (field) {
      case 'patient':
        va = `${a.encounter.patient.lastName} ${a.encounter.patient.firstName}`
        vb = `${b.encounter.patient.lastName} ${b.encounter.patient.firstName}`
        break
      case 'code':
        va = a.codes[0]?.code ?? ''
        vb = b.codes[0]?.code ?? ''
        break
      case 'payer':
        va = a.payer?.name ?? ''
        vb = b.payer?.name ?? ''
        break
      case 'status':
        va = a.status
        vb = b.status
        break
      case 'updatedAt':
        va = new Date(a.updatedAt).getTime()
        vb = new Date(b.updatedAt).getTime()
        break
      case 'expires':
        va = a.pendingSubmissionExpiresAt ? new Date(a.pendingSubmissionExpiresAt).getTime() : Infinity
        vb = b.pendingSubmissionExpiresAt ? new Date(b.pendingSubmissionExpiresAt).getTime() : Infinity
        break
    }
    if (va < vb) return dir === 'asc' ? -1 : 1
    if (va > vb) return dir === 'asc' ? 1 : -1
    return 0
  })
}

// ─── Column header ────────────────────────────────────────────────────────────

function SortTh({
  field,
  label,
  current,
  dir,
  onSort,
}: {
  field: SortField
  label: string
  current: SortField
  dir: SortDir
  onSort: (f: SortField) => void
}) {
  const active = field === current
  return (
    <th
      scope="col"
      className="py-2.5 px-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer select-none hover:text-surface-foreground whitespace-nowrap"
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={active ? 'text-primary' : 'opacity-30'} aria-hidden>
          {active ? (dir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </span>
    </th>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

const BUCKET_EMPTY: Record<QueueBucket, { title: string; body: string }> = {
  action: {
    title: 'No PAs need action right now',
    body: 'Drafts in progress, PAs ready to submit, and payer RFIs awaiting your response will appear here.',
  },
  parked: {
    title: 'Nothing parked',
    body: 'PAs saved for later will appear here. They expire after 60 days of inactivity.',
  },
  submitted: {
    title: 'No submitted PAs',
    body: 'Submitted PAs appear here. Watch for status changes from the payer.',
  },
}

function EmptyState({ bucket }: { bucket: QueueBucket }) {
  const { title, body } = BUCKET_EMPTY[bucket]
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
      {/* Illustration placeholder */}
      <div className="h-20 w-20 rounded-2xl bg-muted flex items-center justify-center">
        <svg className="h-10 w-10 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          />
        </svg>
      </div>
      <div>
        <p className="font-semibold text-surface-foreground">{title}</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">{body}</p>
      </div>
      <Link
        href="/demo"
        className="inline-flex items-center justify-center px-3 py-1.5 text-sm font-medium rounded-lg border border-border text-surface-foreground bg-transparent hover:bg-muted transition-colors"
      >
        Try a demo scenario
      </Link>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface QueueTableProps {
  bucket: QueueBucket
  /** If true, start fetching immediately. If false (lazy), wait until activated. */
  active: boolean
}

export default function QueueTable({ bucket, active }: QueueTableProps) {
  const [items, setItems] = useState<PaItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [sortField, setSortField] = useState<SortField>('updatedAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const hasFetched = useRef(false)

  const fetchPage = useCallback(
    async (p: number) => {
      setLoading(true)
      setError(null)
      try {
        const url = `/api/queue?queue=${bucket}&page=${p}&page_size=20`
        const res = await fetch(url)
        if (!res.ok) throw new Error(`Failed to load queue (${res.status})`)
        const data: QueueResponse = await res.json()
        setItems(data.items)
        setPage(data.page)
        setTotalPages(data.total_pages)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      } finally {
        setLoading(false)
      }
    },
    [bucket],
  )

  useEffect(() => {
    if (active && !hasFetched.current) {
      hasFetched.current = true
      fetchPage(1)
    }
  }, [active, fetchPage])

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const sorted = sortItems(items, sortField, sortDir)
  const showExpires = bucket === 'parked'

  if (loading && items.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center py-16 gap-3 text-center">
        <p className="text-sm text-danger">{error}</p>
        <Button variant="outline" size="sm" onClick={() => fetchPage(page)}>
          Retry
        </Button>
      </div>
    )
  }

  if (!loading && items.length === 0) {
    return <EmptyState bucket={bucket} />
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted border-b border-border">
            <tr>
              <SortTh field="patient" label="Patient" current={sortField} dir={sortDir} onSort={handleSort} />
              <SortTh field="code" label="Code" current={sortField} dir={sortDir} onSort={handleSort} />
              <SortTh field="payer" label="Payer" current={sortField} dir={sortDir} onSort={handleSort} />
              <SortTh field="status" label="Status" current={sortField} dir={sortDir} onSort={handleSort} />
              <SortTh field="updatedAt" label="Last update" current={sortField} dir={sortDir} onSort={handleSort} />
              {showExpires && (
                <SortTh field="expires" label="Expires in" current={sortField} dir={sortDir} onSort={handleSort} />
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-surface">
            {sorted.map((item) => {
              const primaryCode = item.codes[0]
              const patient = item.encounter.patient
              const href = linkForItem(item)
              const days = showExpires ? daysUntil(item.pendingSubmissionExpiresAt) : null

              return (
                <tr
                  key={item.id}
                  className="hover:bg-muted transition-colors cursor-pointer"
                >
                  <td className="py-3 px-3 font-medium text-surface-foreground whitespace-nowrap">
                    <Link href={href} className="hover:text-primary transition-colors">
                      {patient.firstName} {patient.lastName}
                    </Link>
                  </td>
                  <td className="py-3 px-3 text-muted-foreground whitespace-nowrap">
                    {primaryCode ? (
                      <span>
                        <span className="font-mono text-surface-foreground">{primaryCode.code}</span>
                        {primaryCode.description && (
                          <span className="ml-1.5 text-xs text-muted-foreground truncate max-w-[180px] inline-block align-middle">
                            {primaryCode.description}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted-foreground italic">No code</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-muted-foreground whitespace-nowrap">
                    {item.payer?.name ?? '—'}
                  </td>
                  <td className="py-3 px-3 whitespace-nowrap">
                    <StatusPill status={item.status} size="sm" />
                  </td>
                  <td className="py-3 px-3 text-muted-foreground whitespace-nowrap text-xs">
                    {formatDate(item.updatedAt)}
                  </td>
                  {showExpires && (
                    <td className="py-3 px-3 whitespace-nowrap">
                      {days !== null ? (
                        <span
                          className={`text-xs font-medium ${
                            days <= 7 ? 'text-danger' : days <= 14 ? 'text-amber-600' : 'text-muted-foreground'
                          }`}
                        >
                          {days}d
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => fetchPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => fetchPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
