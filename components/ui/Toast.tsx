'use client'

import { useEffect, type ReactNode } from 'react'

type ToastVariant = 'success' | 'error' | 'warning' | 'info'

interface ToastProps {
  message: string
  variant?: ToastVariant
  duration?: number
  onDismiss: () => void
}

const ICONS: Record<ToastVariant, ReactNode> = {
  success: (
    <svg className="h-5 w-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  ),
  error: (
    <svg className="h-5 w-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  warning: (
    <svg className="h-5 w-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
  ),
  info: (
    <svg className="h-5 w-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
}

export default function Toast({ message, variant = 'info', duration = 4000, onDismiss }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onDismiss, duration)
    return () => clearTimeout(t)
  }, [duration, onDismiss])

  return (
    <div
      role="alert"
      className="flex items-start gap-3 bg-surface border border-border rounded-xl shadow-lg px-4 py-3 max-w-sm pointer-events-auto"
    >
      <span className="mt-0.5 shrink-0">{ICONS[variant]}</span>
      <p className="text-sm text-surface-foreground flex-1">{message}</p>
      <button onClick={onDismiss} className="text-muted-foreground hover:text-surface-foreground shrink-0">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

// ─── useToast hook ─────────────────────────────────────────────────────────────

import { useState, useCallback } from 'react'

interface ToastItem {
  id: string
  message: string
  variant: ToastVariant
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const addToast = useCallback((message: string, variant: ToastVariant = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, message, variant }])
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  return { toasts, addToast, removeToast }
}

// ─── ToastContainer ────────────────────────────────────────────────────────────

interface ToastContainerProps {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (!toasts.length) return null
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <Toast key={t.id} message={t.message} variant={t.variant} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  )
}
