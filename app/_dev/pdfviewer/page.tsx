// Dev page to verify DocumentPdfViewer renders a sample PDF with bbox overlays.
// Depends on Botox policy page images being pre-rendered (phase-4-page-images ticket).
// Visit /_dev/pdfviewer after running the page-image script.
//
// Renamed in Phase 6 / Session 7 T8 from PolicyPdfViewer → DocumentPdfViewer
// (component now serves clinical-note PDFs in addition to policy PDFs).
'use client'

import DocumentPdfViewer from '@/components/pa/DocumentPdfViewer'

const SAMPLE_DOCUMENT_DATA = {
  files: ['botox-policy.pdf'],
  presigned_urls: {
    'botox-policy.pdf': {
      '1': '/policy-pdfs/policy-uhc-botox-chronic-migraine/page_1.png',
      '2': '/policy-pdfs/policy-uhc-botox-chronic-migraine/page_2.png',
    },
  },
}

// Sample bbox: normalized coords for the "trial of at least two months" phrase on page 1
const SAMPLE_BBOXES = [
  {
    document_name: 'botox-policy.pdf',
    page_number: 1,
    bbox: [[0.1, 0.3, 0.9, 0.3, 0.9, 0.35, 0.1, 0.35]],
  },
]

export default function PdfViewerDevPage() {
  return (
    <div className="h-screen flex flex-col">
      <div className="p-4 border-b border-border bg-surface text-sm font-medium text-surface-foreground">
        DocumentPdfViewer dev test — verify bbox renders on correct page
      </div>
      <div className="flex-1 h-full">
        <DocumentPdfViewer
          documentData={SAMPLE_DOCUMENT_DATA}
          boundingBoxes={SAMPLE_BBOXES}
          className="h-full"
        />
      </div>
    </div>
  )
}
