// PA Detail page — Server Component.
// Fetches the full PA from the DB and renders the action surface (header,
// patient summary, documents bar, evidence summary card, action bar).
// The detailed criteria checklist + citation viewer live behind the
// EvidenceCheckModal that opens from the evidence summary card.

import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db/client'

// Server actions invoked from this page (upload-action) inherit this timeout.
// 60s = Vercel Hobby max; bump to 300 on Pro for heavy AI rechecks.
export const maxDuration = 60

import { StatusPill, Card } from '@/components/ui'
import Checklist from '@/components/pa/Checklist'
import PriorityChip from '@/components/pa/PriorityChip'
import type { Priority } from '@/components/pa/PrioritySelector'
import type {
  CriterionResultRow,
  CitationShape,
  AttachmentSummary,
} from '@/components/pa/Checklist'
import type {
  ClinicalNoteSummary as ModalNoteSummary,
  AttachmentSummary as ModalAttachmentSummary,
} from '@/components/pa/EvidenceCheckModal'

interface Props {
  params: Promise<{ id: string }>
}

// Mirrors the EDITABLE_STATUSES set in /api/pa/[id]/priority/route.ts.
// Keep these in sync — once a PA is submitted, priority is locked.
const PRIORITY_EDITABLE_STATUSES = new Set([
  'draft',
  'pending_submission',
  'ready_for_submission',
])

export default async function PaDetailPage({ params }: Props) {
  const { id } = await params

  const pa = await prisma.priorAuth.findUnique({
    where: { id },
    include: {
      encounter: { include: { patient: true, notes: true } },
      provider: true,
      payer: true,
      codes: true,
      criteriaResults: {
        orderBy: { evaluatedAt: 'desc' },
        include: { citations: true, criterion: { include: { policy: { select: { title: true } } } } },
      },
      attachments: true,
    },
  })

  if (!pa) notFound()

  const patient = pa.encounter.patient

  // De-duplicate criteriaResults: keep the most recent result per criterionId
  // (the API returns all results ordered desc; we take the first occurrence per criterion)
  const seenCriterionIds = new Set<string>()
  const latestResults: typeof pa.criteriaResults = []
  for (const r of pa.criteriaResults) {
    if (!seenCriterionIds.has(r.criterionId)) {
      seenCriterionIds.add(r.criterionId)
      latestResults.push(r)
    }
  }

  const criteriaResultRows: CriterionResultRow[] = latestResults.map((r) => ({
    id: r.id,
    criterionId: r.criterionId,
    status: r.status,
    rationale: r.rationale,
    confidence: r.confidence,
    citations: r.citations.map((c) => ({
      id: c.id,
      sourceType: c.sourceType,
      sourceId: c.sourceId,
      supportingTexts: c.supportingTexts,
      reasoning: c.reasoning ?? null,
      confidence: c.confidence,
      bboxes: c.bboxes as CitationShape['bboxes'],
      lineNumbers: c.lineNumbers.length > 0 ? c.lineNumbers : null,
    })),
    criterion: {
      id: r.criterion.id,
      policyId: r.criterion.policyId,
      ordinal: r.criterion.ordinal,
      text: r.criterion.text,
      policyTitle: r.criterion.policy?.title ?? undefined,
      evidenceHint: r.criterion.evidenceHint ?? undefined,
      uploadHint: r.criterion.uploadHint ?? undefined,
    },
  }))

  // Documents bar attachments — narrow shape (filename + uploadedAt only).
  const attachmentSummaries: AttachmentSummary[] = pa.attachments
    .filter((a) => a.kind === 'upload')
    .map((a) => ({
      id: a.id,
      filename: a.filename,
      uploadedAt: a.uploadedAt.toISOString(),
    }))
    .sort((a, b) => (a.uploadedAt > b.uploadedAt ? -1 : 1))

  // EvidenceCheckModal documents — wider shape (carries mimeType + extractedText).
  // Phase 6 T10: pdfUrl + pageImages flow through so DocumentBody can route FHIR-
  // ingested notes through DocumentPdfViewer's PDF branch (bbox overlays). Legacy
  // seeded notes have both fields null and use the text-on-page fallback.
  const modalNoteSummaries: ModalNoteSummary[] = pa.encounter.notes.map((n) => ({
    id: n.id,
    noteType: n.noteType,
    authoredAt: n.authoredAt.toISOString(),
    authorRole: n.authorRole,
    text: n.text,
    pdfUrl: n.pdfUrl,
    pageImages: n.pageImages,
  }))
  const modalAttachmentSummaries: ModalAttachmentSummary[] = pa.attachments
    .filter((a) => a.kind === 'upload')
    .map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      uploadedAt: a.uploadedAt.toISOString(),
      extractedText: a.extractedText,
      // Phase 6 PDF-viewer build: when /ingest-attachment has run, pageImages
      // carries the pdfviewer-data shape (files + presigned_urls); DocumentBody
      // routes those uploads through DocumentPdfViewer's PDF branch instead of
      // the iframe / text fallback.
      pageImages: a.pageImages,
    }))
    .sort((a, b) => (a.uploadedAt > b.uploadedAt ? -1 : 1))

  const patientDob = new Date(patient.dob)
  const age = Math.floor(
    (Date.now() - patientDob.getTime()) / (1000 * 60 * 60 * 24 * 365.25)
  )

  const primaryCode = pa.codes.find((c) => c.isPrimary) ?? pa.codes[0]
  const diagnosisCodes = pa.codes.filter((c) => c.codeType === 'ICD10')

  const patientName = `${patient.firstName} ${patient.lastName}`
  const procedureLabel = primaryCode
    ? `${primaryCode.codeType} ${primaryCode.code} — ${primaryCode.description}`
    : 'Procedure pending'

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto px-4 py-6">
      {/* ─── Header ─── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <h1 className="text-xl font-bold text-surface-foreground">
              Prior Authorization
            </h1>
            <StatusPill status={pa.status} />
            <PriorityChip
              paId={id}
              priority={pa.priority as Priority}
              priorityRationale={pa.priorityRationale}
              editable={PRIORITY_EDITABLE_STATUSES.has(pa.status)}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {pa.payer.name}
            {pa.trackingId ? ` · Tracking: ${pa.trackingId}` : ''}
          </p>
        </div>
      </div>

      {/* ─── Patient + provider summary ─── */}
      <Card padding="md">
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
          <SummaryItem label="Patient" value={patientName} />
          <SummaryItem label="DOB" value={`${patientDob.toLocaleDateString()} (age ${age})`} />
          <SummaryItem label="Provider" value={`Dr. ${pa.provider.firstName} ${pa.provider.lastName}`} />
          <SummaryItem label="Specialty" value={pa.provider.specialty} />
          {primaryCode && (
            <SummaryItem
              label="Procedure"
              value={`${primaryCode.code} — ${primaryCode.description}`}
            />
          )}
          {diagnosisCodes.length > 0 && (
            <SummaryItem
              label="Diagnosis"
              value={diagnosisCodes.map((c) => c.code).join(', ')}
            />
          )}
          <SummaryItem
            label="Submitted"
            value={pa.submittedAt ? new Date(pa.submittedAt).toLocaleString() : '—'}
          />
          {pa.payerExpiresAt && (
            <SummaryItem
              label="Auth expires"
              value={new Date(pa.payerExpiresAt).toLocaleDateString()}
            />
          )}
        </div>
      </Card>

      {/* Action surface: documents bar + evidence summary + bottom action bar.
          The deep criteria UI lives inside the EvidenceCheckModal that the
          summary card opens. */}
      <Checklist
        paId={id}
        paStatus={pa.status}
        patientName={patientName}
        procedureLabel={procedureLabel}
        criteriaResults={criteriaResultRows}
        attachments={attachmentSummaries}
        modalAttachments={modalAttachmentSummaries}
        clinicalNotes={modalNoteSummaries}
      />
    </div>
  )
}

// ─── Summary item ─────────────────────────────────────────────────────────────

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground font-medium">{label}</dt>
      <dd className="text-sm text-surface-foreground">{value}</dd>
    </div>
  )
}
