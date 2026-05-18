import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { getProviderId } from '@/lib/api/auth'
import { generateSubmissionPacket } from '@/lib/ai/submissionPacket'

const ALLOWED_STATUSES = new Set([
  'ready_for_submission',
  'pending',
  'in_progress',
  'rfi',
  'pending_submission',
])

const BodySchema = z.object({
  regenerate: z.boolean().default(false),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: paId } = await params

  const pa = await prisma.priorAuth.findUnique({
    where: { id: paId },
    include: {
      encounter: {
        include: { patient: true, notes: true },
      },
      provider: true,
      payer: true,
      codes: true,
      attachments: true,
    },
  })
  if (!pa) return NextResponse.json({ error: 'PA not found' }, { status: 404 })
  if (!ALLOWED_STATUSES.has(pa.status)) {
    return NextResponse.json(
      { error: `Cannot generate packet in status: ${pa.status}` },
      { status: 400 },
    )
  }

  let body: { regenerate: boolean }
  try {
    const raw = await request.json().catch(() => ({}))
    body = BodySchema.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const providerId = getProviderId(request)

  // Run both in parallel: AI packet generation + live criteria fetch from DB
  const [result, rawCriteriaResults] = await Promise.all([
    generateSubmissionPacket(paId, {
      regenerate: body.regenerate,
      providerId,
      encounterId: pa.encounter.id,
    }),
    prisma.criterionResult.findMany({
      where: { priorAuthId: paId },
      orderBy: { evaluatedAt: 'desc' },
      include: {
        citations: true,
        criterion: { select: { id: true, ordinal: true, text: true } },
      },
    }),
  ])

  // De-duplicate: keep the most recent result per criterionId
  const seen = new Set<string>()
  const latestResults: typeof rawCriteriaResults = []
  for (const r of rawCriteriaResults) {
    if (!seen.has(r.criterionId)) {
      seen.add(r.criterionId)
      latestResults.push(r)
    }
  }
  latestResults.sort((a, b) => a.criterion.ordinal - b.criterion.ordinal)

  // Build live packet_data from current DB state so the preview always
  // reflects overrides, uploads, and rechecks regardless of PDF cache.
  const patient = pa.encounter.patient

  // Cited documents — mirrors Python logic in services/ai/submission_packet.py.
  // Only docs cited by passed/manual_override criteria are included in the packet.
  const citedSourceIds = new Set<string>()
  for (const r of latestResults) {
    if (r.status !== 'passed' && r.status !== 'manual_override') continue
    for (const c of r.citations) {
      if (c.sourceId) citedSourceIds.add(c.sourceId)
    }
  }

  const titleCase = (s: string) =>
    s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  const citedDocuments: Array<{ kind: 'note' | 'attachment'; label: string; sublabel: string }> = []
  for (const note of pa.encounter.notes) {
    if (!citedSourceIds.has(note.id)) continue
    const dateStr = new Date(note.authoredAt).toLocaleDateString()
    citedDocuments.push({
      kind: 'note',
      label: titleCase(note.noteType ?? 'note'),
      sublabel: `${dateStr} · ${note.authorRole}`,
    })
  }
  for (const att of pa.attachments) {
    if (att.kind !== 'upload') continue
    if (!citedSourceIds.has(att.id)) continue
    citedDocuments.push({
      kind: 'attachment',
      label: att.filename,
      sublabel: att.mimeType || '',
    })
  }

  const packetData = {
    patient_name: `${patient.firstName} ${patient.lastName}`,
    dob: patient.dob,
    payer_name: pa.payer.name,
    provider_name: `Dr. ${pa.provider.firstName} ${pa.provider.lastName}`,
    specialty: pa.provider.specialty,
    generated_at: new Date().toISOString(),
    codes: pa.codes.map((c) => ({
      code: c.code,
      code_type: c.codeType,
      modifier: c.modifier,
      description: c.description,
      is_primary: c.isPrimary,
    })),
    priority: pa.priority,
    priority_rationale: pa.priorityRationale,
    cited_documents: citedDocuments,
    narrative_paragraph: result.narrative_paragraph,
  }

  const pdfDownloadUrl = result.model === 'canned'
    ? `/submission-packets/canned/${pa.encounter.id.replace(/^encounter-/, '').replace(/-/g, '_')}.pdf`
    : `/submission-packets/${paId}.pdf`

  return NextResponse.json({
    attachment_id: result.attachment_id,
    generated_at: result.generated_at,
    narrative_paragraph: result.narrative_paragraph,
    cached: result.cached,
    pdf_url: pdfDownloadUrl,
    packet_data: packetData,
  })
}
