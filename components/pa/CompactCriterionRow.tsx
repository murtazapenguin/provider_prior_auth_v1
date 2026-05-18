'use client'

// Compact, single-row presentation of a CriterionResult — used inside the
// EvidenceCheckModal right pane. Not a replacement for CriterionCard (which
// remains the canonical card view); this is a denser variant tuned for a
// scrollable list paired with a doc preview pane.

import { Button, Badge, Spinner } from '@/components/ui'
import {
  CheckIcon,
  NeedsInfoIcon,
  FailedIcon,
  ConfidencePill,
  isOverrideResult,
} from '@/components/pa/criterionStatus'
import type { CriterionResultRow } from '@/components/pa/Checklist'

export interface CompactCriterionRowProps {
  result: CriterionResultRow
  /** Which citation index is currently being shown (controls the View-in-doc label). */
  citationStep: number
  /** Doc label for the View-in button — derived by the parent from the current citation. */
  docLabel: string | null
  /** True if a doc was found for the current citation. False = button shows "missing". */
  docResolved: boolean
  /** Visual emphasis when this row is the one driving the left pane. */
  isSelected: boolean
  /** Whether the parent is currently rechecking — disables actions and dims status. */
  isRechecking: boolean
  onSelectCriterion: (result: CriterionResultRow, citationIndex: number) => void
  onUpload: (result: CriterionResultRow) => void
  onOverride: (result: CriterionResultRow) => void
}

export default function CompactCriterionRow({
  result,
  citationStep,
  docLabel,
  docResolved,
  isSelected,
  isRechecking,
  onSelectCriterion,
  onUpload,
  onOverride,
}: CompactCriterionRowProps) {
  const { status, rationale, confidence, citations, criterion } = result

  const isPassing = status === 'passed'
  const isNeedsInfo = status === 'needs_info'
  const isFailed = status === 'failed'
  const isActionable = isNeedsInfo || isFailed
  const isOverride = isOverrideResult({ status, confidence, citations, rationale })

  const hasCitations = citations.length > 0
  const hasMultiple = citations.length > 1
  const safeStep = Math.min(Math.max(citationStep, 0), Math.max(citations.length - 1, 0))
  const currentCitation = hasCitations ? citations[safeStep] : null

  const containerBg = isRechecking
    ? 'opacity-60 border-border'
    : isPassing
    ? 'border-green-200 bg-green-50/30'
    : isNeedsInfo
    ? 'border-amber-200 bg-amber-50/30'
    : isFailed
    ? 'border-red-200 bg-red-50/30'
    : 'border-border bg-surface'

  function handleRowClick() {
    if (!hasCitations) {
      // Still notify parent so it can highlight the row even without a doc.
      onSelectCriterion(result, 0)
      return
    }
    onSelectCriterion(result, safeStep)
  }

  function handleStep(delta: number) {
    if (!hasMultiple) return
    const next = (safeStep + delta + citations.length) % citations.length
    onSelectCriterion(result, next)
  }

  return (
    <div
      className={`rounded-xl border transition-all ${containerBg} ${
        isSelected ? 'ring-2 ring-primary/40 shadow-sm' : ''
      }`}
    >
      {/* Top row: clickable summary */}
      <button
        type="button"
        onClick={handleRowClick}
        className="w-full text-left px-3 py-2.5 flex items-start gap-3"
      >
        {/* Status icon */}
        <div className="mt-0.5 shrink-0">
          {isRechecking ? (
            <Spinner size="sm" />
          ) : isPassing ? (
            <CheckIcon overridden={isOverride} />
          ) : isNeedsInfo ? (
            <NeedsInfoIcon />
          ) : (
            <FailedIcon />
          )}
        </div>

        {/* Middle: ordinal + criterion */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-xs text-muted-foreground">#{criterion.ordinal}</span>
            {isOverride && <Badge variant="warning">Override</Badge>}
            {confidence !== null && !isRechecking && <ConfidencePill confidence={confidence} />}
          </div>
          <p className="text-sm font-medium text-surface-foreground leading-snug">
            {criterion.text}
          </p>
          {rationale && isPassing && !isSelected && (
            <p className="text-xs text-muted-foreground leading-snug mt-1 line-clamp-1">
              {rationale}
            </p>
          )}
        </div>
      </button>

      {/* Always-visible "what's needed" callout for failing / needs-info rows.
          For passing rows we keep the body minimal (rationale only on expand). */}
      {!isRechecking && isActionable && (
        <div className="px-3 pb-2 pl-11 flex flex-col gap-2">
          {rationale && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
              <p className="text-[10px] font-semibold text-amber-800 uppercase tracking-wide mb-1">
                What was found in your records
              </p>
              <p className="text-xs text-amber-900 leading-relaxed">{rationale}</p>
            </div>
          )}
          {criterion.uploadHint && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
              <p className="text-[10px] font-semibold text-blue-800 uppercase tracking-wide mb-1 flex items-center gap-1">
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                To pass this criterion, upload
              </p>
              <p className="text-xs text-blue-900 leading-relaxed">{criterion.uploadHint}</p>
            </div>
          )}
          {!rationale && !criterion.uploadHint && criterion.evidenceHint && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
              <p className="text-[10px] font-semibold text-amber-800 uppercase tracking-wide mb-1">
                What this criterion needs
              </p>
              <p className="text-xs text-amber-900 leading-relaxed">{criterion.evidenceHint}</p>
            </div>
          )}
        </div>
      )}

      {/* Expanded body for PASSED criteria: full rationale + citation excerpt + stepper. */}
      {isSelected && !isRechecking && isPassing && (
        <div className="px-3 pb-2 pl-11 flex flex-col gap-2">
          {rationale && (
            <p className="text-xs text-surface-foreground leading-relaxed">{rationale}</p>
          )}
          {currentCitation && currentCitation.supportingTexts.length > 0 && (
            <blockquote className="border-l-2 border-primary pl-3 text-xs italic text-surface-foreground bg-pink-50/50 py-1 rounded-r">
              {currentCitation.supportingTexts.join(' · ')}
            </blockquote>
          )}
          {hasMultiple && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleStep(-1)
                }}
                className="rounded p-0.5 hover:bg-muted transition-colors"
                aria-label="Previous citation"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>
              <span>
                Citation {safeStep + 1} of {citations.length}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleStep(1)
                }}
                className="rounded p-0.5 hover:bg-muted transition-colors"
                aria-label="Next citation"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Action cluster */}
      {!isRechecking && (
        <div className="px-3 pb-2.5 pl-11 flex flex-wrap items-center gap-2">
          {hasCitations && (
            <Button
              variant="outline"
              size="sm"
              disabled={!docResolved}
              onClick={(e) => {
                e.stopPropagation()
                onSelectCriterion(result, safeStep)
              }}
            >
              {docResolved && docLabel
                ? `View in ${truncate(docLabel, 30)} →`
                : 'View in (missing)'}
            </Button>
          )}
          <Button
            variant={isActionable ? 'primary' : 'ghost'}
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onUpload(result)
            }}
          >
            Upload
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onOverride(result)
            }}
          >
            Override
          </Button>
        </div>
      )}
    </div>
  )
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}
