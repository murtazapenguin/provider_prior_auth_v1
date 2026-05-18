/**
 * CodeReview — right panel of the encounter intake screen.
 *
 * Client Component: handles PA creation, code derivation display, and code editing.
 *
 * Flow:
 * 1. If no PA yet — renders "Begin Review" which calls POST /api/pa.
 *    After creation it re-fetches GET /api/pa/:id to load any derived codes.
 * 2. If PA exists (with or without codes) — renders the code list.
 *    Provider can edit, remove, mark primary, or add codes.
 * 3. "Continue" calls POST /api/pa/:id/codes to save edits, then routes to /pa/:id.
 */

'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Pill,
  Badge,
  Input,
  Modal,
  useToast,
  ToastContainer,
} from '@/components/ui'

// ─── Types ─────────────────────────────────────────────────────────────────────

type CodeType = 'CPT' | 'HCPCS' | 'J' | 'Q' | 'ICD10'
type DerivedBy = 'ai' | 'provider' | 'ai-then-confirmed'

export interface CodeItem {
  id?: string
  codeType: CodeType
  code: string
  modifier?: string | null
  description: string
  isPrimary: boolean
  derivedBy: DerivedBy
  confidence?: number | null
}

interface CodeReviewProps {
  encounterId: string
  existingPaId?: string | null
  initialCodes?: CodeItem[]
}

// ─── Confidence pill ───────────────────────────────────────────────────────────

function confidencePill(confidence: number | null | undefined) {
  if (confidence == null) return null
  const pct = Math.round(confidence * 100)
  let color: 'green' | 'yellow' | 'red' = 'red'
  if (confidence >= 0.85) color = 'green'
  else if (confidence >= 0.5) color = 'yellow'
  return (
    <Pill color={color} title={`AI confidence: ${pct}%`}>
      {pct}%
    </Pill>
  )
}

// ─── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
      {children}
    </p>
  )
}

// ─── Code row ─────────────────────────────────────────────────────────────────

interface CodeRowProps {
  code: CodeItem
  onEdit: (code: CodeItem) => void
  onRemove: (code: CodeItem) => void
  onSetPrimary: (code: CodeItem) => void
}

function CodeRow({ code, onEdit, onRemove, onSetPrimary }: CodeRowProps) {
  const derivedByLabel: Record<DerivedBy, string> = {
    ai: 'AI',
    provider: 'Manual',
    'ai-then-confirmed': 'AI (confirmed)',
  }

  return (
    <div
      className={`border rounded-lg p-3 flex flex-col gap-2 transition-colors ${
        code.isPrimary ? 'border-primary bg-primary/5' : 'border-border bg-surface'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        {/* Left: code + description */}
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-semibold text-sm text-surface-foreground">
              {code.codeType} {code.code}
              {code.modifier ? <span className="text-muted-foreground">-{code.modifier}</span> : null}
            </span>
            {code.isPrimary && (
              <Badge variant="success" className="text-xs">Primary</Badge>
            )}
            {confidencePill(code.confidence)}
            <Badge variant="default" className="text-xs">{derivedByLabel[code.derivedBy]}</Badge>
          </div>
          <p className="text-sm text-muted-foreground truncate">{code.description}</p>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1 shrink-0">
          {!code.isPrimary && code.codeType !== 'ICD10' && (
            <button
              className="text-xs text-muted-foreground hover:text-surface-foreground px-2 py-1 rounded-md hover:bg-muted transition-colors"
              onClick={() => onSetPrimary(code)}
              title="Set as primary procedure"
            >
              Set Primary
            </button>
          )}
          {code.codeType === 'ICD10' && !code.isPrimary && (
            <button
              className="text-xs text-muted-foreground hover:text-surface-foreground px-2 py-1 rounded-md hover:bg-muted transition-colors"
              onClick={() => onSetPrimary(code)}
              title="Set as primary diagnosis"
            >
              Set Primary
            </button>
          )}
          <button
            className="text-xs text-muted-foreground hover:text-primary px-2 py-1 rounded-md hover:bg-muted transition-colors"
            onClick={() => onEdit(code)}
            title="Edit code"
          >
            Edit
          </button>
          <button
            className="text-xs text-muted-foreground hover:text-danger px-2 py-1 rounded-md hover:bg-muted transition-colors"
            onClick={() => onRemove(code)}
            title="Remove code"
          >
            Remove
          </button>
        </div>
      </div>

    </div>
  )
}

// ─── Add / Edit modal ──────────────────────────────────────────────────────────

const EMPTY_CODE: Omit<CodeItem, 'id'> = {
  codeType: 'CPT',
  code: '',
  modifier: '',
  description: '',
  isPrimary: false,
  derivedBy: 'provider',
  confidence: null,
}

interface EditModalProps {
  open: boolean
  initial: Partial<CodeItem>
  onSave: (c: CodeItem) => void
  onClose: () => void
}

function EditModal({ open, initial, onSave, onClose }: EditModalProps) {
  const [form, setForm] = useState<Omit<CodeItem, 'id'>>({
    ...EMPTY_CODE,
    ...initial,
  })
  const [errors, setErrors] = useState<Partial<Record<keyof CodeItem, string>>>({})

  function validate(): boolean {
    const e: typeof errors = {}
    if (!form.codeType) e.codeType = 'Required'
    if (!form.code.trim()) e.code = 'Required'
    if (!form.description.trim()) e.description = 'Required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSave() {
    if (!validate()) return
    onSave({
      ...form,
      id: (initial as CodeItem).id,
      code: form.code.trim().toUpperCase(),
      modifier: form.modifier?.trim() || undefined,
    } as CodeItem)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={(initial as CodeItem).id ? 'Edit Code' : 'Add Code'} size="md">
      <div className="flex flex-col gap-4">
        <div className="flex gap-3">
          <div className="w-32 shrink-0">
            <label className="text-sm font-medium text-surface-foreground block mb-1">Type</label>
            <select
              className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-surface text-surface-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              value={form.codeType}
              onChange={(e) => setForm((f) => ({ ...f, codeType: e.target.value as CodeType }))}
            >
              <option value="CPT">CPT</option>
              <option value="HCPCS">HCPCS</option>
              <option value="J">J</option>
              <option value="Q">Q</option>
              <option value="ICD10">ICD-10</option>
            </select>
          </div>
          <div className="flex-1">
            <Input
              label="Code"
              value={form.code}
              error={errors.code}
              placeholder={form.codeType === 'ICD10' ? 'e.g. R51.9' : 'e.g. 70450'}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            />
          </div>
          <div className="w-24 shrink-0">
            <Input
              label="Modifier"
              value={form.modifier ?? ''}
              placeholder="e.g. 26"
              onChange={(e) => setForm((f) => ({ ...f, modifier: e.target.value }))}
            />
          </div>
        </div>

        <Input
          label="Description"
          value={form.description}
          error={errors.description}
          placeholder="Short clinical description"
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />

        {form.codeType === 'ICD10' ? (
          <label className="flex items-center gap-2 text-sm text-surface-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={form.isPrimary}
              onChange={(e) => setForm((f) => ({ ...f, isPrimary: e.target.checked }))}
              className="rounded border-border accent-primary"
            />
            Primary diagnosis
          </label>
        ) : (
          <label className="flex items-center gap-2 text-sm text-surface-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={form.isPrimary}
              onChange={(e) => setForm((f) => ({ ...f, isPrimary: e.target.checked }))}
              className="rounded border-border accent-primary"
            />
            Primary procedure
          </label>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save Code</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function CodeReview({ encounterId, existingPaId, initialCodes = [] }: CodeReviewProps) {
  const router = useRouter()
  const { toasts, addToast, removeToast } = useToast()

  // PA state
  const [paId, setPaId] = useState<string | null>(existingPaId ?? null)
  const [creatingPa, setCreatingPa] = useState(false)

  // Code list (local working copy)
  // Codes coming from DB have a `rationale` embedded in description for now;
  // server serialises them as CodeItem shapes.
  const [codes, setCodes] = useState<CodeItem[]>(initialCodes)

  // Edit modal
  const [editTarget, setEditTarget] = useState<Partial<CodeItem> | null>(null)

  // Submit state
  const [saving, setSaving] = useState(false)

  // ── Create PA ────────────────────────────────────────────────────────────────

  const handleCreatePa = useCallback(async () => {
    setCreatingPa(true)
    try {
      const res = await fetch('/api/pa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encounterId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? `Failed to create PA (${res.status})`)
      }
      const pa = await res.json()

      // Fetch the PA with derived codes
      const paRes = await fetch(`/api/pa/${pa.id}`)
      if (!paRes.ok) throw new Error('Failed to load PA details')
      const paDetail = await paRes.json()

      setPaId(pa.id)
      if (paDetail.codes && paDetail.codes.length > 0) {
        setCodes(paDetail.codes.map((c: CodeItem & { rationale?: string }) => ({
          ...c,
          derivedBy: c.derivedBy as DerivedBy,
        })))
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to start review', 'error')
    } finally {
      setCreatingPa(false)
    }
  }, [encounterId, addToast])

  // ── Code editing ─────────────────────────────────────────────────────────────

  const handleEditCode = useCallback((code: CodeItem) => {
    setEditTarget(code)
  }, [])

  const handleRemoveCode = useCallback((code: CodeItem) => {
    setCodes((prev) =>
      prev.filter((c) => !(c.codeType === code.codeType && c.code === code.code))
    )
  }, [])

  const handleSetPrimary = useCallback((target: CodeItem) => {
    setCodes((prev) =>
      prev.map((c) => {
        // For ICD10, only one primary diagnosis
        if (c.codeType === 'ICD10' && target.codeType === 'ICD10') {
          return { ...c, isPrimary: c.code === target.code && c.codeType === 'ICD10' }
        }
        // For procedure codes, only one primary
        if (c.codeType !== 'ICD10' && target.codeType !== 'ICD10') {
          return { ...c, isPrimary: c.code === target.code && c.codeType === target.codeType }
        }
        return c
      })
    )
  }, [])

  const handleSaveCode = useCallback((saved: CodeItem) => {
    setCodes((prev) => {
      const idx = prev.findIndex(
        (c) => c.id ? c.id === saved.id : (c.codeType === saved.codeType && c.code === saved.code)
      )
      if (idx >= 0) {
        // Update existing — mark as confirmed if it was AI-derived
        const orig = prev[idx]
        const updated = {
          ...saved,
          derivedBy: orig.derivedBy === 'ai' ? 'ai-then-confirmed' as DerivedBy : saved.derivedBy,
        }
        return [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)]
      }
      // New code
      return [...prev, { ...saved, derivedBy: 'provider' }]
    })
    setEditTarget(null)
  }, [])

  // ── Continue / Submit codes ───────────────────────────────────────────────────

  const handleContinue = useCallback(async () => {
    if (!paId) return

    if (codes.length === 0) {
      addToast('Add at least one code before continuing.', 'warning')
      return
    }

    // Compute the final code list with auto-promoted primary (avoid stale closure)
    const procedureCodes = codes.filter((c) => c.codeType !== 'ICD10')
    const needsPromotion =
      procedureCodes.length > 0 && !procedureCodes.some((c) => c.isPrimary)

    let finalCodes = codes
    if (needsPromotion) {
      let promoted = false
      finalCodes = codes.map((c) => {
        if (!promoted && c.codeType !== 'ICD10') {
          promoted = true
          return { ...c, isPrimary: true }
        }
        return c
      })
      setCodes(finalCodes)
    }

    setSaving(true)
    try {
      const payload = finalCodes.map((c) => ({
        codeType: c.codeType,
        code: c.code,
        modifier: c.modifier ?? undefined,
        description: c.description,
        isPrimary: c.isPrimary,
        derivedBy: c.derivedBy,
        confidence: c.confidence ?? undefined,
      }))

      const res = await fetch(`/api/pa/${paId}/codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes: payload }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail ?? `Failed to save codes (${res.status})`)
      }
      router.push(`/pa/${paId}`)
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save codes', 'error')
      setSaving(false)
    }
  }, [paId, codes, addToast, router])

  // ── Split codes for display ───────────────────────────────────────────────────

  const procedureCodes = codes.filter((c) => c.codeType !== 'ICD10')
  const diagnosisCodes = codes.filter((c) => c.codeType === 'ICD10')

  // ── Render ────────────────────────────────────────────────────────────────────

  // No PA yet
  if (!paId) {
    return (
      <>
        <Card padding="lg" className="flex flex-col items-center justify-center gap-4 text-center min-h-[300px]">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <svg className="h-6 w-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-surface-foreground mb-1">Ready to begin code review</h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              Start the PA to derive procedure and diagnosis codes from the clinical notes.
            </p>
          </div>
          <Button size="lg" loading={creatingPa} onClick={handleCreatePa}>
            Begin Code Review
          </Button>
        </Card>
        <ToastContainer toasts={toasts} onDismiss={removeToast} />
      </>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-surface-foreground">Code Review</h2>
            <p className="text-sm text-muted-foreground">
              Review and confirm the derived codes before continuing.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="default">{codes.length} code{codes.length !== 1 ? 's' : ''}</Badge>
          </div>
        </div>

        {/* Procedure codes */}
        <Card padding="md">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Procedure Codes</CardTitle>
              <button
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:opacity-80 transition-opacity font-medium"
                onClick={() => setEditTarget({ codeType: 'CPT', derivedBy: 'provider' })}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {procedureCodes.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground mb-3">No procedure codes yet.</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditTarget({ codeType: 'CPT', derivedBy: 'provider' })}
                >
                  Add Procedure Code
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <SectionLabel>CPT / HCPCS</SectionLabel>
                {procedureCodes.map((c, i) => (
                  <CodeRow
                    key={c.id ?? `${c.codeType}-${c.code}-${i}`}
                    code={c}
                    onEdit={handleEditCode}
                    onRemove={handleRemoveCode}
                    onSetPrimary={handleSetPrimary}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Diagnosis codes */}
        <Card padding="md">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Diagnosis Codes</CardTitle>
              <button
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:opacity-80 transition-opacity font-medium"
                onClick={() => setEditTarget({ codeType: 'ICD10', derivedBy: 'provider' })}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {diagnosisCodes.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground mb-3">No diagnosis codes yet.</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditTarget({ codeType: 'ICD10', derivedBy: 'provider' })}
                >
                  Add Diagnosis Code
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <SectionLabel>ICD-10</SectionLabel>
                {diagnosisCodes.map((c, i) => (
                  <CodeRow
                    key={c.id ?? `${c.codeType}-${c.code}-${i}`}
                    code={c}
                    onEdit={handleEditCode}
                    onRemove={handleRemoveCode}
                    onSetPrimary={handleSetPrimary}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI derivation note */}
        {codes.some((c) => c.derivedBy === 'ai' || c.derivedBy === 'ai-then-confirmed') && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 border border-border rounded-lg px-3 py-2">
            <svg className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Codes derived by AI are shown with a confidence percentage. Review each carefully before continuing.
          </div>
        )}

        {/* Continue button */}
        <div className="flex justify-end">
          <Button
            size="lg"
            loading={saving}
            disabled={codes.length === 0}
            onClick={handleContinue}
          >
            Continue to PA Review
          </Button>
        </div>
      </div>

      {/* Edit/Add modal */}
      {editTarget !== null && (
        <EditModal
          open
          initial={editTarget}
          onSave={handleSaveCode}
          onClose={() => setEditTarget(null)}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </>
  )
}
