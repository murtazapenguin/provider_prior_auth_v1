/**
 * runMatchEngine
 *
 * Evaluates all criteria of the applicable policy(ies) against the clinical
 * corpus assembled from the PA's encounter notes and uploaded attachments.
 *
 * Steps (per POLICIES.md "The matching engine"):
 *   1. Load the PA (codes, encounter notes, attachments).
 *   2. Resolve applicable policies via findApplicablePolicies.
 *   3. Assemble the chart corpus (notes + attachment extracted text).
 *   4. For each criterion, call extractEvidence (capped at 12 concurrent).
 *   5. Persist each CriterionResult + child Citation rows.
 *   6. Write a PaEvent per criterion with type='criterion_evaluated'.
 *   7. Apply group operators (ALL / ANY) and aggregate to PA-level result.
 *   8. Return MatchResult — the caller (route handler) decides what to do
 *      with the status machine; this function never writes PriorAuth.status.
 */

import pLimit from 'p-limit'
import type { PrismaClient } from '@/app/generated/prisma/client'
import { extractEvidence, CANNED_RESPONSES, type EvidenceSource } from '@/lib/ai/evidenceExtraction'
import {
  scoreRelevance,
  buildSnippet,
  groupRecommendedByCriterion,
  type TriageDocMeta,
  type RelevanceScore,
} from '@/lib/ai/documentTriage'
import { recordEvent } from '@/lib/audit/log'
import { findApplicablePolicies } from './lookup'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CriterionResult {
  criterionId: string
  criterionText: string
  status: 'passed' | 'failed' | 'needs_info' | 'manual_override'
  rationale: string | null
  confidence: number | null
}

export interface MatchResult {
  /** The policy that was evaluated. When multiple policies apply, this is
   *  the first one (most specific lookup order). */
  policyId: string
  criteriaResults: CriterionResult[]
  /**
   * Aggregate PA-level result:
   * - all_passed:    every criterion passed (ready for submission)
   * - has_failures:  at least one criterion explicitly failed
   * - has_needs_info: no explicit failures but at least one needs_info
   */
  overallStatus: 'all_passed' | 'has_failures' | 'has_needs_info'
  /** Human-readable labels for each blocking criterion (UI checklist). */
  missingItems: string[]
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Applies group operators (ALL / ANY) to produce a single pass/fail/needs_info
 * result for a group of criteria.  Returns the per-criterion results unchanged
 * when there are no group assignments.
 */
function applyGroupOperators(
  results: CriterionResult[],
  criteria: Array<{ id: string; group: string | null; groupOperator: string | null }>
): CriterionResult[] {
  // Build a map from criterionId → result for quick lookup.
  const resultMap = new Map(results.map((r) => [r.criterionId, r]))

  // Group by group name (null = ungrouped).
  const groups = new Map<string | null, typeof criteria>()
  for (const c of criteria) {
    const key = c.group ?? null
    const members = groups.get(key) ?? []
    members.push(c)
    groups.set(key, members)
  }

  const merged: CriterionResult[] = []

  for (const [groupName, members] of groups) {
    if (groupName === null || members.length === 1) {
      // Ungrouped or single-member group — pass through as-is.
      for (const m of members) {
        const r = resultMap.get(m.id)
        if (r) merged.push(r)
      }
      continue
    }

    // All members of a named group share the same groupOperator by convention.
    const operator = members[0].groupOperator?.toUpperCase() ?? 'ALL'
    const memberResults = members.map((m) => resultMap.get(m.id)).filter(Boolean) as CriterionResult[]

    if (operator === 'ANY') {
      // ANY: group passes if at least one member passes.
      const anyPassed = memberResults.some((r) => r.status === 'passed')
      if (anyPassed) {
        // Re-emit each member as passed.
        for (const r of memberResults) merged.push({ ...r, status: 'passed' })
      } else {
        // No member passed — emit members as-is.
        for (const r of memberResults) merged.push(r)
      }
    } else {
      // ALL (default): pass through each result unchanged —
      // a failed/needs_info member will surface in the aggregate.
      for (const r of memberResults) merged.push(r)
    }
  }

  return merged
}

/**
 * Aggregates per-criterion results into the PA-level overallStatus.
 * "Most restrictive wins on missing criteria" per POLICIES.md.
 */
function aggregateStatus(
  results: CriterionResult[]
): Pick<MatchResult, 'overallStatus' | 'missingItems'> {
  const blocking = results.filter((r) => r.status !== 'passed' && r.status !== 'manual_override')
  const hasFailures = blocking.some((r) => r.status === 'failed')
  const hasNeedsInfo = blocking.some((r) => r.status === 'needs_info')

  if (blocking.length === 0) {
    return { overallStatus: 'all_passed', missingItems: [] }
  }

  const missingItems = blocking.map((r) => {
    const prefix = r.status === 'needs_info' ? '[Needs info] ' : '[Failed] '
    return `${prefix}${r.criterionText}`
  })

  if (hasFailures) {
    return { overallStatus: 'has_failures', missingItems }
  }

  if (hasNeedsInfo) {
    return { overallStatus: 'has_needs_info', missingItems }
  }

  return { overallStatus: 'all_passed', missingItems: [] }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runMatchEngine(
  prisma: PrismaClient,
  priorAuthId: string
): Promise<MatchResult> {
  // ── 1. Load the PA ────────────────────────────────────────────────────────
  const pa = await prisma.priorAuth.findUniqueOrThrow({
    where: { id: priorAuthId },
    include: {
      codes: true,
      encounter: {
        include: {
          notes: true,
        },
      },
      attachments: true,
      payer: true,
    },
  })

  // ── 2. Resolve applicable policies ───────────────────────────────────────
  // Use the primary procedure code to drive the policy lookup.
  const primaryCode = pa.codes.find((c) => c.isPrimary) ?? pa.codes[0]
  if (!primaryCode) {
    throw new Error(`PA ${priorAuthId} has no codes — cannot run match engine`)
  }

  const policies = await findApplicablePolicies(prisma, {
    codeType: primaryCode.codeType,
    code: primaryCode.code,
    coverage: { payerId: pa.payerId },
    posCode: pa.encounter.placeOfService ?? undefined,
  })

  if (policies.length === 0) {
    throw new Error(
      `No applicable policy found for code ${primaryCode.codeType} ${primaryCode.code} under payer ${pa.payerId}`
    )
  }

  // When multiple policies apply, evaluate the first (most specific).
  // A future enhancement can merge across all matching policies.
  const policy = policies[0]

  // ── 3. Assemble chart corpus ──────────────────────────────────────────────
  const sources: EvidenceSource[] = [
    ...pa.encounter.notes.map((note) => ({
      sourceType: 'clinical_note' as const,
      sourceId: note.id,
      text: note.text,
    })),
    ...pa.attachments
      .filter((att) => att.extractedText)
      .map((att) => ({
        sourceType: 'attachment' as const,
        sourceId: att.id,
        text: att.extractedText as string,
      })),
  ]

  // ── 3a. Document-triage gating (Phase 6, additive cost-control) ───────────
  // When the PA has cached FHIR DocumentReferences (rows with `pdfUrl` set —
  // populated by `triggerIngestForPa`), run a cheap Haiku triage call to
  // narrow the per-criterion corpus to the documents most likely to contain
  // evidence.  When no such rows exist (Phase 1 seeded clinical notes only,
  // demo path until Session 7 fixture pre-flight), the triage step is
  // skipped and the legacy Phase 3 corpus assembly (above) is used as-is.
  //
  // GATING ONLY: the assembled `sources` array (lines above) is left
  // untouched.  The hook below builds a per-criterion `sourcesById` filter
  // map and the criterion loop reads it to choose the corpus per criterion.
  // Removing the gating block here MUST restore exact Phase 3 behavior.
  const cachedDocRefsWithPdf = pa.encounter.notes.filter(
    (n) => n.pdfUrl !== null && n.pdfUrl !== undefined,
  )
  const useTriage = cachedDocRefsWithPdf.length > 0

  let recommendedByCriterion: Map<string, Set<string>> | null = null

  if (useTriage) {
    const triageDocs: TriageDocMeta[] = cachedDocRefsWithPdf.map((n) => ({
      id: n.id,
      fhir_id: n.fhirResourceId ?? n.id,
      doc_type: n.noteType,
      authored_at: n.authoredAt.toISOString(),
      author_role: n.authorRole,
      snippet: buildSnippet(n.text),
    }))

    try {
      const triageRes = await scoreRelevance({
        criteria: policy.criteria.map((c) => ({
          id: c.id,
          text: c.text,
          evidence_hint: c.evidenceHint ?? null,
          required_codes: c.requiredCodes ?? [],
        })),
        documents: triageDocs,
        pa_id: priorAuthId,
        top_k: 5,
        threshold: 0.4,
      })

      recommendedByCriterion = groupRecommendedByCriterion(triageRes.scores as RelevanceScore[])

      // Audit: record that triage ran (one event per PA, not per criterion —
      // detailed scoring lives in `ai_call_cache` and Langfuse traces).
      await recordEvent({
        priorAuthId,
        type: 'document_triage_completed',
        actor: 'system:match_engine',
        metadata: {
          nCriteria: policy.criteria.length,
          nDocs: triageDocs.length,
          nRecommendedPairs: triageRes.scores.filter(
            (s) => s.recommended_for_extraction,
          ).length,
          model: triageRes.model,
          promptVersion: triageRes.prompt_version,
          cached: triageRes.cached,
        },
      })
    } catch (err) {
      // Triage is additive cost control — when it fails, fall through to the
      // legacy Phase 3 corpus rather than blocking the whole match.  We log
      // the skip so an operator can see why Sonnet ran on the full corpus.
      // (The Phase 3 path is what production has always used; the
      // legacy-fallback test in this file's "skipped triage" scenario
      // exercises the same code path.)
      recommendedByCriterion = null
      await recordEvent({
        priorAuthId,
        type: 'document_triage_skipped',
        actor: 'system:match_engine',
        metadata: {
          reason: 'triage_call_failed',
          error: (err as Error).message,
          fallbackToLegacyCorpus: true,
        },
      })
    }
  }

  // ── 4. Evaluate each criterion in parallel (max 12 concurrent) ────────────
  const limit = pLimit(12)
  const encounterId = pa.encounter.id

  const rawResults = await Promise.all(
    policy.criteria.map((criterion) =>
      limit(async () => {
        // When triage ran, build a filtered corpus from the recommended
        // doc ids for THIS criterion.  Otherwise pass the full corpus
        // (legacy Phase 3 behavior).
        const corpus = (() => {
          if (!recommendedByCriterion) return sources
          const recommendedIds = recommendedByCriterion.get(criterion.id)
          if (!recommendedIds || recommendedIds.size === 0) {
            // Triage flagged nothing for this criterion — fall back to the
            // full corpus rather than starve the LLM.  False negatives in
            // triage are worse than false positives downstream.
            return sources
          }
          const filtered = sources.filter((s) => recommendedIds.has(s.sourceId))
          return filtered.length > 0 ? filtered : sources
        })()

        const aiResult = await extractEvidence(
          priorAuthId,
          criterion.id,
          criterion.text,
          corpus,
          encounterId
        )

        // ── 5. Persist CriterionResult + Citation rows ────────────────────
        const criterionResult = await prisma.criterionResult.create({
          data: {
            priorAuthId,
            criterionId: criterion.id,
            status: aiResult.status,
            rationale: aiResult.rationale ?? null,
            confidence: aiResult.confidence,
          },
        })

        // Persist each citation.  sourceType / sourceId come from the canned
        // response map (keyed by encounterId:criterionId); Phase 3 will embed
        // them directly in the AI service response.
        const cannedKey = `${encounterId}:${criterion.id}`
        const cannedEntry = CANNED_RESPONSES[cannedKey]

        for (const citation of aiResult.citations) {
          await prisma.citation.create({
            data: {
              criterionResultId: criterionResult.id,
              sourceType: cannedEntry?.sourceType ?? 'clinical_note',
              sourceId: cannedEntry?.sourceId ?? (sources[0]?.sourceId ?? 'unknown'),
              supportingTexts: citation.supporting_texts,
              reasoning: citation.reasoning ?? null,
              confidence: citation.confidence,
              bboxes: citation.bboxes as object,
              lineNumbers: citation.line_numbers,
            },
          })
        }

        // ── 6. Write PaEvent per criterion ────────────────────────────────
        await recordEvent({
          priorAuthId,
          type: 'criterion_evaluated',
          actor: 'system:match_engine',
          metadata: {
            criterionId: criterion.id,
            criterionText: criterion.text,
            status: aiResult.status,
            confidence: aiResult.confidence,
            rationale: aiResult.rationale ?? null,
            model: aiResult.model,
            promptVersion: aiResult.prompt_version,
            cached: aiResult.cached,
          },
        })

        return {
          criterionId: criterion.id,
          criterionText: criterion.text,
          status: aiResult.status as CriterionResult['status'],
          rationale: aiResult.rationale ?? null,
          confidence: aiResult.confidence,
        } satisfies CriterionResult
      })
    )
  )

  // ── 7. Apply group operators + aggregate ─────────────────────────────────
  const groupedResults = applyGroupOperators(rawResults, policy.criteria)
  const { overallStatus, missingItems } = aggregateStatus(groupedResults)

  return {
    policyId: policy.id,
    criteriaResults: groupedResults,
    overallStatus,
    missingItems,
  }
}
