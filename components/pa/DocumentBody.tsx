'use client'

// DocumentBody: renders ONE selected document in the left pane of the
// EvidenceCheckModal. Routes by kind + presence of a real PDF:
//
//   note + pdfUrl   → DocumentPdfViewer (PDF branch: pre-rendered page
//                     images + bbox overlay — the canonical Phase 6 path)
//   note - pdfUrl   → DocumentPdfViewer (text-on-page fallback for the 15
//                     seeded Phase 1 ClinicalNote rows that pre-date T4
//                     ingestion)
//   attachment      → iframe (PDF) | <img> (image) |
//                     DocumentPdfViewer (text-on-page fallback for the
//                     extracted-text path)
//
// Phase 6 / Session 7 T8 collapsed the prior NoteHighlighter component into
// DocumentPdfViewer's fallback branch — there's now a single citation viewer
// rather than two.

import DocumentPdfViewer, { type PdfViewerDocumentData } from '@/components/pa/DocumentPdfViewer'
import type {
  ClinicalNoteSummary,
  AttachmentSummary,
} from '@/components/pa/EvidenceCheckModal'

type DocBodyDoc =
  | { kind: 'note'; note: ClinicalNoteSummary }
  | { kind: 'attachment'; attachment: AttachmentSummary }

interface DocumentBodyProps {
  paId: string
  doc: DocBodyDoc
  onBack: () => void
  highlightLineNumbers?: number[]
  highlightSupportingTexts?: string[]
}

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

export default function DocumentBody({
  paId,
  doc,
  onBack,
  highlightLineNumbers,
  highlightSupportingTexts,
}: DocumentBodyProps) {
  const lineNumbers = highlightLineNumbers ?? []
  const supportingTexts = highlightSupportingTexts ?? []

  const title =
    doc.kind === 'note'
      ? `Clinical Note — ${readableNoteType(doc.note.noteType)}`
      : doc.attachment.filename

  const subtitle =
    doc.kind === 'note'
      ? `${doc.note.authorRole.replace(/_/g, ' ')} · ${new Date(doc.note.authoredAt).toLocaleString()}`
      : `${doc.attachment.mimeType} · ${new Date(doc.attachment.uploadedAt).toLocaleString()}`

  const streamingUrl =
    doc.kind === 'attachment'
      ? `/api/pa/${paId}/attachments/${doc.attachment.id}/file`
      : null

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border shrink-0 flex items-start gap-3">
        <button
          type="button"
          onClick={onBack}
          className="text-xs font-medium text-primary hover:underline shrink-0 mt-0.5"
        >
          ← All documents
        </button>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-surface-foreground truncate">{title}</h3>
          <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
        </div>
        {streamingUrl && (
          <a
            href={streamingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-primary hover:underline shrink-0 mt-0.5"
          >
            Open original ↗
          </a>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-hidden bg-muted/20">
        {doc.kind === 'note' && (
          <div className="h-full overflow-auto bg-surface">
            {/* Phase 6 T10 forward-wiring: when T4 has ingested the FHIR DocumentReference
                for this note, pdfUrl + pageImages are populated and DocumentPdfViewer
                routes through its PDF branch. Legacy seeded notes (Phase 1 fixtures,
                pdfUrl=NULL) fall back to text-on-page rendering with line/text highlights.

                TODO(t10-followup): thread Citation.bboxes through DocumentBody as
                highlightBoundingBoxes so the PDF branch shows bbox overlays for citations
                (currently the PDF renders without overlays — citation context lives in the
                checklist sidebar, not on the PDF page). lineNumbers + supportingTexts are
                text-branch-only per DocumentPdfViewer's discriminated union (lines 67-71). */}
            {doc.note.pdfUrl && doc.note.pageImages ? (
              <DocumentPdfViewer
                documentData={doc.note.pageImages as PdfViewerDocumentData}
              />
            ) : (
              <DocumentPdfViewer
                sourceText={doc.note.text}
                lineNumbers={lineNumbers}
                supportingTexts={supportingTexts}
              />
            )}
          </div>
        )}

        {doc.kind === 'attachment' && (
          <AttachmentBody
            attachment={doc.attachment}
            streamingUrl={streamingUrl as string}
            lineNumbers={lineNumbers}
            supportingTexts={supportingTexts}
          />
        )}
      </div>
    </div>
  )
}

// Strip the OCR `<content> || <line_number>` annotation that the sidecar
// appends to each line for AI citation alignment. Useful for AI prompts,
// noise for human display.
function stripOcrLineMarkers(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/\s*\|\|\s*\d+\s*$/, ''))
    .join('\n')
}

// Resolve effective mime type using the filename extension as a fallback when
// the stored mimeType is generic/missing (legacy uploads, browser guessed wrong).
function resolveEffectiveMime(filename: string, storedMime: string): string {
  if (storedMime && storedMime !== 'application/octet-stream' && storedMime !== 'text/plain') {
    return storedMime
  }
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  return storedMime || 'application/octet-stream'
}

function AttachmentBody({
  attachment,
  streamingUrl,
  lineNumbers,
  supportingTexts,
}: {
  attachment: AttachmentSummary
  streamingUrl: string
  lineNumbers: number[]
  supportingTexts: string[]
}) {
  const mime = resolveEffectiveMime(attachment.filename, attachment.mimeType)

  if (mime === 'application/pdf') {
    return (
      <iframe
        src={streamingUrl}
        title={attachment.filename}
        className="w-full h-full bg-surface"
      />
    )
  }

  if (mime.startsWith('image/')) {
    return (
      <div className="w-full h-full overflow-auto flex items-center justify-center bg-surface p-4">
        {/* Using <img> rather than next/image — content is auth-gated streaming */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={streamingUrl}
          alt={attachment.filename}
          className="max-w-full max-h-full object-contain"
        />
      </div>
    )
  }

  // text-ish: rely on extracted text. If empty, show a neutral message.
  const rawText = attachment.extractedText ?? ''
  if (!rawText.trim()) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-6 gap-2 bg-surface">
        <p className="text-sm text-muted-foreground">
          No text preview available — open the original to view this attachment.
        </p>
        <a
          href={streamingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-primary hover:underline"
        >
          Open original ↗
        </a>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto bg-surface">
      <DocumentPdfViewer
        sourceText={stripOcrLineMarkers(rawText)}
        lineNumbers={lineNumbers}
        supportingTexts={supportingTexts}
      />
    </div>
  )
}
