'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { StatusPill, Button, Card, Spinner, Modal, Dropzone, Textarea, useToast, ToastContainer } from '@/components/ui'
import type { PaStatus } from '@/components/ui/StatusPill'

// ─── Types mirroring the GET /api/pa/:id response ────────────────────────────

interface PaEvent {
  id: string
  type: string
  fromStatus: string | null
  toStatus: string | null
  actor: string
  metadata: Record<string, unknown>
  createdAt: string
}

interface PaCode {
  codeType: string
  code: string
  description: string
  modifier: string | null
}

interface PaData {
  id: string
  status: string
  trackingId: string | null
  statusReason: string | null
  submittedAt: string | null
  payerExpiresAt: string | null
  payer: { name: string }
  encounter: {
    patient: { firstName: string; lastName: string }
  }
  codes: PaCode[]
  events: PaEvent[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set([
  'voided', 'cancelled', 'expired', 'approved', 'denied',
  'partial_approval', 'partial_denial', 'withdrawn',
])

const POLLING_STATUSES = new Set(['pending', 'in_progress'])

const NEXT_STATE_HINT: Partial<Record<string, string>> = {
  pending: 'Payer reviewer should pick this up in ~30 seconds.',
  in_progress: 'Payer is reviewing the request. Outcome expected in ~90 seconds.',
  rfi: 'Awaiting your response to the payer request for information.',
}

// ─── RFI Respond Modal ────────────────────────────────────────────────────────

interface RfiRespondModalProps {
  paId: string
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

function RfiRespondModal({ paId, open, onClose, onSuccess }: RfiRespondModalProps) {
  const [rationale, setRationale] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const { toasts, addToast, removeToast } = useToast()

  async function handleSubmit() {
    if (!rationale.trim()) {
      addToast('A written rationale is required.', 'warning')
      return
    }
    setSubmitting(true)
    try {
      // If files were attached, upload them first
      if (files.length > 0) {
        for (const file of files) {
          const form = new FormData()
          form.append('file', file)
          const upRes = await fetch(`/api/pa/${paId}/upload`, { method: 'POST', body: form })
          if (!upRes.ok) {
            const body = await upRes.json().catch(() => ({}))
            throw new Error(body.detail ?? `Upload failed: ${file.name}`)
          }
        }
      }

      // Submit RFI response with rationale
      const res = await fetch(`/api/pa/${paId}/rfi-respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rationale: rationale.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? `Server error ${res.status}`)
      }
      setRationale('')
      setFiles([])
      onClose()
      onSuccess()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to submit RFI response'
      addToast(message, 'error')
      setSubmitting(false)
    }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="Respond to RFI" size="xl">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Provide your written response to the payer&apos;s request for information. You may
            optionally attach supporting documents.
          </p>

          <div>
            <label className="block text-sm font-medium text-surface-foreground mb-1">
              Response rationale <span className="text-danger">*</span>
            </label>
            <Textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Explain how the clinical evidence satisfies the payer's question…"
              rows={5}
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-surface-foreground mb-1">
              Supporting documents (optional)
            </label>
            <Dropzone
              onFiles={(f) => setFiles((prev) => [...prev, ...f])}
              multiple
              accept=".pdf,.docx,.txt,.png,.jpg,.jpeg"
              disabled={submitting}
              hint="PDF, DOCX, TXT, PNG, JPG"
            />
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{f.name}</span>
                    <button
                      className="text-danger hover:opacity-80"
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      disabled={submitting}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} loading={submitting} disabled={submitting || !rationale.trim()}>
              Submit response
            </Button>
          </div>
        </div>
      </Modal>
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </>
  )
}

// ─── Event timeline ───────────────────────────────────────────────────────────

function EventTimeline({ events }: { events: PaEvent[] }) {
  if (!events.length) return null
  return (
    <div className="space-y-3">
      {events.map((ev) => (
        <div key={ev.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className="h-2.5 w-2.5 rounded-full bg-primary mt-1.5 shrink-0" />
            <div className="flex-1 w-px bg-border mt-1" />
          </div>
          <div className="pb-3 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-surface-foreground capitalize">
                {ev.type.replace(/_/g, ' ')}
              </span>
              {ev.fromStatus && ev.toStatus && (
                <span className="text-xs text-muted-foreground">
                  {ev.fromStatus.replace(/_/g, ' ')} &rarr; {ev.toStatus.replace(/_/g, ' ')}
                </span>
              )}
            </div>
            {typeof ev.metadata?.rfi_message === 'string' && (
              <p className="mt-1 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
                &ldquo;{ev.metadata.rfi_message}&rdquo;
              </p>
            )}
            {typeof ev.metadata?.rationale === 'string' && (
              <p className="mt-1 text-xs text-muted-foreground italic truncate">
                {ev.metadata.rationale}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(ev.createdAt).toLocaleString()} &middot; {ev.actor}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Main Tracker ─────────────────────────────────────────────────────────────

interface TrackerProps {
  paId: string
  initialData: PaData
}

export default function Tracker({ paId, initialData }: TrackerProps) {
  const [pa, setPa] = useState<PaData>(initialData)
  const [rfiOpen, setRfiOpen] = useState(false)
  const { toasts, addToast, removeToast } = useToast()

  const status = pa.status as PaStatus
  const isTerminal = TERMINAL_STATUSES.has(status)
  const shouldPoll = POLLING_STATUSES.has(status)

  // ─── Fetch latest PA data ────────────────────────────────────────────────
  const fetchPa = useCallback(async () => {
    try {
      const res = await fetch(`/api/pa/${paId}`)
      if (!res.ok) return
      const data: PaData = await res.json()
      setPa(data)
    } catch {
      // Silently ignore transient network errors during polling
    }
  }, [paId])

  // ─── Polling loop ────────────────────────────────────────────────────────
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const startPolling = useCallback(() => {
    stopPolling()
    intervalRef.current = setInterval(fetchPa, 2000)
  }, [fetchPa, stopPolling])

  useEffect(() => {
    if (!shouldPoll) {
      stopPolling()
      return
    }

    // Only poll when tab is visible
    function onVisibility() {
      if (document.visibilityState === 'visible') {
        startPolling()
      } else {
        stopPolling()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    if (document.visibilityState === 'visible') {
      startPolling()
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stopPolling()
    }
  }, [shouldPoll, startPolling, stopPolling])

  // ─── Find RFI message from events ───────────────────────────────────────
  const rfiEvent = pa.events
    .slice()
    .reverse()
    .find((ev) => ev.type === 'status_changed' && ev.toStatus === 'rfi')
  const rfiMessage =
    typeof rfiEvent?.metadata?.rfi_message === 'string'
      ? rfiEvent.metadata.rfi_message
      : null

  // ─── Withdraw handler ────────────────────────────────────────────────────
  async function handleWithdraw() {
    if (!confirm('Are you sure you want to withdraw this PA? This cannot be undone.')) return
    try {
      const res = await fetch(`/api/pa/${paId}/withdraw`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? 'Withdraw failed')
      }
      await fetchPa()
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Withdraw failed', 'error')
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-surface-foreground">
            {pa.encounter.patient.firstName} {pa.encounter.patient.lastName}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {pa.payer.name}
            {pa.trackingId && (
              <span className="ml-2 font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                {pa.trackingId}
              </span>
            )}
          </p>
        </div>
        <Link href="/queue">
          <Button variant="secondary" size="sm">Back to queue</Button>
        </Link>
      </div>

      {/* Status card */}
      <Card>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <StatusPill status={status} size="md" className="text-sm px-3 py-1.5 text-sm" />
            {shouldPoll && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                Live
              </span>
            )}
          </div>
          {!isTerminal && !['rfi'].includes(status) && (
            <Button variant="ghost" size="sm" onClick={handleWithdraw} className="text-danger">
              Withdraw
            </Button>
          )}
        </div>

        {/* Status hint */}
        {NEXT_STATE_HINT[status] && (
          <p className="mt-3 text-sm text-muted-foreground">{NEXT_STATE_HINT[status]}</p>
        )}

        {/* Approved details */}
        {(status === 'approved' || status === 'partial_approval') && (
          <div className="mt-3 space-y-1">
            {pa.payerExpiresAt && (
              <p className="text-sm text-surface-foreground">
                <span className="font-medium">Authorization valid until: </span>
                {new Date(pa.payerExpiresAt).toLocaleDateString()}
              </p>
            )}
            {pa.statusReason && (
              <p className="text-sm text-muted-foreground">{pa.statusReason}</p>
            )}
          </div>
        )}

        {/* Denied / withdrawn details */}
        {(status === 'denied' || status === 'partial_denial' || status === 'withdrawn') && pa.statusReason && (
          <p className="mt-3 text-sm text-muted-foreground">{pa.statusReason}</p>
        )}
      </Card>

      {/* RFI callout */}
      {status === 'rfi' && (
        <Card className="border-amber-300 bg-amber-50">
          <div className="flex items-start gap-3">
            <svg className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-900">Request for Information</p>
              {rfiMessage ? (
                <p className="mt-1 text-sm text-amber-800">&ldquo;{rfiMessage}&rdquo;</p>
              ) : (
                <p className="mt-1 text-sm text-amber-700">
                  The payer has requested additional information. Please respond below.
                </p>
              )}
              <div className="mt-3">
                <Button onClick={() => setRfiOpen(true)}>Respond to RFI</Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Codes summary */}
      {pa.codes.length > 0 && (
        <Card>
          <h2 className="text-sm font-semibold text-surface-foreground mb-3">Codes</h2>
          <div className="space-y-2">
            {pa.codes.map((c) => (
              <div key={`${c.codeType}-${c.code}`} className="flex items-start gap-2">
                <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-primary shrink-0">
                  {c.code}{c.modifier ? `-${c.modifier}` : ''}
                </span>
                <span className="text-xs text-muted-foreground">{c.description}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Timeline */}
      <Card>
        <h2 className="text-sm font-semibold text-surface-foreground mb-4">Activity timeline</h2>
        {pa.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        ) : (
          <EventTimeline events={[...pa.events].reverse()} />
        )}
      </Card>

      {/* RFI modal */}
      <RfiRespondModal
        paId={paId}
        open={rfiOpen}
        onClose={() => setRfiOpen(false)}
        onSuccess={() => {
          setRfiOpen(false)
          fetchPa()
        }}
      />

      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  )
}
