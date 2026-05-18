'use client'

// Editable priority chip for the PA detail page header.
// - Renders nothing for "standard" priority (cleaner header).
// - Renders an amber/red pill for expedited/urgent.
// - When `editable`, clicking opens a modal that PATCHes /api/pa/[id]/priority.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, Button, useToast, ToastContainer } from '@/components/ui'
import PrioritySelector, { type Priority } from '@/components/pa/PrioritySelector'

interface PriorityChipProps {
  paId: string
  priority: Priority | string
  priorityRationale: string | null
  /** True when the PA's status is in the EDITABLE_STATUSES set on the server. */
  editable: boolean
}

const STYLES: Record<Priority, string> = {
  standard: 'bg-slate-100 text-slate-700',
  expedited: 'bg-amber-100 text-amber-800',
  urgent: 'bg-red-100 text-red-700',
}

const LABELS: Record<Priority, string> = {
  standard: 'Standard',
  expedited: 'Expedited',
  urgent: 'Urgent',
}

function isPriority(p: string): p is Priority {
  return p === 'standard' || p === 'expedited' || p === 'urgent'
}

export default function PriorityChip({
  paId,
  priority,
  priorityRationale,
  editable,
}: PriorityChipProps) {
  const router = useRouter()
  const { toasts, addToast, removeToast } = useToast()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const current: Priority = isPriority(priority) ? priority : 'standard'

  // Editor draft state — initialized when modal opens.
  const [draftPriority, setDraftPriority] = useState<Priority>(current)
  const [draftRationale, setDraftRationale] = useState<string>(priorityRationale ?? '')
  const [error, setError] = useState<string | null>(null)

  function openEditor() {
    setDraftPriority(current)
    setDraftRationale(priorityRationale ?? '')
    setError(null)
    setOpen(true)
  }

  async function handleSave() {
    if (
      draftPriority !== 'standard' &&
      draftRationale.trim().length === 0
    ) {
      setError('Rationale is required for Expedited / Urgent PAs.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/pa/${paId}/priority`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priority: draftPriority,
          priorityRationale:
            draftPriority === 'standard' ? undefined : draftRationale.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.detail ?? `Error ${res.status}`)
      }
      addToast('Priority updated', 'success')
      setOpen(false)
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update priority'
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  // For Standard + non-editable, render nothing — keeps the header clean.
  // For Standard + editable, render a subtle "Set priority" affordance so the
  // provider can flag a PA after creation.
  if (current === 'standard' && !editable) return null

  const chipBase =
    'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium transition-colors'

  return (
    <>
      {current === 'standard' ? (
        <button
          type="button"
          onClick={openEditor}
          className={`${chipBase} bg-slate-100 text-slate-600 border border-dashed border-slate-300 hover:bg-slate-200`}
          aria-label="Set priority"
        >
          + Set priority
        </button>
      ) : (
        <button
          type="button"
          onClick={editable ? openEditor : undefined}
          disabled={!editable}
          title={priorityRationale ?? undefined}
          className={`${chipBase} ${STYLES[current]} ${
            editable ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'
          }`}
          aria-label={
            editable ? `Edit priority (currently ${LABELS[current]})` : `Priority: ${LABELS[current]}`
          }
        >
          {LABELS[current]}
        </button>
      )}

      <Modal open={open} onClose={() => (saving ? undefined : setOpen(false))} title="Edit priority" size="md">
        <div className="flex flex-col gap-5">
          <PrioritySelector
            priority={draftPriority}
            rationale={draftRationale}
            onPriorityChange={(p) => {
              setDraftPriority(p)
              if (p === 'standard') setDraftRationale('')
              setError(null)
            }}
            onRationaleChange={(r) => setDraftRationale(r)}
            disabled={saving}
          />

          {error && (
            <div className="rounded-lg bg-danger/10 border border-danger/30 px-4 py-3 text-sm text-danger">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} loading={saving}>
              Save
            </Button>
          </div>
        </div>
      </Modal>

      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </>
  )
}
