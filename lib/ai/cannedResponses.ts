/**
 * Canned responses for all three demo scenarios.
 *
 * Used as the AiUnreachableError fallback in each TS AI wrapper so the demo
 * continues cleanly when the FastAPI sidecar is unreachable (dead WiFi, etc.)
 * The AI cache handles "service is up but slow"; this layer handles "service is down."
 *
 * Key formats:
 *   evidence extraction:   "extract:${encounterId}:${criterionId}"
 *   code derivation:       "derive:${encounterId}"
 *   submission packet:     "packet:${encounterId}"
 *
 * Rule: If a key is not in the map, throw — non-demo paths must not silently
 * succeed via the fallback.
 */

import type { DeriveCodesResponse } from './schemas/codeDerivation'
import type { ExtractEvidenceResponse } from './schemas/evidenceExtraction'
import type { GeneratePacketResponse } from './schemas/submissionPacket'

// ─── Evidence extraction canned entries ──────────────────────────────────────

export interface CannedEvidenceEntry {
  status: 'passed' | 'failed' | 'needs_info'
  rationale: string
  confidence: number
  supportingText: string
  sourceId: string
  sourceType: 'clinical_note' | 'attachment'
}

export const CANNED_EVIDENCE: Record<string, CannedEvidenceEntry> = {
  // ── Scenario 1: Head CT — all criteria pass ─────────────────────────────
  'extract:encounter-head-ct:criterion-head-ct-1': {
    status: 'passed',
    rationale:
      'The note documents a 3-day history of new-onset severe headache described as "the worst headache of my life" with no prior similar episodes — a new headache pattern.',
    confidence: 0.97,
    supportingText:
      'New-onset severe headache for 3 days... described by the patient as "the worst headache of my life." The onset was thunderclap in quality. No prior history of similar headache episodes.',
    sourceId: 'note-head-ct-hp',
    sourceType: 'clinical_note',
  },
  'extract:encounter-head-ct:criterion-head-ct-2': {
    status: 'passed',
    rationale:
      'The note explicitly documents thunderclap onset, photophobia, phonophobia, and a "worst headache of life" presentation — all classic red flag features.',
    confidence: 0.98,
    supportingText:
      'Red flags documented: thunderclap onset (reaching maximal intensity in seconds), new worst-ever headache pattern, photophobia, no prior headache history, failure to respond to analgesics.',
    sourceId: 'note-head-ct-hp',
    sourceType: 'clinical_note',
  },
  'extract:encounter-head-ct:criterion-head-ct-3': {
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
  'extract:encounter-knee-mri:criterion-knee-mri-1': {
    status: 'needs_info',
    rationale:
      'The note references conservative measures as having failed per patient report and mentions a "6-8 weeks" home exercise program, but no formal PT records, NSAID trial dates, or documented outcomes are present.',
    confidence: 0.38,
    supportingText:
      "The patient verbally reports that conservative measures failed per patient report. Formal physical therapy records were not available for review at today's visit. The patient reports participating in approximately 6-8 weeks of home exercise program and NSAID therapy as directed by his PCP.",
    sourceId: 'note-knee-mri-ortho-consult',
    sourceType: 'clinical_note',
  },
  // Variant used when an attachment (PT records) is present in the evidence corpus
  'extract:encounter-knee-mri:criterion-knee-mri-1:with-attachment': {
    status: 'passed',
    rationale:
      'PT discharge summary confirms 8 weeks of formal physical therapy (16 sessions, 2x/week) with concurrent NSAID therapy (naproxen 500 mg BID) and activity modification — satisfying all three required conservative therapy modalities for >= 6 weeks with documented inadequate improvement.',
    confidence: 0.95,
    supportingText:
      'After completion of a structured 8-week physical therapy program consisting of 16 sessions at 2x/week, combined with NSAID therapy (naproxen 500 mg BID per physician order) and activity modification (no running, pivoting, or recreational soccer), Mr. Rodriguez demonstrates limited functional improvement. KOOS score of 48/100 at discharge represents incomplete recovery. Conservative therapy has been maximized at this time.',
    sourceId: 'knee_mri_pt_discharge_summary',
    sourceType: 'attachment',
  },
  'extract:encounter-knee-mri:criterion-knee-mri-2': {
    status: 'passed',
    rationale:
      'The physical examination documents a positive McMurray test, medial joint line tenderness, and mild effusion — findings consistent with internal derangement.',
    confidence: 0.95,
    supportingText:
      "McMurray Test: Positive — pain and click with valgus stress and external tibial rotation (suggestive of medial meniscal pathology). Apley's Compression Test: Positive with internal rotation. Tenderness to palpation along the medial joint line. Mild effusion present.",
    sourceId: 'note-knee-mri-ortho-consult',
    sourceType: 'clinical_note',
  },
  'extract:encounter-knee-mri:criterion-knee-mri-3': {
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
  'extract:encounter-botox:criterion-botox-1': {
    status: 'passed',
    rationale:
      'The neurology note documents 18 headache days/month, 10 migraine-quality days/month each lasting >4 hours — satisfying all three components of the chronic migraine definition.',
    confidence: 0.97,
    supportingText:
      'Headache frequency: Patient reports 18 headache days per month for the past 4 months. Of these, 10 are migraine-quality headaches... Each migraine episode lasts greater than 4 hours without acute treatment.',
    sourceId: 'note-botox-neuro-progress',
    sourceType: 'clinical_note',
  },
  'extract:encounter-botox:criterion-botox-2': {
    status: 'needs_info',
    rationale:
      'Propranolol (4-month trial) and topiramate (3-month trial) satisfy the criterion. However, amitriptyline was only trialed for 6 weeks with ambiguous discontinuation language — below the 2-month threshold.',
    confidence: 0.55,
    supportingText:
      'Amitriptyline 25 mg nightly (antidepressant/tricyclic class): Trialed amitriptyline 6 weeks then discontinued for moderate sedation. Note: This trial was 6 weeks in duration, which is below the typically recommended 2-month adequate trial threshold.',
    sourceId: 'note-botox-neuro-progress',
    sourceType: 'clinical_note',
  },
  'extract:encounter-botox:criterion-botox-3': {
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

// ─── Code derivation canned entries ──────────────────────────────────────────

export const CANNED_DERIVATION: Record<string, DeriveCodesResponse> = {
  'derive:encounter-head-ct': {
    procedures: [
      {
        code_type: 'CPT',
        code: '70450',
        modifier: null,
        description: 'Computed tomography, head or brain; without contrast material',
        confidence: 0.97,
        rationale: 'Plan orders CT head without contrast for thunderclap headache workup.',
      },
    ],
    diagnoses: [
      {
        code_type: 'ICD10',
        code: 'R51.9',
        description: 'Headache, unspecified',
        confidence: 0.92,
        rationale: 'Working diagnosis pending imaging: R51.9 per plan section.',
        is_primary: true,
      },
    ],
    prompt_version: 'canned-v1',
    trace_id: null,
    cached: true,
  },
  'derive:encounter-knee-mri': {
    procedures: [
      {
        code_type: 'CPT',
        code: '73721',
        modifier: null,
        description: 'Magnetic resonance imaging, any joint of lower extremity; without contrast material',
        confidence: 0.96,
        rationale: 'Plan orders MRI right knee without contrast to evaluate suspected medial meniscal tear.',
      },
    ],
    diagnoses: [
      {
        code_type: 'ICD10',
        code: 'M23.231',
        description:
          'Derangement of anterior horn of medial meniscus due to old tear or injury, right knee',
        confidence: 0.94,
        rationale:
          'Assessment documents M23.231 — derangement of medial meniscus due to old tear, right knee.',
        is_primary: true,
      },
    ],
    prompt_version: 'canned-v1',
    trace_id: null,
    cached: true,
  },
  'derive:encounter-botox': {
    procedures: [
      {
        code_type: 'HCPCS',
        code: 'J0585',
        modifier: null,
        description: 'Injection, onabotulinumtoxinA, 1 unit',
        confidence: 0.98,
        rationale:
          'Plan orders HCPCS J0585 — onabotulinumtoxinA per unit (155 units total) per PREEMPT protocol.',
      },
    ],
    diagnoses: [
      {
        code_type: 'ICD10',
        code: 'G43.701',
        description:
          'Chronic migraine without aura, intractable, without status migrainosus',
        confidence: 0.99,
        rationale:
          'Assessment: Chronic migraine without aura, intractable — ICD-10: G43.701, ICHD-3 criteria met.',
        is_primary: true,
      },
    ],
    prompt_version: 'canned-v1',
    trace_id: null,
    cached: true,
  },
}

// ─── Lookup helpers ───────────────────────────────────────────────────────────

function buildEvidenceResponse(criterionId: string, entry: CannedEvidenceEntry): ExtractEvidenceResponse {
  return {
    criterion_id: criterionId,
    status: entry.status,
    rationale: entry.rationale,
    reasoning: entry.rationale,
    confidence: entry.confidence,
    citations: [
      {
        source_type: entry.sourceType,
        source_id: entry.sourceId,
        supporting_texts: [entry.supportingText],
        reasoning: entry.rationale,
        confidence: entry.confidence,
        bboxes: [],
        line_numbers: [],
      },
    ],
    model: 'canned',
    prompt_version: 'canned-v1',
    cached: true,
    trace_id: null,
    citation_validation: 'all_valid',
  }
}

export function getCannedEvidence(
  encounterId: string,
  criterionId: string,
  options: { hasAttachment?: boolean } = {}
): ExtractEvidenceResponse {
  // For attachment-sensitive criteria, prefer the with-attachment variant when uploads are present
  if (options.hasAttachment) {
    const attachKey = `extract:${encounterId}:${criterionId}:with-attachment`
    if (CANNED_EVIDENCE[attachKey]) {
      return buildEvidenceResponse(criterionId, CANNED_EVIDENCE[attachKey])
    }
  }
  const key = `extract:${encounterId}:${criterionId}`
  const entry = CANNED_EVIDENCE[key]
  if (!entry) {
    throw new Error(
      `getCannedEvidence: no canned response for key "${key}" — non-demo paths must not use the canned fallback`
    )
  }
  return buildEvidenceResponse(criterionId, entry)
}

export function getCannedDerivation(encounterId: string): DeriveCodesResponse {
  const key = `derive:${encounterId}`
  const entry = CANNED_DERIVATION[key]
  if (!entry) {
    throw new Error(
      `getCannedDerivation: no canned response for key "${key}" — non-demo paths must not use the canned fallback`
    )
  }
  return entry
}

// ─── Submission packet canned entries ────────────────────────────────────────
//
// Static PDF URLs point to pre-generated files at /submission-packets/canned/{key}.pdf
// These files are produced by the test suite fixture builder (test_submission_packet.py)
// and committed to public/submission-packets/canned/ for the demo.

export const CANNED_SUBMISSION_PACKETS: Record<string, GeneratePacketResponse> = {
  'packet:encounter-head-ct': {
    pdf_url: '/submission-packets/canned/head_ct.pdf',
    attachment_id: 'canned-head-ct',
    generated_at: '2026-05-05T00:00:00Z',
    narrative_paragraph:
      'Jordan A. presents with a new-onset thunderclap headache that reached maximal intensity within seconds, accompanied by photophobia and no prior headache history — a classic presentation requiring urgent CT head (CPT 70450) to rule out subarachnoid hemorrhage. A complete neurological examination including cranial nerves II-XII, motor strength, sensation, and coordination was documented and is intact. Medical necessity is supported by three fully satisfied policy criteria, including the presence of red flag neurological symptoms and a neurological exam that will directly inform emergent management.',
    prompt_version: 'canned-v1',
    model: 'canned',
    trace_id: null,
    cached: true,
    page_count: 2,
  },
  'packet:encounter-knee-mri': {
    pdf_url: '/submission-packets/canned/knee_mri.pdf',
    attachment_id: 'canned-knee-mri',
    generated_at: '2026-05-05T00:00:00Z',
    narrative_paragraph:
      'Sam R. presents with a 4-month history of right knee pain consistent with internal derangement, evidenced by a positive McMurray test, positive Apley compression test, medial joint line tenderness, and mild effusion on physical examination (CPT 73721). The clinical findings are consistent with a medial meniscal tear, and MRI results will directly determine whether the patient proceeds with arthroscopic meniscal repair or intensified conservative management. Two of three authorization criteria are fully satisfied; formal PT records are pending upload to complete criterion 1.',
    prompt_version: 'canned-v1',
    model: 'canned',
    trace_id: null,
    cached: true,
    page_count: 2,
  },
  'packet:encounter-botox': {
    pdf_url: '/submission-packets/canned/botox.pdf',
    attachment_id: 'canned-botox',
    generated_at: '2026-05-05T00:00:00Z',
    narrative_paragraph:
      'Priya S. meets full criteria for chronic migraine without aura (G43.701), documenting 18 headache days per month over the past 4 months with 10 migraine-quality days each lasting greater than 4 hours. Propranolol (4-month beta-blocker trial) and topiramate (3-month antiepileptic trial) each satisfy the >=2-month adequate trial threshold across two separate drug classes. The requested onabotulinumtoxinA (HCPCS J0585) administration of 155 units across 31 injection sites every 12 weeks aligns exactly with the UHC policy dosing limit for chronic migraine prophylaxis (Policy CS2026D0017AP).',
    prompt_version: 'canned-v1',
    model: 'canned',
    trace_id: null,
    cached: true,
    page_count: 2,
  },
}

export function getCannedSubmissionPacket(encounterId: string): GeneratePacketResponse {
  const key = `packet:${encounterId}`
  const entry = CANNED_SUBMISSION_PACKETS[key]
  if (!entry) {
    throw new Error(
      `getCannedSubmissionPacket: no canned response for key "${key}" — non-demo paths must not use the canned fallback`
    )
  }
  return entry
}
