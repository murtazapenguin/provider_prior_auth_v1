'use client'

/**
 * app/launch/standalone/PatientPicker.tsx
 *
 * Client component for the mock-mode standalone-launch patient grid.
 *
 *  ┌──────────────────────────────────────────────────────────────────────┐
 *  │  Why a client component:                                             │
 *  │    - We track which card is "armed" so the user gets visual          │
 *  │      feedback (selected ring + scroll-into-view) before submission.  │
 *  │    - Form submission goes to the server action via                   │
 *  │      action={selectPatient} — the action lives in actions.ts.        │
 *  └──────────────────────────────────────────────────────────────────────┘
 *
 * Accessibility:
 *   - Each card is a <button type="submit" name="patientId" value="..."> so
 *     they are keyboard-reachable, focus-rings render, and Enter submits.
 *   - The role is "radio" inside a role="radiogroup" for screen readers,
 *     and aria-checked tracks selection.
 *
 * Mock-mode standalone-launch only — T10 audits.
 */

import { useState } from 'react'

export interface PatientCard {
  id: string
  firstName: string
  lastName: string
  dob: string // ISO yyyy-mm-dd from the fixture
  sex: string // "male" | "female" | other from FHIR
}

interface PatientPickerProps {
  patients: PatientCard[]
  action: (formData: FormData) => Promise<void>
}

function formatDob(dob: string): string {
  if (!dob) return '—'
  try {
    const d = new Date(dob)
    if (Number.isNaN(d.getTime())) return dob
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(d)
  } catch {
    return dob
  }
}

function ageYears(dob: string): number | null {
  try {
    const d = new Date(dob)
    if (Number.isNaN(d.getTime())) return null
    const ms = Date.now() - d.getTime()
    return Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000))
  } catch {
    return null
  }
}

export default function PatientPicker({ patients, action }: PatientPickerProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (patients.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No demo patients are available in this environment. Confirm that{' '}
          <code className="font-mono">prisma/fixtures/fhir/patient/</code> contains the
          demo fixture JSON files.
        </p>
      </div>
    )
  }

  return (
    <form
      action={async (fd) => {
        setSubmitting(true)
        try {
          await action(fd)
        } finally {
          setSubmitting(false)
        }
      }}
      aria-busy={submitting}
    >
      <div
        role="radiogroup"
        aria-label="Demo patients"
        className="grid grid-cols-1 sm:grid-cols-2 gap-4"
      >
        {patients.map((p) => {
          const age = ageYears(p.dob)
          const isSelected = selected === p.id
          return (
            <button
              key={p.id}
              type="submit"
              name="patientId"
              value={p.id}
              role="radio"
              aria-checked={isSelected}
              disabled={submitting}
              onClick={() => setSelected(p.id)}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  setSelected(p.id)
                }
              }}
              className={`text-left rounded-2xl border bg-surface p-5 transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 hover:shadow-md disabled:opacity-50 disabled:cursor-wait ${
                isSelected
                  ? 'border-primary ring-2 ring-primary'
                  : 'border-border hover:border-primary/40'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-surface-foreground">
                    {p.firstName} {p.lastName}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {age !== null ? `${age} yo` : 'age unknown'} · {p.sex || 'sex unknown'}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    DOB {formatDob(p.dob)}
                  </p>
                </div>
                {isSelected ? (
                  <span
                    aria-hidden
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold"
                  >
                    ✓
                  </span>
                ) : (
                  <span
                    aria-hidden
                    className="h-6 w-6 rounded-full border-2 border-border"
                  />
                )}
              </div>
              <p className="mt-3 text-xs font-mono text-muted-foreground truncate">
                {p.id}
              </p>
            </button>
          )
        })}
      </div>
      {submitting && (
        <p className="mt-4 text-center text-sm text-muted-foreground" role="status">
          Loading session…
        </p>
      )}
    </form>
  )
}
