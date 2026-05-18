'use client'

import { useState } from 'react'
import { Modal, Button, Textarea } from '@/components/ui'

interface ManualOverrideModalProps {
  open: boolean
  onClose: () => void
  criterionText: string
  onConfirm: (rationale: string) => Promise<void>
}

export default function ManualOverrideModal({
  open,
  onClose,
  criterionText,
  onConfirm,
}: ManualOverrideModalProps) {
  const [rationale, setRationale] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    const trimmed = rationale.trim()
    if (!trimmed) {
      setError('Rationale is required before overriding.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await onConfirm(trimmed)
      setRationale('')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Override failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function handleClose() {
    if (submitting) return
    setRationale('')
    setError(null)
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="Manual Override" size="md">
      <div className="flex flex-col gap-4">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-xs font-medium text-amber-800 uppercase tracking-wide mb-1">
            Criterion being overridden
          </p>
          <p className="text-sm text-amber-900">{criterionText}</p>
        </div>

        <p className="text-sm text-muted-foreground">
          Overriding a criterion marks it as passed in the prior authorization record. The rationale
          you provide will be recorded in the audit trail and included in the submission packet.
        </p>

        <Textarea
          label="Override rationale"
          placeholder="e.g. Amitriptyline trial is not needed because criterion 2 is already satisfied by failed trials of propranolol (beta blocker, 4 months) and topiramate (antiepileptic, 3 months)."
          rows={5}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          error={error ?? undefined}
          disabled={submitting}
        />

        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={submitting}
            disabled={!rationale.trim() || submitting}
          >
            Override criterion
          </Button>
        </div>
      </div>
    </Modal>
  )
}
