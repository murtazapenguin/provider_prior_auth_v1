'use client'

// DocumentPdfViewer (renamed from PolicyPdfViewer in Phase 6 / Session 7 T8).
//
// Single citation viewer for every source document type — policy PDFs (FHIR-
// agnostic, hand-curated or ingested) AND clinical-note PDFs from
// CachedDocumentReference. Branches on whether the row has a real `pdfUrl`:
//
//   pdfUrl IS NOT NULL  → data-labelling-library PDFViewer + bbox overlay
//                         (the canonical Phase 6 path; pages pre-rendered to
//                         PNGs and shipped as `pdfviewer-data`).
//
//   pdfUrl IS NULL      → text-on-page fallback (the 15 seeded Phase 1
//                         ClinicalNote rows have no PDF; lazy ingestion on
//                         view would burn Textract per click). We render the
//                         clinical-note text with <mark> highlights driven by
//                         the same supporting-text-fragment splitter that
//                         routes citations elsewhere in the modal.
//
// Wrapper around the data-labelling-library PDFViewer with our canonical
// evidence-citation shape. Zero-transform: Citation.bboxes JSON column
// already matches the shape expected by PDFViewer.
//
// Height chain requirement (per pdfviewer-component.md): every ancestor
// container down to this component must have explicit height (h-screen /
// h-full / h-full). Skipping this causes pages to expand instead of scroll.

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef } from 'react'
import type { ComponentType } from 'react'
import { buildSupportingTextRegex } from '@/lib/text/sentenceSplit'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PDFViewerLib = dynamic<any>(
  () =>
    import('@/frontend/lib/pdf-viewer/src/components/PDFViewer').then(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (m: any) => m.PDFViewer,
    ),
  { ssr: false },
) as ComponentType<Record<string, unknown>>

export interface PdfViewerDocumentData {
  files: string[]
  presigned_urls: Record<string, Record<string, string>>
}

export interface PdfBoundingBox {
  document_name: string
  page_number: number
  bbox: number[][]
  line_numbers?: number[]
}

interface CommonProps {
  className?: string
  /** Optional callback as the user scrolls between PDF pages. No-op for the
   * fallback branch (a single text scroll surface, no pagination). */
  onPageChange?: (page: number) => void
}

interface PdfBranchProps extends CommonProps {
  /** Canonical Phase 6 PDF branch — pre-rendered page images + bboxes. */
  documentData: PdfViewerDocumentData
  boundingBoxes?: PdfBoundingBox[]
  /** Must NOT be set for this branch. */
  sourceText?: undefined
  /** Must NOT be set for this branch. */
  lineNumbers?: undefined
  /** Must NOT be set for this branch. */
  supportingTexts?: undefined
}

interface TextOnPageBranchProps extends CommonProps {
  /** Fallback branch — legacy rows / extracted-text attachments without
   * a rendered PDF. Renders `sourceText` with line gutters and highlights. */
  sourceText: string
  /** 1-indexed line numbers the AI cited. May be empty. */
  lineNumbers?: number[]
  /** Verbatim supporting-text quotes from the AI citation. Used to <mark>
   * substring matches even when explicit lineNumbers weren't returned. */
  supportingTexts?: string[]
  /** Must NOT be set for this branch. */
  documentData?: undefined
  /** Must NOT be set for this branch. */
  boundingBoxes?: undefined
}

type DocumentPdfViewerProps = PdfBranchProps | TextOnPageBranchProps

export default function DocumentPdfViewer(props: DocumentPdfViewerProps) {
  const { className = '' } = props

  // Discriminant: presence of `documentData` (PDF) vs `sourceText` (fallback).
  // Both branches require an explicit height chain — see comment above.
  if (props.documentData) {
    const { documentData, boundingBoxes = [], onPageChange } = props
    return (
      <div className={`h-full ${className}`}>
        <PDFViewerLib
          documentData={documentData}
          boundingBoxes={boundingBoxes.length > 0 ? boundingBoxes : null}
          className="h-full"
          onPageChange={onPageChange}
          onDocumentChange={undefined}
          onAnnotationAdd={undefined}
          onSearchPerformed={undefined}
          setSearchResults={undefined}
          userInterfaces={{ docNavigation: true, zoom: true, showFilename: false }}
        />
      </div>
    )
  }

  // Fallback branch: text-on-page with <mark> highlights.
  return (
    <TextOnPageFallback
      sourceText={props.sourceText}
      lineNumbers={props.lineNumbers ?? []}
      supportingTexts={props.supportingTexts ?? []}
      className={className}
    />
  )
}

DocumentPdfViewer.displayName = 'DocumentPdfViewer'

// ─── Text-on-page fallback ────────────────────────────────────────────────────
//
// Private subcomponent extracted from the (deleted) `components/ui/NoteHighlighter.tsx`
// as part of T8. The "right pattern" was MOVE-DON'T-REWRITE — the original
// logic (sentence-split + fuzzy substring match + scroll-on-click) is
// non-trivial and re-implementing was flagged as a session-busting trap. Only
// the SPLIT regex + fragment-length filter moved into `lib/text/sentenceSplit.ts`
// (because EvidenceCheckModal needs the same routine for citation routing).
// Everything else — rendering, line-gutter highlight, scrollIntoView — landed
// here as a private subcomponent.

interface TextOnPageFallbackProps {
  sourceText: string
  lineNumbers: number[]
  supportingTexts: string[]
  className?: string
}

function TextOnPageFallback({
  sourceText,
  lineNumbers,
  supportingTexts,
  className = '',
}: TextOnPageFallbackProps) {
  const lines = useMemo(() => sourceText.split('\n'), [sourceText])

  // Build the substring regex once per render via the shared helper. AI
  // quotes are often paraphrased / stitched ("phrase one … phrase two") or
  // run-together sentences that don't appear contiguously in the source —
  // splitting each supporting text on ellipsis + sentence boundaries lets
  // every cohesive piece match independently.
  const substringRe = useMemo(
    () => buildSupportingTextRegex(supportingTexts),
    [supportingTexts]
  )

  // Compute the set of lines that should get the gutter/background highlight.
  // Start from explicit line numbers (1-indexed in the citation → 0-indexed
  // here), then add any line whose content matches a supporting-text fragment
  // (so substring-only citations still anchor visually).
  const highlightedLines = useMemo(() => {
    const set = new Set<number>(lineNumbers.map((n) => n - 1))
    if (substringRe) {
      for (let i = 0; i < lines.length; i++) {
        substringRe.lastIndex = 0
        if (substringRe.test(lines[i])) set.add(i)
      }
    }
    return set
  }, [lineNumbers, lines, substringRe])

  // Scroll the first highlighted line into view whenever highlights change.
  const containerRef = useRef<HTMLDivElement>(null)
  const firstHighlightIdx = useMemo(() => {
    if (highlightedLines.size === 0) return -1
    return Math.min(...highlightedLines)
  }, [highlightedLines])

  useEffect(() => {
    if (firstHighlightIdx < 0) return
    const container = containerRef.current
    if (!container) return
    const target = container.querySelector<HTMLElement>(
      `[data-line-idx="${firstHighlightIdx}"]`
    )
    if (!target) return
    // rAF so the layout has settled before measuring.
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }, [firstHighlightIdx, sourceText])

  function renderLine(line: string) {
    if (!substringRe) return <span>{line}</span>
    substringRe.lastIndex = 0
    const parts = line.split(substringRe)
    return (
      <>
        {parts.map((part, i) => {
          substringRe.lastIndex = 0
          const isMatch = substringRe.test(part)
          return isMatch ? (
            <mark
              key={i}
              data-citation-mark="true"
              className="bg-yellow-300 text-yellow-950 rounded px-0.5 ring-1 ring-yellow-500/40 font-medium"
            >
              {part}
            </mark>
          ) : (
            <span key={i}>{part}</span>
          )
        })}
      </>
    )
  }

  return (
    <div
      ref={containerRef}
      data-testid="document-pdf-viewer-fallback"
      role="document"
      aria-label="Document source text with citation highlights"
      className={`h-full font-mono text-xs leading-relaxed rounded-lg overflow-auto ${className}`}
    >
      {lines.map((line, i) => {
        const isLineHighlighted = highlightedLines.has(i)
        return (
          <div
            key={i}
            data-line-idx={i}
            data-line-highlighted={isLineHighlighted ? 'true' : undefined}
            className={`flex gap-3 px-3 py-0.5 transition-colors ${
              isLineHighlighted
                ? 'bg-yellow-100/70 border-l-2 border-yellow-500'
                : 'border-l-2 border-transparent'
            }`}
          >
            <span className="select-none text-muted-foreground w-8 shrink-0 text-right">{i + 1}</span>
            <span className="whitespace-pre-wrap break-words flex-1 text-surface-foreground">
              {renderLine(line)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
