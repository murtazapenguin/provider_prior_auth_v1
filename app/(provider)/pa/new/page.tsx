'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Spinner } from '@/components/ui'
import PrioritySelector, { type Priority } from '@/components/pa/PrioritySelector'

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3
type PatientMode = 'existing' | 'new'
type NecessityStatus = 'pa_required' | 'not_required' | null

interface Payer {
  id: string
  name: string
}

interface PatientResult {
  id: string
  firstName: string
  lastName: string
  dob: string
}

interface WizardState {
  step: Step
  // Step 1
  codeType: 'CPT' | 'HCPCS'
  code: string
  payerId: string
  payers: Payer[]
  necessityStatus: NecessityStatus
  policyTitle: string | null
  // Step 2
  patientMode: PatientMode
  patientSearch: string
  patientResults: PatientResult[]
  selectedPatient: PatientResult | null
  newPatient: {
    firstName: string
    lastName: string
    dob: string
    sex: string
    memberId: string
    planName: string
  }
  // Step 3
  priority: Priority
  priorityRationale: string
  // UI state
  isLoading: boolean
  error: string | null
}

// ─── Step Indicator ───────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  const steps = [
    { num: 1, label: 'Code & Payer' },
    { num: 2, label: 'Patient' },
    { num: 3, label: 'Confirm' },
  ]
  return (
    <div className="flex items-center gap-2">
      {steps.map(({ num, label }, i) => {
        const active = num === step
        const done = num < step
        return (
          <div key={num} className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <div
                className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                  active
                    ? 'bg-primary text-white'
                    : done
                    ? 'bg-primary/20 text-primary'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {num}
              </div>
              <span
                className={`text-sm font-medium ${
                  active ? 'text-surface-foreground' : 'text-muted-foreground'
                }`}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="h-px w-6 bg-border shrink-0" />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NewPaPage() {
  const router = useRouter()

  const [state, setState] = useState<WizardState>({
    step: 1,
    codeType: 'CPT',
    code: '',
    payerId: '',
    payers: [],
    necessityStatus: null,
    policyTitle: null,
    patientMode: 'existing',
    patientSearch: '',
    patientResults: [],
    selectedPatient: null,
    newPatient: { firstName: '', lastName: '', dob: '', sex: '', memberId: '', planName: '' },
    priority: 'standard',
    priorityRationale: '',
    isLoading: false,
    error: null,
  })

  // ─── Load payers on mount ───────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/payers')
      .then((r) => r.json())
      .then((data: Payer[]) => {
        // Don't auto-select — make the provider pick deliberately
        setState((prev) => ({ ...prev, payers: data }))
      })
      .catch(() => {
        // Payer list is non-fatal — user can still type manually
      })
  }, [])

  // ─── Patient search debounce ────────────────────────────────────────────────
  useEffect(() => {
    const q = state.patientSearch.trim()
    if (!q) {
      setState((prev) => ({ ...prev, patientResults: [] }))
      return
    }
    const timer = setTimeout(() => {
      fetch(`/api/patients?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((data: PatientResult[]) => {
          setState((prev) => ({ ...prev, patientResults: data }))
        })
        .catch(() => {
          setState((prev) => ({ ...prev, patientResults: [] }))
        })
    }, 300)
    return () => clearTimeout(timer)
  }, [state.patientSearch])

  // ─── Helpers ────────────────────────────────────────────────────────────────

  const set = useCallback(
    <K extends keyof WizardState>(key: K, value: WizardState[K]) => {
      setState((prev) => ({ ...prev, [key]: value }))
    },
    []
  )

  const setNewPatientField = useCallback(
    (field: keyof WizardState['newPatient'], value: string) => {
      setState((prev) => ({
        ...prev,
        newPatient: { ...prev.newPatient, [field]: value },
      }))
    },
    []
  )

  const selectedPayer = state.payers.find((p) => p.id === state.payerId)

  // ─── Step 1: Check necessity ─────────────────────────────────────────────────

  async function handleCheck() {
    if (!state.code.trim() || !state.payerId) {
      set('error', 'Please enter a code and select a payer.')
      return
    }
    set('isLoading', true)
    set('error', null)
    set('necessityStatus', null)
    set('policyTitle', null)
    try {
      const res = await fetch('/api/pa/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codeType: state.codeType, code: state.code.trim(), payerId: state.payerId }),
      })
      const data = await res.json()
      if (!res.ok) {
        set('error', data?.detail ?? 'Failed to check necessity. Please try again.')
        return
      }
      setState((prev) => ({
        ...prev,
        necessityStatus: data.necessityStatus,
        policyTitle: data.policyTitle ?? null,
      }))
    } catch {
      set('error', 'Network error. Please try again.')
    } finally {
      set('isLoading', false)
    }
  }

  // ─── Step 2: Validate and advance ────────────────────────────────────────────

  function handleStep2Continue() {
    if (state.patientMode === 'existing') {
      if (!state.selectedPatient) {
        set('error', 'Please select a patient.')
        return
      }
    } else {
      const { firstName, lastName, dob, sex, memberId, planName } = state.newPatient
      if (!firstName.trim() || !lastName.trim() || !dob || !sex || !memberId.trim() || !planName.trim()) {
        set('error', 'Please fill in all patient fields.')
        return
      }
    }
    set('error', null)
    set('step', 3)
  }

  // ─── Step 3: Submit ──────────────────────────────────────────────────────────

  async function handleStartPA() {
    if (
      state.priority !== 'standard' &&
      state.priorityRationale.trim().length === 0
    ) {
      set('error', 'Rationale is required for Expedited / Urgent PAs.')
      return
    }
    set('isLoading', true)
    set('error', null)
    try {
      const body: Record<string, unknown> = {
        codeType: state.codeType,
        code: state.code.trim(),
        payerId: state.payerId,
        priority: state.priority,
        priorityRationale:
          state.priority === 'standard' ? undefined : state.priorityRationale.trim(),
      }
      if (state.patientMode === 'existing' && state.selectedPatient) {
        body.patientId = state.selectedPatient.id
      } else {
        body.newPatient = state.newPatient
      }

      const res = await fetch('/api/pa/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        set('error', data?.detail ?? 'Failed to create PA. Please try again.')
        return
      }
      router.push(`/pa/${data.paId}`)
    } catch {
      set('error', 'Network error. Please try again.')
    } finally {
      set('isLoading', false)
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-lg mx-auto px-6 py-12 flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-surface-foreground">Start Prior Authorization</h1>

      <StepIndicator step={state.step} />

      {/* ─── Step 1 ──────────────────────────────────────────────────────────── */}
      {state.step === 1 && (
        <div className="bg-surface border border-border rounded-xl shadow-sm p-6 flex flex-col gap-5">
          <h2 className="text-base font-semibold text-surface-foreground">Code &amp; Payer</h2>

          {/* Code type toggle */}
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-surface-foreground">Code type</span>
            <div className="flex gap-2">
              {(['CPT', 'HCPCS'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    set('codeType', type)
                    set('necessityStatus', null)
                    set('policyTitle', null)
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
                    state.codeType === type
                      ? 'bg-primary text-white'
                      : 'border border-border text-surface-foreground hover:bg-muted'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Procedure code */}
          <Input
            label="Procedure code"
            placeholder="e.g. 73721"
            value={state.code}
            onChange={(e) => {
              set('code', e.target.value)
              set('necessityStatus', null)
              set('policyTitle', null)
            }}
          />

          {/* Payer */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-surface-foreground" htmlFor="payer-select">
              Payer
            </label>
            <select
              id="payer-select"
              value={state.payerId}
              onChange={(e) => {
                set('payerId', e.target.value)
                set('necessityStatus', null)
                set('policyTitle', null)
              }}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-surface-foreground bg-surface focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:opacity-50 transition-colors"
            >
              <option value="" disabled>
                {state.payers.length === 0 ? 'Loading payers…' : 'Select a payer…'}
              </option>
              {state.payers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Error */}
          {state.error && (
            <div className="rounded-lg bg-danger/10 border border-danger/30 px-4 py-3 text-sm text-danger">
              {state.error}
            </div>
          )}

          {/* Check button */}
          <Button
            variant="primary"
            onClick={handleCheck}
            loading={state.isLoading}
            disabled={!state.code.trim() || !state.payerId}
          >
            Check
          </Button>

          {/* Result: not required */}
          {state.necessityStatus === 'not_required' && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              No prior authorization required for <strong>{state.code.toUpperCase()}</strong>
              {selectedPayer ? ` with ${selectedPayer.name}` : ''}. This procedure does not require
              prior auth from this payer.
            </div>
          )}

          {/* Result: required */}
          {state.necessityStatus === 'pa_required' && (
            <div className="flex flex-col gap-3">
              <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
                Prior authorization required —{' '}
                <strong>{state.policyTitle ?? 'Policy found'}</strong>
              </div>
              <Button
                variant="primary"
                onClick={() => {
                  set('error', null)
                  set('step', 2)
                }}
              >
                Continue →
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ─── Step 2 ──────────────────────────────────────────────────────────── */}
      {state.step === 2 && (
        <div className="bg-surface border border-border rounded-xl shadow-sm p-6 flex flex-col gap-5">
          <h2 className="text-base font-semibold text-surface-foreground">Select or create a patient</h2>

          {/* Patient mode toggle */}
          <div className="flex gap-2">
            {([
              { value: 'existing', label: 'Existing patient' },
              { value: 'new', label: 'New patient' },
            ] as const).map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  set('patientMode', value)
                  set('error', null)
                }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${
                  state.patientMode === value
                    ? 'bg-primary text-white'
                    : 'border border-border text-surface-foreground hover:bg-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Existing patient search */}
          {state.patientMode === 'existing' && (
            <div className="flex flex-col gap-3">
              <Input
                label="Search patients"
                placeholder="Search by name…"
                value={state.patientSearch}
                onChange={(e) => set('patientSearch', e.target.value)}
              />

              {state.patientSearch.trim() && state.patientResults.length === 0 && (
                <p className="text-sm text-muted-foreground italic">
                  No patients match &ldquo;{state.patientSearch.trim()}&rdquo;.
                </p>
              )}

              {state.patientResults.length > 0 && (
                <div className="flex flex-col gap-1 border border-border rounded-lg overflow-hidden">
                  {state.patientResults.map((patient) => (
                    <button
                      key={patient.id}
                      type="button"
                      onClick={() => set('selectedPatient', patient)}
                      className={`px-4 py-2.5 text-sm text-left transition-colors focus:outline-none ${
                        state.selectedPatient?.id === patient.id
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-surface-foreground hover:bg-muted'
                      }`}
                    >
                      {patient.firstName} {patient.lastName}{' '}
                      <span className="text-muted-foreground">
                        (DOB: {new Date(patient.dob).toLocaleDateString()})
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {state.selectedPatient && (
                <p className="text-sm text-muted-foreground">
                  Selected:{' '}
                  <span className="font-medium text-surface-foreground">
                    {state.selectedPatient.firstName} {state.selectedPatient.lastName}
                  </span>
                </p>
              )}
            </div>
          )}

          {/* New patient fields */}
          {state.patientMode === 'new' && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="First name"
                  value={state.newPatient.firstName}
                  onChange={(e) => setNewPatientField('firstName', e.target.value)}
                />
                <Input
                  label="Last name"
                  value={state.newPatient.lastName}
                  onChange={(e) => setNewPatientField('lastName', e.target.value)}
                />
              </div>
              <Input
                label="Date of birth"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={state.newPatient.dob}
                onChange={(e) => setNewPatientField('dob', e.target.value)}
              />
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-surface-foreground" htmlFor="sex-select">
                  Sex
                </label>
                <select
                  id="sex-select"
                  value={state.newPatient.sex}
                  onChange={(e) => setNewPatientField('sex', e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm text-surface-foreground bg-surface focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:opacity-50 transition-colors"
                >
                  <option value="" disabled>
                    Select…
                  </option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <Input
                label="Member ID"
                value={state.newPatient.memberId}
                onChange={(e) => setNewPatientField('memberId', e.target.value)}
              />
              <Input
                label="Plan name"
                value={state.newPatient.planName}
                onChange={(e) => setNewPatientField('planName', e.target.value)}
              />
            </div>
          )}

          {/* Error */}
          {state.error && (
            <div className="rounded-lg bg-danger/10 border border-danger/30 px-4 py-3 text-sm text-danger">
              {state.error}
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => {
                set('step', 1)
                set('error', null)
              }}
            >
              ← Back
            </Button>
            <Button variant="primary" onClick={handleStep2Continue} className="flex-1">
              Continue →
            </Button>
          </div>
        </div>
      )}

      {/* ─── Step 3 ──────────────────────────────────────────────────────────── */}
      {state.step === 3 && (
        <div className="bg-surface border border-border rounded-xl shadow-sm p-6 flex flex-col gap-5">
          <h2 className="text-base font-semibold text-surface-foreground">Ready to create PA</h2>

          {/* Summary */}
          <div className="flex flex-col gap-3">
            <SummaryRow label="Code" value={`${state.codeType} ${state.code.toUpperCase()}`} />
            <SummaryRow label="Policy" value={state.policyTitle ?? '—'} />
            <SummaryRow
              label="Payer"
              value={selectedPayer?.name ?? state.payerId}
            />
            <SummaryRow
              label="Patient"
              value={
                state.patientMode === 'existing' && state.selectedPatient
                  ? `${state.selectedPatient.firstName} ${state.selectedPatient.lastName}`
                  : `New patient: ${state.newPatient.firstName} ${state.newPatient.lastName}`
              }
            />
          </div>

          <div className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
            You&apos;ll be able to upload clinical records from the PA detail page.
          </div>

          {/* Priority */}
          <PrioritySelector
            priority={state.priority}
            rationale={state.priorityRationale}
            onPriorityChange={(p) => {
              set('priority', p)
              if (p === 'standard') set('priorityRationale', '')
              set('error', null)
            }}
            onRationaleChange={(r) => set('priorityRationale', r)}
            disabled={state.isLoading}
          />

          {/* Error */}
          {state.error && (
            <div className="rounded-lg bg-danger/10 border border-danger/30 px-4 py-3 text-sm text-danger">
              {state.error}
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => {
                set('step', 2)
                set('error', null)
              }}
            >
              ← Back
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleStartPA}
              disabled={state.isLoading}
            >
              {state.isLoading ? (
                <span className="flex items-center gap-2">
                  <Spinner size="sm" />
                  Creating…
                </span>
              ) : (
                'Start PA'
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Summary row ─────────────────────────────────────────────────────────────

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm gap-4 items-start">
      <span className="text-muted-foreground font-medium shrink-0">{label}</span>
      <span className="text-surface-foreground text-right min-w-0 break-words">{value}</span>
    </div>
  )
}
