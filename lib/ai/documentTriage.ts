/**
 * Phase 6 — document triage (cost-control layer).
 *
 * `scoreRelevance(req)` is the thin TS wrapper around the FastAPI
 * `/triage-documents` endpoint.  Given a PA's criteria + chart documents,
 * the Haiku-backed service emits one `RelevanceScore` per (criterion, doc)
 * pair; downstream evidence extraction (Sonnet, expensive) only runs on
 * documents flagged `recommended_for_extraction=true`.
 *
 * Snippet truncation is the CALLER's responsibility: pass at most ~500
 * chars per doc.  The match-engine hook in `lib/policies/matchEngine.ts`
 * slices `CachedDocumentReference.text.slice(0, 500)`.
 *
 * Caching: handled server-side via `ai_call_cache` keyed on
 * (task='triage', prompt_version, model, sha256({criterion_id, sorted-docs})).
 * The TS wrapper is stateless; identical inputs produce identical outputs.
 */

import { aiFetch } from './penguinClient'
import {
  TriageResponseSchema,
  type TriageRequest,
  type TriageResponse,
  type RelevanceScore,
  type TriageCriterionMeta,
  type TriageDocMeta,
} from './schemas/documentTriage'

export type {
  TriageRequest,
  TriageResponse,
  RelevanceScore,
  TriageCriterionMeta,
  TriageDocMeta,
} from './schemas/documentTriage'

export class DocumentTriageError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'DocumentTriageError'
  }
}

/**
 * Maximum snippet length the prompt expects.  Callers SHOULD truncate to
 * this length before sending — anything longer wastes tokens.
 */
export const TRIAGE_SNIPPET_MAX_CHARS = 500

/**
 * Score every (criterion, document) pair for relevance.
 *
 * Returns the raw `TriageResponse`.  Callers typically group by
 * `criterion_id` and filter by `recommended_for_extraction` to build the
 * per-criterion evidence-extraction corpus.
 */
export async function scoreRelevance(request: TriageRequest): Promise<TriageResponse> {
  const raw = await aiFetch<unknown>('/triage-documents', request)
  return TriageResponseSchema.parse(raw)
}

/**
 * Convenience: convert a list of relevance scores into a
 * `criterion_id → recommended document_id[]` map.  Useful for filtering
 * a per-criterion corpus by the triage verdict.
 */
export function groupRecommendedByCriterion(
  scores: RelevanceScore[],
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const s of scores) {
    if (!s.recommended_for_extraction) continue
    const set = out.get(s.criterion_id) ?? new Set<string>()
    set.add(s.document_id)
    out.set(s.criterion_id, set)
  }
  return out
}

/**
 * Truncate a doc's plain-text body to the snippet length the triage prompt
 * expects.  Pure helper; pull a doc's text from
 * `CachedDocumentReference.text` and pipe through this.
 */
export function buildSnippet(rawText: string | null | undefined): string {
  if (!rawText) return ''
  return rawText.slice(0, TRIAGE_SNIPPET_MAX_CHARS)
}
