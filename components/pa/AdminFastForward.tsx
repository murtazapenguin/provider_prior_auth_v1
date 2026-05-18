'use client'

import { useState } from 'react'
import { Button, useToast, ToastContainer } from '@/components/ui'

interface AdminFastForwardProps {
  paId: string
}

export default function AdminFastForward({ paId }: AdminFastForwardProps) {
  // Only render in non-production environments
  if (process.env.NODE_ENV === 'production') return null

  return <AdminFastForwardInner paId={paId} />
}

function AdminFastForwardInner({ paId }: AdminFastForwardProps) {
  const [loading, setLoading] = useState(false)
  const { toasts, addToast, removeToast } = useToast()

  async function handleFastForward() {
    setLoading(true)
    try {
      const res = await fetch('/api/simulator/fast-forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? `Error ${res.status}`)
      }
      const data = await res.json()
      addToast(
        `Fast-forwarded: ${data.transitioned ?? 0} transition(s) applied`,
        'success',
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Fast-forward failed'
      addToast(message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="fixed bottom-6 right-6 z-50">
        <button
          onClick={handleFastForward}
          disabled={loading}
          title="[DEV] Fast-forward simulator"
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-100 border border-amber-300 text-amber-900 text-xs font-medium shadow-lg hover:bg-amber-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          )}
          Fast-forward
        </button>
      </div>
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </>
  )
}
