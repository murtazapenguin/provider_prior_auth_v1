'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Modal, useToast, ToastContainer } from '@/components/ui'

interface SubmitConfirmationProps {
  paId: string
  open: boolean
  onClose: () => void
}

export default function SubmitConfirmation({ paId, open, onClose }: SubmitConfirmationProps) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const { toasts, addToast, removeToast } = useToast()

  async function handleSubmit() {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/pa/${paId}/submit`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? `Server error ${res.status}`)
      }
      onClose()
      router.push(`/pa/${paId}/tracker`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Submission failed'
      addToast(message, 'error')
      setSubmitting(false)
    }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="Submit to payer" size="md">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This will send the assembled PDF packet to the payer for review. You can monitor the
            status on the tracker page and respond to any requests for information (RFI).
          </p>
          <p className="text-sm text-muted-foreground">
            Once submitted, the PA cannot be edited. You may withdraw it if needed.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} loading={submitting} disabled={submitting}>
              Submit to payer
            </Button>
          </div>
        </div>
      </Modal>
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </>
  )
}
