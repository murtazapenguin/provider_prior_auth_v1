'use client'

// EvidenceCheckModal: full-screen split-pane review of every criterion against
// every uploaded clinical doc, with citation-driven highlighting on the left
// and a compact criteria list on the right.
//
// Phase D will integrate this into the PA detail page (replacing the current
// CriterionCard-based Checklist body). For now the component is built standalone
// and exercised via a temporary smoke-test trigger — see _evidenceCheckSmokeTest.tsx.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Spinner } from '@/components/ui'
import DocumentList from '@/components/pa/DocumentList'
import type { DocSelection } from '@/components/pa/DocumentList'
import DocumentBody from '@/components/pa/DocumentBody'
import CompactCriterionRow from '@/components/pa/CompactCriterionRow'
import type { CriterionResultRow, CitationShape } from '@/components/pa/Checklist'
import { docContainsSupport } from '@/lib/text/sentenceSplit'

// Document summaries — passed in from the server page. Distinct from
// Checklist's narrower AttachmentSummary (which strips mimeType + extractedText).
export interface ClinicalNoteSummary {
  id: string
  noteType: string
  authoredAt: string | Date
  authorRole: string
  text: string
  // Phase 6 T10: when a clinical note has been FHIR-ingested via T4's pipeline,
  // pdfUrl + pageImages carry the canonical pdfviewer-data shape so DocumentBody
  // can route through DocumentPdfViewer's PDF branch (bbox overlays). Null for
  // legacy Phase 1 seeded notes — DocumentBody falls back to text-on-page rendering.
  pdfUrl: string | null
  pageImages: unknown | null
}

export interface AttachmentSummary {
  id: string
  filename: string
  mimeType: string
  uploadedAt: string | Date
  /** Pre-extracted text. May be null for binary attachments where OCR hasn't run. */
  extractedText: string | null
  /** Phase 6 (PDF-viewer build): canonical pdfviewer-data shape populated by
   *  the sidecar's /ingest-attachment after OCR + page-image generation.
   *  Present for uploads processed by the new pipeline; null for legacy rows
   *  (DocumentBody falls back to the mime-based iframe / text-on-page render). */
  pageImages: unknown | null
}

interface EvidenceCheckModalProps {
  open: boolean
  onClose: () => void
  paId: string
  paStatus: string
  patientName: string
  procedureLabel: string
  criteriaResults: CriterionResultRow[]
  clinicalNotes: ClinicalNoteSummary[]
  attachments: AttachmentSummary[]
  isRechecking: boolean
  onUploadClick: () => void
  onOverrideClick: (result: CriterionResultRow) => void
}

type StatusFilter = 'all' | 'passed' | 'needs_info' | 'failed'

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'passed', label: 'Passed' },
  { value: 'needs_info', label: 'Needs info' },
  { value: 'failed', label: 'Failed' },
]

const NOTE_TYPE_LABELS: Record<string, string> = {
  history_and_physical: 'History & Physical',
  consult: 'Consult Note',
  progress_note: 'Progress Note',
  discharge_summary: 'Discharge Summary',
  procedure_note: 'Procedure Note',
  imaging_report: 'Imaging Report',
  pathology_report: 'Pathology Report',
  lab_report: 'Lab Report',
}

function readableNoteType(noteType: string): string {
  if (NOTE_TYPE_LABELS[noteType]) return NOTE_TYPE_LABELS[noteType]
  return noteType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

interface ResolvedDoc {
  selection: DocSelection
  label: string
}

// `docContainsSupport` (previously inlined here) is now imported from
// `lib/text/sentenceSplit.ts` — the same fragment-split + length-12 + lowercase-
// substring routine is used by DocumentPdfViewer's text-on-page fallback. This
// keeps the two surfaces from drifting on what counts as "the AI named the
// wrong source doc" vs. "no evidence here."

/**
 * Map a citation to a doc in the current modal context. Returns null when
 * the citation can't be matched (e.g. policy_pdf — out of scope here, or a
 * citation pointing at a deleted note/attachment).
 *
 * If the citation's named source doesn't actually contain the supporting text,
 * we search all other docs for a contiguous match and route there instead —
 * this defends against the AI conflating sources when multiple were given.
 */
function resolveCitationToDoc(
  citation: CitationShape,
  notes: ClinicalNoteSummary[] | undefined,
  attachments: AttachmentSummary[] | undefined
): ResolvedDoc | null {
  const noteList = notes ?? []
  const attList = attachments ?? []

  function noteToResolved(note: ClinicalNoteSummary): ResolvedDoc {
    return {
      selection: { source: 'note', id: note.id },
      label: `Clinical Note — ${readableNoteType(note.noteType)}`,
    }
  }
  function attToResolved(att: AttachmentSummary): ResolvedDoc {
    return {
      selection: { source: 'attachment', id: att.id },
      label: att.filename,
    }
  }

  // Primary lookup: trust the AI's stated source.
  let primary: { kind: 'note'; doc: ClinicalNoteSummary } | { kind: 'attachment'; doc: AttachmentSummary } | null = null
  if (citation.sourceType === 'clinical_note') {
    const note = noteList.find((n) => n.id === citation.sourceId)
    if (note) primary = { kind: 'note', doc: note }
  } else if (citation.sourceType === 'attachment') {
    const att = attList.find((a) => a.id === citation.sourceId)
    if (att) primary = { kind: 'attachment', doc: att }
  }

  // If the primary source actually contains the supporting text, use it.
  if (primary) {
    const text = primary.kind === 'note' ? primary.doc.text : (primary.doc.extractedText ?? '')
    if (citation.supportingTexts.length === 0 || docContainsSupport(text, citation.supportingTexts)) {
      return primary.kind === 'note' ? noteToResolved(primary.doc) : attToResolved(primary.doc)
    }
  }

  // Fallback: search all other docs for one that contains the supporting text.
  // Prefer attachments — when the user just uploaded a doc to make a criterion
  // pass, the highlight should land on what they uploaded. Then fall back to
  // notes, then to the original primary doc as a last resort.
  if (citation.supportingTexts.length > 0) {
    for (const att of attList) {
      if (docContainsSupport(att.extractedText, citation.supportingTexts)) return attToResolved(att)
    }
    for (const note of noteList) {
      if (docContainsSupport(note.text, citation.supportingTexts)) return noteToResolved(note)
    }
  }

  // No content match anywhere — return primary if any, else null (e.g. policy_pdf).
  if (primary) return primary.kind === 'note' ? noteToResolved(primary.doc) : attToResolved(primary.doc)
  return null
}

export default function EvidenceCheckModal({
  open,
  onClose,
  paId,
  paStatus: _paStatus,
  patientName,
  procedureLabel,
  criteriaResults,
  clinicalNotes = [],
  attachments = [],
  isRechecking,
  onUploadClick,
  onOverrideClick,
}: EvidenceCheckModalProps) {
  // Selected document. null = show DocumentList default view.
  const [selectedDoc, setSelectedDoc] = useState<DocSelection | null>(null)
  // Selected criterion (visual emphasis on the right pane).
  const [selectedCriterionId, setSelectedCriterionId] = useState<string | null>(null)
  // Citation step per criterion (0-indexed). Defaults to 0.
  const [citationStep, setCitationStep] = useState<Record<string, number>>({})
  // Status filter chips.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // Refs for each criterion row so we can scrollIntoView on selection.
  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())

  // Reset transient state whenever the modal closes — opening fresh next time.
  useEffect(() => {
    if (!open) {
      setSelectedDoc(null)
      setSelectedCriterionId(null)
      setCitationStep({})
      setStatusFilter('all')
    }
  }, [open])

  const sortedResults = useMemo(
    () => [...criteriaResults].sort((a, b) => a.criterion.ordinal - b.criterion.ordinal),
    [criteriaResults]
  )

  // On open, auto-select the first criterion and drive the left pane to its
  // first citation's source document (if any). Gives the user a "ready to read"
  // entry-point instead of staring at the doc list.
  useEffect(() => {
    if (!open) return
    if (selectedCriterionId !== null) return
    const first = sortedResults[0]
    if (!first) return
    setSelectedCriterionId(first.criterionId)
    const cit = first.citations[0]
    if (cit) {
      const resolved = resolveCitationToDoc(cit, clinicalNotes, attachments)
      if (resolved) setSelectedDoc(resolved.selection)
    }
    // Intentionally only running this on open / when results first arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sortedResults])

  const filteredResults = useMemo(() => {
    if (statusFilter === 'all') return sortedResults
    return sortedResults.filter((r) => r.status === statusFilter)
  }, [sortedResults, statusFilter])

  const selectedCriterion = useMemo(() => {
    if (!selectedCriterionId) return null
    return sortedResults.find((r) => r.criterionId === selectedCriterionId) ?? null
  }, [selectedCriterionId, sortedResults])

  // Highlight context for the doc body. Pull from the currently-selected
  // criterion's currently-stepped citation. Re-resolves when either changes.
  const highlightContext = useMemo(() => {
    const empty = { lineNumbers: [], supportingTexts: [], boundingBoxes: [] }
    if (!selectedCriterion) return empty
    const step = citationStep[selectedCriterion.criterionId] ?? 0
    const safeStep = Math.min(Math.max(step, 0), Math.max(selectedCriterion.citations.length - 1, 0))
    const cit = selectedCriterion.citations[safeStep]
    if (!cit) return empty
    // Only apply highlight if the citation actually points at the currently
    // visible doc (e.g. user clicked a row, then manually navigated to a
    // different doc — don't carry stale highlights).
    const resolved = resolveCitationToDoc(cit, clinicalNotes, attachments)
    if (!resolved || !selectedDoc) return empty
    if (
      resolved.selection.source !== selectedDoc.source ||
      resolved.selection.id !== selectedDoc.id
    ) {
      return empty
    }
    // Citation.bboxes JSON shape matches PdfBoundingBox (see ARCHITECTURE.md
    // `model Citation` and the canonical bbox-format contract). All entries
    // on one citation reference one source doc, so passing the whole array is
    // correct — DocumentPdfViewer's overlay code filters by document_name
    // internally for the PDF branch.
    return {
      lineNumbers: cit.lineNumbers ?? [],
      supportingTexts: cit.supportingTexts,
      boundingBoxes: (Array.isArray(cit.bboxes) ? cit.bboxes : []) as unknown as import('@/components/pa/DocumentPdfViewer').PdfBoundingBox[],
    }
  }, [selectedCriterion, citationStep, selectedDoc, clinicalNotes, attachments])

  function handleSelectCriterion(result: CriterionResultRow, citationIndex: number) {
    setSelectedCriterionId(result.criterionId)
    setCitationStep((prev) => ({ ...prev, [result.criterionId]: citationIndex }))

    const cit = result.citations[citationIndex]
    if (cit) {
      const resolved = resolveCitationToDoc(cit, clinicalNotes, attachments)
      if (resolved) {
        setSelectedDoc(resolved.selection)
      }
      // policy_pdf / unresolved → leave the doc pane on whatever was last shown.
    }

    // Scroll the right pane to keep this row visible.
    const node = rowRefs.current.get(result.criterionId)
    if (node) {
      // Use rAF so the state-driven re-render lands first.
      requestAnimationFrame(() => {
        node.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      })
    }
  }

  function handleSelectDoc(selection: DocSelection) {
    setSelectedDoc(selection)
    // Manually opening a doc clears the criterion-driven highlight (no stale lines).
    setSelectedCriterionId(null)
  }

  function handleBackToList() {
    setSelectedDoc(null)
    setSelectedCriterionId(null)
  }

  // Look up the actual doc record for the selected selection.
  const selectedDocRecord = useMemo(() => {
    if (!selectedDoc) return null
    if (selectedDoc.source === 'note') {
      const note = (clinicalNotes ?? []).find((n) => n.id === selectedDoc.id)
      return note ? ({ kind: 'note', note } as const) : null
    }
    const att = (attachments ?? []).find((a) => a.id === selectedDoc.id)
    return att ? ({ kind: 'attachment', attachment: att } as const) : null
  }, [selectedDoc, clinicalNotes, attachments])

  // Counts for filter chips
  const statusCounts = useMemo(() => {
    const counts = { all: sortedResults.length, passed: 0, needs_info: 0, failed: 0 }
    for (const r of sortedResults) {
      if (r.status === 'passed') counts.passed += 1
      else if (r.status === 'needs_info') counts.needs_info += 1
      else if (r.status === 'failed') counts.failed += 1
    }
    return counts
  }, [sortedResults])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Evidence check — ${patientName} · ${procedureLabel}`}
      size="full"
      padded={false}
    >
      <div className="h-full flex">
        {/* Left pane (50%): document list OR document body */}
        <div className="w-1/2 min-w-0 border-r border-border flex flex-col">
          {selectedDocRecord ? (
            <DocumentBody
              paId={paId}
              doc={selectedDocRecord}
              onBack={handleBackToList}
              highlightLineNumbers={highlightContext.lineNumbers}
              highlightSupportingTexts={highlightContext.supportingTexts}
              highlightBoundingBoxes={highlightContext.boundingBoxes}
            />
          ) : (
            <DocumentList
              notes={clinicalNotes}
              attachments={attachments}
              onSelect={handleSelectDoc}
              selectedId={selectedDoc ? (selectedDoc as DocSelection).id : null}
            />
          )}
        </div>

        {/* Right pane (50%): filter chips + scrollable criterion rows */}
        <div className="w-1/2 min-w-0 flex flex-col">
          <div className="px-4 py-3 border-b border-border shrink-0 flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-surface-foreground mr-2">Criteria</h3>
            {FILTERS.map((f) => {
              const count = statusCounts[f.value]
              const active = statusFilter === f.value
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setStatusFilter(f.value)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-surface text-muted-foreground border-border hover:bg-muted'
                  }`}
                >
                  {f.label} <span className="opacity-70">({count})</span>
                </button>
              )
            })}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-2">
            {isRechecking && filteredResults.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <Spinner size="lg" />
              </div>
            )}
            {!isRechecking && filteredResults.length === 0 && (
              <div className="text-sm text-muted-foreground py-8 text-center">
                {sortedResults.length === 0
                  ? 'No criteria evaluated yet.'
                  : 'No criteria match this filter.'}
              </div>
            )}
            {filteredResults.map((result) => {
              const step = citationStep[result.criterionId] ?? 0
              const safeStep = Math.min(
                Math.max(step, 0),
                Math.max(result.citations.length - 1, 0)
              )
              const currentCit = result.citations[safeStep] ?? null
              const resolved = currentCit
                ? resolveCitationToDoc(currentCit, clinicalNotes, attachments)
                : null
              const isSelected = selectedCriterionId === result.criterionId
              return (
                <div
                  key={result.id}
                  ref={(el) => {
                    rowRefs.current.set(result.criterionId, el)
                  }}
                >
                  <CompactCriterionRow
                    result={result}
                    citationStep={safeStep}
                    docLabel={resolved?.label ?? null}
                    docResolved={Boolean(resolved)}
                    isSelected={isSelected}
                    isRechecking={isRechecking}
                    onSelectCriterion={handleSelectCriterion}
                    onUpload={() => onUploadClick()}
                    onOverride={(r) => onOverrideClick(r)}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Modal>
  )
}
