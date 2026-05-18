import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { getProviderId } from '@/lib/api/auth'
import { resolveCoverage } from '@/lib/eligibility'
import { recordEvent } from '@/lib/audit/log'
import { deriveCodesFromNotes } from '@/lib/ai/codeDerivation'
import { triggerIngestForPa } from '@/lib/ai/documentIntake'

// Calls AI for code derivation + match engine. 60s = Vercel Hobby max; bump to 300 on Pro.
export const maxDuration = 60

const BodySchema = z.object({ encounterId: z.string() })

export async function POST(request: Request) {
  const providerId = getProviderId(request)

  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ detail: 'encounterId is required' }, { status: 400 })
  }

  const encounter = await prisma.encounter.findUnique({
    where: { id: parsed.data.encounterId },
    include: { patient: true },
  })
  if (!encounter) {
    return NextResponse.json({ detail: `Encounter '${parsed.data.encounterId}' not found` }, { status: 404 })
  }

  let coverage
  try {
    coverage = await resolveCoverage(prisma, encounter.patientId, encounter.encounterDate)
  } catch {
    return NextResponse.json({ detail: 'No active coverage found for patient' }, { status: 422 })
  }

  const pa = await prisma.priorAuth.create({
    data: {
      encounterId: encounter.id,
      providerId,
      payerId: coverage.payerId,
      status: 'draft',
    },
  })

  await recordEvent({
    priorAuthId: pa.id,
    type: 'pa_created',
    actor: providerId,
    metadata: { encounterId: encounter.id, payerId: coverage.payerId },
  })

  // Derive codes from notes (falls back to canned responses when AI is unreachable)
  const notes = await prisma.cachedDocumentReference.findMany({ where: { encounterId: encounter.id } })
  try {
    const derivation = await deriveCodesFromNotes({
      encounter_id: encounter.id,
      notes: notes.map((n) => ({
        id: n.id,
        note_type: n.noteType,
        author_role: n.authorRole,
        text: n.text,
      })),
      pa_id: pa.id,
      provider_id: providerId,
    })

    // Persist derived codes
    if (derivation.procedures.length > 0 || derivation.diagnoses.length > 0) {
      await prisma.priorAuthCode.createMany({
        data: [
          ...derivation.procedures.map((p) => ({
            priorAuthId: pa.id,
            codeType: p.code_type,
            code: p.code,
            modifier: p.modifier ?? null,
            description: p.description,
            isPrimary: true,
            derivedBy: 'ai' as const,
            confidence: p.confidence,
          })),
          ...derivation.diagnoses.map((d) => ({
            priorAuthId: pa.id,
            codeType: d.code_type,
            code: d.code,
            modifier: null,
            description: d.description,
            isPrimary: d.is_primary,
            derivedBy: 'ai' as const,
            confidence: d.confidence,
          })),
        ],
      })
    }
  } catch {
    // Code derivation failure is non-fatal — PA is created, codes can be added manually
  }

  // Phase 6 T10: trigger FHIR document ingest for this PA. Pulls every
  // DocumentReference for the patient/encounter via the FHIR adapter, OCRs each
  // through Textract, and persists CachedDocumentReference rows with pdfUrl +
  // pageImages so the citation viewer + submission packet can branch to the
  // PDF path. PA creation blocks on Textract for new patients (~5-30s); cached
  // after first run via ai_call_cache (T4's two-layer idempotency). Phase 7+
  // can move this to a background job + UI loading state.
  try {
    await triggerIngestForPa(pa.id)
  } catch (err) {
    // Ingest failure is non-fatal — PA is created, ingest can be re-triggered
    // manually (e.g. via admin tool). FHIR_MODE=mock + missing fixtures, or AI
    // service down, both land here.
    console.warn(`[pa.create] triggerIngestForPa(${pa.id}) failed:`, err instanceof Error ? err.message : err)
  }

  const paWithCodes = await prisma.priorAuth.findUnique({
    where: { id: pa.id },
    include: { codes: true },
  })

  return NextResponse.json(paWithCodes, { status: 201 })
}
