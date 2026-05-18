'use client'

// PA detail action surface. Owns:
//  - Documents bar (read-only summary + upload trigger)
//  - Evidence summary card with "Open evidence check" entry point
//  - Bottom action bar (Park / Recheck / Continue to review)
//  - Upload modal, Override modal, EvidenceCheckModal (lifted state)
//
// The deep criteria-checklist UI lives inside EvidenceCheckModal — this surface
// shows only summary metrics on the page itself.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Spinner, ToastContainer, useToast } from '@/components/ui'
import UploadDropzone from '@/components/pa/UploadDropzone'
import ManualOverrideModal from '@/components/pa/ManualOverrideModal'
import EvidenceCheckModal from '@/components/pa/EvidenceCheckModal'
import type {
  ClinicalNoteSummary,
  AttachmentSummary as ModalAttachmentSummary,
} from '@/components/pa/EvidenceCheckModal'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface CitationShape {
  id: string
  sourceType: string
  sourceId: string
  supportingTexts: string[]
  reasoning: string | null
  confidence: number
  bboxes: unknown
  lineNumbers: number[] | null
}

export interface CriterionResultRow {
  id: string
  criterionId: string
  status: string
  rationale: string | null
  confidence: number | null
  citations: CitationShape[]
  criterion: {
    id: string
    policyId: string
    ordinal: number
    text: string
    policyTitle?: string
    evidenceHint?: string
    uploadHint?: string
  }
}

export type NoteTextMap = Record<string, string>
export type AttachmentTextMap = Record<string, string>

export interface AttachmentSummary {
  id: string
  filename: string
  uploadedAt: string | Date
}

interface ChecklistProps {
  paId: string
  paStatus: string
  patientName: string
  procedureLabel: string
  criteriaResults: CriterionResultRow[]
  attachments: AttachmentSummary[]
  /** Wider-shape doc summaries used by the EvidenceCheckModal. */
  modalAttachments: ModalAttachmentSummary[]
  clinicalNotes: ClinicalNoteSummary[]
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Checklist({
  paId,
  paStatus,
  patientName,
  procedureLabel,
  criteriaResults,
  attachments,
  modalAttachments,
  clinicalNotes,
}: ChecklistProps) {
  const router = useRouter()
  const { toasts, addToast, removeToast } = useToast()

  // Spinner during recheck/upload-recheck cycles.
  const [isRechecking, setIsRechecking] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [overrideCriterion, setOverrideCriterion] = useState<CriterionResultRow | null>(null)
  const [evidenceCheckOpen, setEvidenceCheckOpen] = useState(false)

  const [isPending, startTransition] = useTransition()

  // Evidence summary metrics.
  const total = criteriaResults.length
  const totalDocs = clinicalNotes.length + attachments.length
  const passed = criteriaResults.filter((r) => r.status === 'passed').length
  const needsInfo = criteriaResults.filter((r) => r.status === 'needs_info').length
  const failed = criteriaResults.filter((r) => r.status === 'failed').length
  const allPassed = total > 0 && passed === total
  const confidences = criteriaResults
    .map((r) => r.confidence)
    .filter((c): c is number => c !== null)
  const avgConfidence =
    confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : null

  const canSubmit =
    allPassed &&
    (paStatus === 'draft' || paStatus === 'ready_for_submission' || paStatus === 'pending_submission')

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleUploadComplete() {
    setIsRechecking(true)
    startTransition(() => router.refresh())
    setTimeout(() => setIsRechecking(false), 1500)
  }

  async function handleOverrideConfirm(result: CriterionResultRow, rationale: string) {
    const res = await fetch(`/api/pa/${paId}/criteria/${result.criterionId}/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rationale }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as { detail?: string }).detail ?? 'Override failed')
    }
    addToast('Criterion overridden successfully', 'success')
    startTransition(() => router.refresh())
  }

  async function handleRecheck() {
    setIsRechecking(true)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 90_000)
    try {
      const res = await fetch(`/api/pa/${paId}/recheck`, {
        method: 'POST',
        signal: controller.signal,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        addToast((body as { detail?: string }).detail ?? 'Recheck failed', 'error')
        return
      }
      startTransition(() => router.refresh())
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        addToast('Recheck timed out. The AI service may be busy — try again in a moment.', 'error')
      } else {
        addToast('Recheck failed — could not reach server', 'error')
      }
    } finally {
      clearTimeout(timeoutId)
      setTimeout(() => setIsRechecking(false), 1500)
    }
  }

  async function handlePark() {
    const res = await fetch(`/api/pa/${paId}/park`, { method: 'POST' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      addToast((body as { detail?: string }).detail ?? 'Could not park PA', 'error')
      return
    }
    addToast('PA parked for later', 'success')
    router.push('/queue')
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {/* Documents bar — shows clinical notes (from encounter) + uploads.
          The total feeds the evidence-check enable check below. */}
      <div className="bg-surface border border-border rounded-xl px-4 py-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-surface-foreground">Clinical documents</h3>
            <p className="text-xs text-muted-foreground">
              {totalDocs === 0
                ? 'Upload PT records, lab results, or specialist notes to evaluate against this policy.'
                : (() => {
                    const noteN = clinicalNotes.length
                    const uploadN = attachments.length
                    const noteStr = noteN > 0 ? `${noteN} encounter note${noteN === 1 ? '' : 's'}` : null
                    const uploadStr = uploadN > 0 ? `${uploadN} upload${uploadN === 1 ? '' : 's'}` : null
                    return [noteStr, uploadStr].filter(Boolean).join(' · ')
                  })()}
            </p>
          </div>
          <Button
            variant={attachments.length === 0 ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setUploadOpen(true)}
            disabled={isRechecking}
          >
            {attachments.length === 0 ? 'Upload documents' : 'Add document'}
          </Button>
        </div>

        {attachments.length > 0 && (
          <ul className="flex flex-col divide-y divide-border border-t border-border -mx-4 px-4">
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-2 text-sm min-w-0">
                <svg className="h-4 w-4 text-muted-foreground shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="text-surface-foreground truncate flex-1">{a.filename}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {new Date(a.uploadedAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Recheck banner */}
      {isRechecking && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
          <Spinner size="sm" />
          <p className="text-sm text-blue-800 font-medium">
            Rechecking all criteria with updated evidence…
          </p>
        </div>
      )}

      {/* Evidence summary card */}
      <div className="bg-surface border border-border rounded-xl px-4 py-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-surface-foreground">Evidence check</h3>
            {total === 0 ? (
              <p className="text-xs text-muted-foreground mt-0.5">
                {totalDocs === 0
                  ? 'Upload clinical documents above, then run the evidence check to evaluate this PA against the payer policy.'
                  : 'Run the evidence check to evaluate available documents against the payer policy.'}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-0.5">
                <span className="font-medium text-surface-foreground">
                  {passed} of {total} criteria met
                </span>
                {avgConfidence !== null && (
                  <> · {Math.round(avgConfidence * 100)}% avg confidence</>
                )}
              </p>
            )}

            {total > 0 && (
              <div className="flex items-center gap-3 mt-2">
                {passed > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs text-green-700">
                    <span className="h-2 w-2 rounded-full bg-green-500" />
                    {passed} passed
                  </span>
                )}
                {needsInfo > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                    <span className="h-2 w-2 rounded-full bg-amber-400" />
                    {needsInfo} need info
                  </span>
                )}
                {failed > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs text-red-700">
                    <span className="h-2 w-2 rounded-full bg-red-500" />
                    {failed} failed
                  </span>
                )}
              </div>
            )}
          </div>

          <Button
            variant={total === 0 ? 'secondary' : 'primary'}
            size="sm"
            onClick={() => {
              if (total === 0) {
                handleRecheck()
              } else {
                setEvidenceCheckOpen(true)
              }
            }}
            disabled={isRechecking || (total === 0 && totalDocs === 0)}
          >
            {total === 0
              ? isRechecking
                ? <><Spinner size="sm" />&nbsp;Running…</>
                : 'Run evidence check'
              : 'Open evidence check →'}
          </Button>
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handlePark}
            disabled={isPending || isRechecking}
          >
            Park for later
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRecheck}
            disabled={isPending || isRechecking || total === 0}
          >
            {isRechecking ? <><Spinner size="sm" />&nbsp;Rechecking…</> : 'Recheck'}
          </Button>
        </div>

        <Button
          variant="primary"
          disabled={!canSubmit || isPending || isRechecking}
          onClick={() => router.push(`/pa/${paId}/review`)}
        >
          {allPassed ? 'Continue to review' : 'Resolve all criteria to continue'}
        </Button>
      </div>

      {/* Evidence check modal — the new criteria-checklist surface.
          Rendered FIRST so secondary modals (Upload / Override) — which can be
          opened from inside EvidenceCheckModal — appear on top via DOM order. */}
      <EvidenceCheckModal
        open={evidenceCheckOpen}
        onClose={() => setEvidenceCheckOpen(false)}
        paId={paId}
        paStatus={paStatus}
        patientName={patientName}
        procedureLabel={procedureLabel}
        criteriaResults={criteriaResults}
        clinicalNotes={clinicalNotes}
        attachments={modalAttachments}
        isRechecking={isRechecking}
        onUploadClick={() => setUploadOpen(true)}
        onOverrideClick={(result) => setOverrideCriterion(result)}
      />

      {/* Upload modal — must render AFTER EvidenceCheckModal so it stacks on top. */}
      <UploadDropzone
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        paId={paId}
        onComplete={handleUploadComplete}
      />

      {/* Override modal — must render AFTER EvidenceCheckModal so it stacks on top. */}
      {overrideCriterion && (
        <ManualOverrideModal
          open={overrideCriterion !== null}
          onClose={() => setOverrideCriterion(null)}
          criterionText={overrideCriterion.criterion.text}
          onConfirm={(rationale) => handleOverrideConfirm(overrideCriterion, rationale)}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  )
}
