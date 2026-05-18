/**
 * @vitest-environment jsdom
 *
 * Component tests for `components/pa/DocumentPdfViewer.tsx`.
 *
 * Phase 6 / Session 7 (T8 ui-engineer) — `PolicyPdfViewer` was renamed to
 * `DocumentPdfViewer` and now serves BOTH PDF citations and the text-on-page
 * fallback that previously lived in the (deleted) `components/ui/NoteHighlighter.tsx`.
 *
 * The component branches on prop discriminant:
 *   - `documentData` (with pre-rendered pdfviewer-data) → PDF branch (delegates
 *     to the data-labelling-library PDFViewer; we mock the dynamic import so
 *     tests run in jsdom without touching the heavy MUI/canvas stack).
 *   - `sourceText` (without `documentData`) → text-on-page fallback for the 15
 *     seeded Phase 1 ClinicalNote rows that have `pdfUrl IS NULL`.
 *
 * Demo-scenario coverage (4 patients):
 *   Head CT (Priya Shah)   — PDF branch: real fixture
 *     prisma/fixtures/fhir/binary/mock-priya-shah-headache-diary.pdf
 *   Knee MRI (Sam R.)      — text fallback: <mark>'d clinical-note text
 *   Botox (Eleanor V.)     — PDF branch: synthetic pdfviewer-data shape
 *   Power Wheelchair (J.A.) — text fallback: line-number-driven gutter
 *
 * Maps to TC-ID: `WF-PROV-citation-jump` (clinical-note citations route through
 *   the renamed DocumentPdfViewer; both branches must render a real highlight).
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

// Mock the heavy data-labelling-library PDFViewer dynamic import. The
// component's dynamic() wraps `import('@/frontend/lib/pdf-viewer/...')`; we
// intercept that exact module path so the PDF branch renders a deterministic
// stub whose attrs we can assert against.
vi.mock('@/frontend/lib/pdf-viewer/src/components/PDFViewer', () => ({
  PDFViewer: (props: Record<string, unknown>) => {
    // Surface the wire-shape props as data-* so the assertion can grep them.
    return (
      <div
        data-testid="pdfviewer-lib-mock"
        data-files={JSON.stringify((props.documentData as { files?: string[] })?.files ?? [])}
        data-bbox-count={
          Array.isArray(props.boundingBoxes) ? (props.boundingBoxes as unknown[]).length : 0
        }
        data-doc-navigation={
          ((props.userInterfaces as { docNavigation?: boolean })?.docNavigation ?? false).toString()
        }
        data-zoom={((props.userInterfaces as { zoom?: boolean })?.zoom ?? false).toString()}
      >
        mock-pdfviewer
      </div>
    )
  },
}))

import DocumentPdfViewer from '@/components/pa/DocumentPdfViewer'

afterEach(() => {
  cleanup()
})

// ─── PDF branch ───────────────────────────────────────────────────────────────

describe('DocumentPdfViewer — PDF branch (documentData present)', () => {
  // Scenario: Botox (Eleanor) — policy + clinical-note PDF citation goes
  // through the same component now.
  const SAMPLE_DOC_DATA = {
    files: ['mock-priya-shah-headache-diary.pdf'],
    presigned_urls: {
      'mock-priya-shah-headache-diary.pdf': {
        '1': '/policy-pdfs/test/page_1.png',
      },
    },
  }

  it('renders the PDFViewerLib when documentData is provided (no bboxes)', async () => {
    render(<DocumentPdfViewer documentData={SAMPLE_DOC_DATA} className="h-screen" />)

    // next/dynamic is async — wait for the lazy module to resolve.
    const lib = await screen.findByTestId('pdfviewer-lib-mock')
    expect(lib).toBeTruthy()
    // Files prop is passed verbatim — zero-transform rule.
    expect(lib.getAttribute('data-files')).toBe(
      JSON.stringify(['mock-priya-shah-headache-diary.pdf']),
    )
    // No boundingBoxes provided → component passes null.
    expect(lib.getAttribute('data-bbox-count')).toBe('0')
  })

  it('forwards boundingBoxes when they are provided', async () => {
    const bboxes = [
      {
        document_name: 'mock-priya-shah-headache-diary.pdf',
        page_number: 1,
        bbox: [[0.1, 0.3, 0.9, 0.3, 0.9, 0.35, 0.1, 0.35]],
      },
    ]
    render(
      <DocumentPdfViewer
        documentData={SAMPLE_DOC_DATA}
        boundingBoxes={bboxes}
        className="h-screen"
      />,
    )
    const lib = await screen.findByTestId('pdfviewer-lib-mock')
    expect(lib.getAttribute('data-bbox-count')).toBe('1')
  })

  it('configures userInterfaces with docNavigation + zoom enabled', async () => {
    render(<DocumentPdfViewer documentData={SAMPLE_DOC_DATA} />)
    const lib = await screen.findByTestId('pdfviewer-lib-mock')
    expect(lib.getAttribute('data-doc-navigation')).toBe('true')
    expect(lib.getAttribute('data-zoom')).toBe('true')
  })

  it('does NOT render the text-on-page fallback in the PDF branch', async () => {
    render(<DocumentPdfViewer documentData={SAMPLE_DOC_DATA} />)
    // Wait for the lazy module to resolve, then assert no fallback.
    await screen.findByTestId('pdfviewer-lib-mock')
    expect(screen.queryByTestId('document-pdf-viewer-fallback')).toBeNull()
  })
})

// ─── Text-on-page fallback branch ─────────────────────────────────────────────

describe('DocumentPdfViewer — text-on-page fallback branch (pdfUrl IS NULL)', () => {
  // Scenario: Knee MRI (Sam Rodriguez) — Phase 1 seeded clinical note with
  // no pdfUrl. T4 will eventually ingest these on demand, but for the
  // demo we ship the text-on-page fallback.
  const SAMPLE_NOTE_TEXT = [
    'Chief Complaint: Right knee pain, 4 months.',
    'HPI: 35-year-old male, pain after pivoting injury.',
    'Failed conservative therapy: 6 weeks of PT, NSAIDs, rest.',
    'Imaging review: prior X-rays unremarkable. MRI ordered.',
    'Assessment: suspected meniscal tear.',
  ].join('\n')

  it('renders the text-on-page fallback when sourceText is provided', () => {
    render(<DocumentPdfViewer sourceText={SAMPLE_NOTE_TEXT} />)
    const fallback = screen.getByTestId('document-pdf-viewer-fallback')
    expect(fallback).toBeTruthy()
    // ARIA hooks expected by WCAG-AA / keyboard navigation.
    expect(fallback.getAttribute('role')).toBe('document')
    expect(fallback.getAttribute('aria-label')).toContain('citation highlights')
  })

  it('renders one row per source line with a 1-indexed gutter number', () => {
    const { container } = render(<DocumentPdfViewer sourceText={SAMPLE_NOTE_TEXT} />)
    const rows = container.querySelectorAll('[data-line-idx]')
    expect(rows.length).toBe(5)
    // Gutter numbers are rendered as the visible text "1" through "5".
    const text = container.textContent || ''
    for (const n of ['1', '2', '3', '4', '5']) {
      expect(text).toContain(n)
    }
  })

  it('does NOT delegate to the PDFViewer mock in fallback mode', () => {
    render(<DocumentPdfViewer sourceText={SAMPLE_NOTE_TEXT} />)
    expect(screen.queryByTestId('pdfviewer-lib-mock')).toBeNull()
  })

  it('highlights the gutter for explicit lineNumbers (1-indexed → 0-indexed)', () => {
    const { container } = render(
      <DocumentPdfViewer sourceText={SAMPLE_NOTE_TEXT} lineNumbers={[2, 4]} />,
    )
    const highlightedRows = container.querySelectorAll('[data-line-highlighted="true"]')
    // 2 (→ idx 1) and 4 (→ idx 3) should be highlighted.
    const highlightedIds = Array.from(highlightedRows).map((el) =>
      el.getAttribute('data-line-idx'),
    )
    expect(highlightedIds).toEqual(expect.arrayContaining(['1', '3']))
    expect(highlightedIds.length).toBe(2)
  })

  it('renders <mark>s for supporting-text fragments (clinical-note citation)', () => {
    // Scenario: Power Wheelchair (Jordan Avery) — AI citation supportingTexts
    // pulled verbatim from a 1-page clinical note. The fallback must <mark>
    // each long-enough fragment.
    const { container } = render(
      <DocumentPdfViewer
        sourceText={SAMPLE_NOTE_TEXT}
        supportingTexts={['Failed conservative therapy: 6 weeks of PT']}
      />,
    )
    const marks = container.querySelectorAll('mark[data-citation-mark="true"]')
    expect(marks.length).toBeGreaterThanOrEqual(1)
    const marked = Array.from(marks).map((m) => m.textContent ?? '').join(' | ')
    expect(marked).toContain('Failed conservative therapy')
  })

  it('skips <mark> output when no supporting fragment is long enough', () => {
    // Fragments < MIN_FRAGMENT_LEN (12) get dropped — the regex is null →
    // every line renders as a plain span with no <mark> children.
    const { container } = render(
      <DocumentPdfViewer
        sourceText={SAMPLE_NOTE_TEXT}
        supportingTexts={['OK', 'yes', 'no']}
      />,
    )
    expect(container.querySelectorAll('mark[data-citation-mark="true"]').length).toBe(0)
  })

  it('marks gutter highlights for substring matches even with no explicit lineNumbers', () => {
    // Scenario: AI returned supportingTexts but no lineNumbers (FaithfulnessDetector
    // path may not always populate line indices). The fallback should still
    // surface the right line via the substring match.
    const { container } = render(
      <DocumentPdfViewer
        sourceText={SAMPLE_NOTE_TEXT}
        supportingTexts={['suspected meniscal tear']}
      />,
    )
    const highlightedRows = container.querySelectorAll('[data-line-highlighted="true"]')
    // Line idx 4 contains "suspected meniscal tear".
    const ids = Array.from(highlightedRows).map((el) => el.getAttribute('data-line-idx'))
    expect(ids).toContain('4')
  })

  it('renders an empty sourceText as a single empty row (no crash)', () => {
    const { container } = render(<DocumentPdfViewer sourceText="" />)
    const rows = container.querySelectorAll('[data-line-idx]')
    expect(rows.length).toBe(1)
  })
})

// ─── Cross-branch behavior (smoke) ────────────────────────────────────────────

describe('DocumentPdfViewer — cross-branch smoke', () => {
  it('does not render BOTH branches simultaneously', async () => {
    // The discriminated-union types prevent this at compile time, but a smoke
    // test guards against accidental refactors that bypass the union.
    render(
      <DocumentPdfViewer
        documentData={{
          files: ['x.pdf'],
          presigned_urls: { 'x.pdf': { '1': '/x.png' } },
        }}
      />,
    )
    await waitFor(() => expect(screen.queryByTestId('pdfviewer-lib-mock')).toBeTruthy())
    expect(screen.queryByTestId('document-pdf-viewer-fallback')).toBeNull()
  })
})
