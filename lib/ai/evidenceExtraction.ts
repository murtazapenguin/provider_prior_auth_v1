/**
 * lib/ai/evidenceExtraction.ts — Phase 3 implementation.
 *
 * Calls /extract-evidence-criterion on the FastAPI AI sidecar.
 * Validates the response with zod.  Does NOT import the Penguin SDK.
 *
 * The CANNED_RESPONSES export is kept for the Phase 2 matchEngine which reads
 * it as a side channel for sourceType / sourceId.  It is also the fallback
 * layer for demo determinism (implemented in a separate ticket).
 */

import { AiInvalidResponseError, AiUnreachableError, aiFetch } from './penguinClient'
import { getCannedEvidence } from './cannedResponses'
import { ExtractEvidenceResponseSchema } from './schemas/evidenceExtraction'
import type { ExtractEvidenceResponse } from './schemas/evidenceExtraction'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface EvidenceSource {
  sourceType: 'clinical_note' | 'attachment' | 'policy_pdf'
  sourceId: string
  text: string
}

// ─── Canned responses (kept for Phase 2 matchEngine side-channel) ─────────────
// Key: `${encounterId}:${criterionId}`
// Phase 3 embeds sourceType/sourceId directly on each Citation; the matchEngine
// comment "Phase 3 will embed them directly in the AI service response" is now
// satisfied — future matchEngine cleanup can remove the CANNED_RESPONSES lookup.

export type CannedStatus = 'passed' | 'failed' | 'needs_info'

export interface CannedEntry {
  status: CannedStatus
  rationale: string
  confidence: number
  supportingText: string
  sourceId: string
  sourceType: 'clinical_note' | 'attachment'
}

export const CANNED_RESPONSES: Record<string, CannedEntry> = {
  // ── Scenario 1: Head CT — all criteria pass ─────────────────────────────
  'encounter-head-ct:criterion-head-ct-1': {
    status: 'passed',
    rationale:
      'The note documents a 3-day history of new-onset severe headache described as "the worst headache of my life" with no prior similar episodes — a new headache pattern.',
    confidence: 0.97,
    supportingText:
      'New-onset severe headache for 3 days... described by the patient as "the worst headache of my life." The onset was thunderclap in quality. No prior history of similar headache episodes.',
    sourceId: 'note-head-ct-hp',
    sourceType: 'clinical_note',
  },
  'encounter-head-ct:criterion-head-ct-2': {
    status: 'passed',
    rationale:
      'The note explicitly documents thunderclap onset, photophobia, phonophobia, and a "worst headache of life" presentation — all classic red flag features.',
    confidence: 0.98,
    supportingText:
      'Red flags documented: thunderclap onset (reaching maximal intensity in seconds), new worst-ever headache pattern, photophobia, no prior headache history, failure to respond to analgesics.',
    sourceId: 'note-head-ct-hp',
    sourceType: 'clinical_note',
  },
  'encounter-head-ct:criterion-head-ct-3': {
    status: 'passed',
    rationale:
      'A complete neurological examination is documented, including cranial nerves II-XII, motor strength, sensation, coordination, reflexes, and gait.',
    confidence: 0.99,
    supportingText:
      'Cranial nerves: II-XII intact. Motor: 5/5 strength in bilateral upper and lower extremities. Sensation: Intact to light touch, pinprick, and proprioception in all four extremities. Coordination: Finger-nose-finger and heel-shin intact bilaterally.',
    sourceId: 'note-head-ct-hp',
    sourceType: 'clinical_note',
  },

  // ── Scenario 2: Knee MRI ─────────────────────────────────────────────────
  'encounter-knee-mri:criterion-knee-mri-1': {
    status: 'needs_info',
    rationale:
      'The note references conservative measures as having failed per patient report and mentions a "6-8 weeks" home exercise program, but no formal PT records, NSAID trial dates, or documented outcomes are present — duration cannot be confirmed from the available documentation.',
    confidence: 0.38,
    supportingText:
      'The patient verbally reports that conservative measures failed per patient report. Formal physical therapy records were not available for review at today\'s visit. The patient reports participating in approximately 6-8 weeks of home exercise program and NSAID therapy as directed by his PCP.',
    sourceId: 'note-knee-mri-ortho-consult',
    sourceType: 'clinical_note',
  },
  'encounter-knee-mri:criterion-knee-mri-2': {
    status: 'passed',
    rationale:
      'The physical examination documents a positive McMurray test, medial joint line tenderness, and mild effusion — findings consistent with internal derangement.',
    confidence: 0.95,
    supportingText:
      'McMurray Test: Positive — pain and click with valgus stress and external tibial rotation (suggestive of medial meniscal pathology). Apley\'s Compression Test: Positive with internal rotation. Tenderness to palpation along the medial joint line. Mild effusion present.',
    sourceId: 'note-knee-mri-ortho-consult',
    sourceType: 'clinical_note',
  },
  'encounter-knee-mri:criterion-knee-mri-3': {
    status: 'passed',
    rationale:
      'The plan explicitly states that MRI results will directly determine whether the patient proceeds to arthroscopic surgery or intensified conservative management.',
    confidence: 0.96,
    supportingText:
      'Imaging will directly change clinical management: if MRI confirms meniscal tear, patient will be a candidate for arthroscopic meniscal repair vs. partial meniscectomy; if negative, conservative management will be intensified.',
    sourceId: 'note-knee-mri-ortho-consult',
    sourceType: 'clinical_note',
  },

  // ── Scenario 3: Botox ─────────────────────────────────────────────────────
  'encounter-botox:criterion-botox-1': {
    status: 'passed',
    rationale:
      'The neurology note documents 18 headache days/month, 10 migraine-quality days/month each lasting >4 hours — satisfying all three components of the chronic migraine definition.',
    confidence: 0.97,
    supportingText:
      'Headache frequency: Patient reports 18 headache days per month for the past 4 months. Of these, 10 are migraine-quality headaches... Each migraine episode lasts greater than 4 hours without acute treatment.',
    sourceId: 'note-botox-neuro-progress',
    sourceType: 'clinical_note',
  },
  'encounter-botox:criterion-botox-2': {
    status: 'needs_info',
    rationale:
      'Propranolol (4-month trial, beta blocker) and topiramate (3-month trial, antiepileptic) both meet the ≥2-month threshold and cover two distinct policy classes, which satisfies the criterion letter. However, the chart also documents an amitriptyline trial of only 6 weeks with ambiguous discontinuation language ("moderate sedation") — below the 2-month threshold and unclear whether it constitutes documented intolerance. The AI flags this for provider clarification.',
    confidence: 0.55,
    supportingText:
      'Amitriptyline 25 mg nightly (antidepressant/tricyclic class): Trialed amitriptyline 6 weeks then discontinued for moderate sedation. Note: This trial was 6 weeks in duration, which is below the typically recommended 2-month adequate trial threshold.',
    sourceId: 'note-botox-neuro-progress',
    sourceType: 'clinical_note',
  },
  'encounter-botox:criterion-botox-3': {
    status: 'passed',
    rationale:
      'The plan documents 155 units across 31 injection sites every 12 weeks — an exact match to the policy dosing limit.',
    confidence: 0.99,
    supportingText:
      '155 units administered intramuscularly, divided across 31 injection sites across 7 head and neck muscles (corrugator, procerus, frontalis, temporalis, occipitalis, cervical paraspinal muscle group, trapezius) every 12 weeks.',
    sourceId: 'note-botox-neuro-progress',
    sourceType: 'clinical_note',
  },
}

// ─── Request body types ────────────────────────────────────────────────────────

interface CriterionMeta {
  id: string
  text: string
  evidence_hint?: string | null
  required_codes?: string[]
}

interface SourceItem {
  id: string
  kind: 'clinical_note' | 'attachment' | 'policy_pdf'
  text: string
  line_numbered_text?: string | null
}

interface ExtractEvidenceRequestBody {
  criterion: CriterionMeta
  corpus: SourceItem[]
  pa_id?: string | null
  provider_id?: string | null
}

// ─── extractEvidence ──────────────────────────────────────────────────────────
// Locked signature — do not change. matchEngine calls this directly.
//
// Phase 3 implementation: calls the FastAPI sidecar and validates the response
// with zod. The canned-response fallback for demo determinism is implemented in
// a separate ticket (orchestrator step 6); for now, any AI service error surfaces
// as a thrown exception which the matchEngine will catch and surface as needs_info.

export async function extractEvidence(
  paId: string,
  criterionId: string,
  criterionText: string,
  sources: EvidenceSource[],
  encounterId?: string
): Promise<ExtractEvidenceResponse> {
  const body: ExtractEvidenceRequestBody = {
    criterion: {
      id: criterionId,
      text: criterionText,
    },
    corpus: sources.map((s) => ({
      id: s.sourceId,
      kind: s.sourceType,
      text: s.text,
    })),
    pa_id: paId,
  }

  const hasAttachment = sources.some((s) => s.sourceType === 'attachment')

  try {
    const raw = await aiFetch<unknown>('/extract-evidence-criterion', body)
    return ExtractEvidenceResponseSchema.parse(raw)
  } catch (err) {
    // 5xx from AI service (e.g. missing Bedrock creds in demo env) falls back to canned.
    if (err instanceof AiInvalidResponseError && err.status >= 500 && encounterId) {
      return getCannedEvidence(encounterId, criterionId, { hasAttachment })
    }

    if (err instanceof AiInvalidResponseError) throw err

    if (err instanceof AiUnreachableError && encounterId) {
      return getCannedEvidence(encounterId, criterionId, { hasAttachment })
    }

    throw err
  }
}
