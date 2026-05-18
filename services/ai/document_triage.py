"""Task — Document triage (Phase 6).

Given a set of policy criteria and a list of CachedDocumentReference
metadata (id, fhir_id, doc_type, authored_at, author_role, snippet),
score each (criterion, document) pair for relevance using a CHEAP Haiku
call.  Downstream evidence extraction (Sonnet, expensive) only runs on
the top-K documents per criterion above a relevance threshold.

Why this matters: cost control.  At 200 docs × 6 criteria, full-text
extraction with Sonnet is ~$30/PA.  Triaging with Haiku snippets is ~$0.50
and keeps Sonnet focused on the documents that actually matter.

HARD RULES (CLAUDE.md / role brief):
- No PHI / full-prompt content logged at info/debug.
- Penguin SDK only via penguin_client.get_model.  No direct anthropic /
  openai / boto3-Bedrock imports.
- with_structured_output() takes a SINGLE Pydantic class — RelevanceScores
  wraps the list per SDK constraint.
- Exactly ONE Haiku call per criterion (across all docs), not per (criterion,
  document) pair.  Per the ticket's cost arithmetic, this is the difference
  between $30 and $0.50 for a 200-doc / 6-criterion PA.
- Cache aggressively: ai_call_cache keyed on (task='triage', prompt_version,
  model, sha256(canonical_input)).  Demos must not re-burn LLM time.
- Inclusion bias: when the snippet is too sparse to score confidently, or
  the LLM call errors / returns a malformed structure for that criterion,
  default to recommended_for_extraction=true.  Recall ≥ 0.95 is the
  binding eval constraint (TESTING.md "AI quality" → document_triage_eval).

Canonical input for the cache key:
    {
      criterion_id: str,
      documents: List[
          { id, fhir_id, doc_type, authored_at, author_role, snippet }
      ] sorted ascending by fhir_resource_id
    }

The sort is essential — without it, two callers that pass the same
documents in different orders would each miss the cache.

Snippet truncation is a CALLER responsibility (TS-side matchEngine hook
truncates `CachedDocumentReference.text` to ~500 chars before posting).
This handler accepts whatever is sent and does not re-truncate.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

import asyncpg
from pydantic import BaseModel, Field

from services.ai.cache import get_cached, hash_input, set_cached
from services.ai.prompts.document_triage_v1 import (
    DOCUMENT_TRIAGE_PROMPT_VERSION,
    DOCUMENT_TRIAGE_SYSTEM_PROMPT,
    build_user_message,
)

logger = logging.getLogger(__name__)


# ─── Tunables ─────────────────────────────────────────────────────────────────

DEFAULT_TOP_K: int = 5
DEFAULT_THRESHOLD: float = 0.4

# A snippet shorter than this (after stripping) is treated as too sparse to
# score confidently — inclusion-bias kicks in regardless of the LLM verdict.
SPARSE_SNIPPET_THRESHOLD: int = 30

# Cache key task name.  IMPORTANT: this string is part of the cache key
# alongside (prompt_version, model, inputHash) — do not rename without
# planning a cache migration.  Per orchestrator override §4 the value is
# "triage" (NOT "document_triage").
CACHE_TASK_NAME: str = "triage"


# ─── Pydantic request / response contracts ────────────────────────────────────


class CriterionMeta(BaseModel):
    """One criterion to triage documents against."""

    id: str
    text: str
    evidence_hint: Optional[str] = None
    required_codes: list[str] = Field(default_factory=list)


class DocMeta(BaseModel):
    """One document's metadata + snippet.

    `id`: the CachedDocumentReference.id (cuid) used by the match engine
          when filtering the per-criterion corpus.
    `fhir_id`: FHIR DocumentReference.id (stable per resource).  Used as
               the canonical sort key for cache stability.
    `snippet`: first ~500 chars of OCR text.  Truncation is the caller's
               responsibility — we don't re-truncate.
    """

    id: str
    fhir_id: str
    doc_type: str = ""
    authored_at: str = ""
    author_role: str = ""
    snippet: str = ""


class TriageRequest(BaseModel):
    """One PA's worth of criteria + documents to triage."""

    criteria: list[CriterionMeta]
    documents: list[DocMeta]
    pa_id: Optional[str] = None
    provider_id: Optional[str] = None
    top_k: int = DEFAULT_TOP_K
    threshold: float = DEFAULT_THRESHOLD


class RelevanceScore(BaseModel):
    """One (criterion, document) pair's relevance score."""

    criterion_id: str
    document_id: str
    score: float = Field(ge=0.0, le=1.0)
    reasoning: str = ""
    recommended_for_extraction: bool = False


class RelevanceScores(BaseModel):
    """Container model for with_structured_output (single Pydantic class).

    Wraps the per-criterion list of scores so the SDK's structured-output
    contract is satisfied — `with_structured_output()` does not accept
    `List[...]` directly.
    """

    scores: list[RelevanceScore]


class TriageResponse(BaseModel):
    """Aggregated triage scores across all (criterion, document) pairs."""

    scores: list[RelevanceScore]
    prompt_version: str
    model: str
    trace_id: Optional[str] = None
    cached: bool = False


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _canonical_doc_list(documents: list[DocMeta]) -> list[dict[str, Any]]:
    """Sort docs by fhir_id ascending for stable cache keys + LLM input order."""
    return sorted(
        ({
            "id": d.id,
            "fhir_id": d.fhir_id,
            "doc_type": d.doc_type,
            "authored_at": d.authored_at,
            "author_role": d.author_role,
            "snippet": d.snippet,
        } for d in documents),
        key=lambda d: d["fhir_id"],
    )


def _is_sparse(snippet: str) -> bool:
    """Snippet too short / empty to score confidently → inclusion-bias on."""
    return len((snippet or "").strip()) < SPARSE_SNIPPET_THRESHOLD


def _apply_topk_and_threshold(
    raw: list[RelevanceScore], *, top_k: int, threshold: float,
    doc_meta_by_id: dict[str, DocMeta],
) -> list[RelevanceScore]:
    """Decide `recommended_for_extraction` from `(score >= threshold) AND (rank <= K)`.

    Inclusion-bias overrides (preserve `recommended_for_extraction=true`):
      1. Sparse snippet (caller didn't capture much text) → True regardless.
      2. Upstream already set True — e.g. the LLM-failure fallback or the
         LLM-skipped-doc fallback in `_score_one_criterion`.  These cases
         represent "we don't know; include rather than risk evidence loss"
         and must not be downgraded by top-K trimming.

    The score itself is left as the model returned it (calibrated by the
    eval suite later).
    """
    # Stable sort descending by score so ties resolve by input order.
    ranked = sorted(raw, key=lambda r: r.score, reverse=True)
    out: list[RelevanceScore] = []
    for rank, r in enumerate(ranked, start=1):
        doc = doc_meta_by_id.get(r.document_id)
        sparse = doc is not None and _is_sparse(doc.snippet)
        upstream_forced_include = r.recommended_for_extraction is True
        recommended = (
            (r.score >= threshold and rank <= top_k)
            or sparse
            or upstream_forced_include
        )
        out.append(
            RelevanceScore(
                criterion_id=r.criterion_id,
                document_id=r.document_id,
                score=r.score,
                reasoning=r.reasoning,
                recommended_for_extraction=recommended,
            )
        )
    return out


def _inclusion_bias_fallback(
    *, criterion_id: str, docs: list[DocMeta]
) -> list[RelevanceScore]:
    """When the LLM call fails entirely for one criterion, include every doc.

    Per override §9: false negatives lose evidence; false positives just
    cost a bit more.  We default each (criterion, doc) pair to score=0.5
    with `recommended_for_extraction=true` so downstream extraction runs.
    """
    return [
        RelevanceScore(
            criterion_id=criterion_id,
            document_id=d.id,
            score=0.5,
            reasoning="Triage fallback: LLM call failed or returned malformed output; including by default.",
            recommended_for_extraction=True,
        )
        for d in docs
    ]


# ─── Per-criterion LLM call ───────────────────────────────────────────────────


async def _score_one_criterion(
    *,
    criterion: CriterionMeta,
    documents: list[DocMeta],
    model_name: str,
    db_pool: Optional[asyncpg.Pool],
) -> tuple[list[RelevanceScore], bool]:
    """One Haiku call for ONE criterion across ALL documents.

    Returns: (scores, cached_flag).

    Cache: (task='triage', prompt_version=DOCUMENT_TRIAGE_PROMPT_VERSION,
    model=model_name, input_hash=sha256({criterion_id, sorted-docs})).
    """
    # ── Canonicalize ─────────────────────────────────────────────────────────
    canonical_docs = _canonical_doc_list(documents)
    cache_input = {
        "criterion_id": criterion.id,
        "documents": canonical_docs,
    }
    input_hash = hash_input(cache_input)

    # ── Cache read ───────────────────────────────────────────────────────────
    if db_pool is not None:
        cached = await get_cached(
            db_pool,
            task=CACHE_TASK_NAME,
            prompt_version=DOCUMENT_TRIAGE_PROMPT_VERSION,
            model=model_name,
            input_hash=input_hash,
        )
        if cached is not None:
            try:
                scores = [RelevanceScore(**s) for s in cached.get("scores", [])]
                return scores, True
            except Exception:
                # Corrupt cache row — fall through to LLM call.
                logger.warning(
                    "triage cache for criterion=%s had malformed scores; refetching",
                    criterion.id,
                )

    # ── LLM call ─────────────────────────────────────────────────────────────
    import services.ai.penguin_client as _pc  # noqa: PLC0415
    from penguin.core import HumanMessage, SystemMessage  # noqa: PLC0415

    user_msg = build_user_message(
        criterion_id=criterion.id,
        criterion_text=criterion.text,
        evidence_hint=criterion.evidence_hint,
        required_codes=criterion.required_codes,
        documents=canonical_docs,
    )

    messages = [
        SystemMessage(content=DOCUMENT_TRIAGE_SYSTEM_PROMPT),
        HumanMessage(content=user_msg),
    ]

    structured_model = _pc.get_model("triage").with_structured_output(RelevanceScores)

    try:
        llm_result: RelevanceScores = await structured_model.ainvoke(messages)
    except Exception:
        # Inclusion-bias fallback: include every document for this criterion.
        logger.exception(
            "triage LLM call failed for criterion=%s; including all docs by default",
            criterion.id,
        )
        return _inclusion_bias_fallback(criterion_id=criterion.id, docs=documents), False

    # ── Coerce LLM output to our shape ───────────────────────────────────────
    # The LLM is asked to return one entry per input document.  If it skipped
    # any doc, fill in with the inclusion-bias default.
    #
    # We deliberately ZERO OUT the LLM's `recommended_for_extraction` here —
    # `_apply_topk_and_threshold` (above) is the canonical place that decides
    # which docs get into the extraction step.  The LLM is welcome to suggest,
    # but top-K + threshold are policy.  This keeps `recommended_for_extraction
    # is True` as a clean sticky-override signal coming ONLY from the fallback
    # paths (LLM call failed, LLM skipped a doc).
    by_doc: dict[str, RelevanceScore] = {}
    for s in llm_result.scores:
        # Enforce criterion_id (LLM may emit a different one) so downstream
        # grouping is correct.
        by_doc[s.document_id] = RelevanceScore(
            criterion_id=criterion.id,
            document_id=s.document_id,
            score=max(0.0, min(1.0, s.score)),  # clamp defensively
            reasoning=s.reasoning,
            recommended_for_extraction=False,
        )

    out: list[RelevanceScore] = []
    for d in documents:
        if d.id in by_doc:
            out.append(by_doc[d.id])
        else:
            # LLM forgot this document — include by default.
            out.append(
                RelevanceScore(
                    criterion_id=criterion.id,
                    document_id=d.id,
                    score=0.5,
                    reasoning="Triage fallback: LLM did not score this document; including by default.",
                    recommended_for_extraction=True,
                )
            )

    # ── Cache write ──────────────────────────────────────────────────────────
    if db_pool is not None:
        response_payload = {"scores": [s.model_dump() for s in out]}
        await set_cached(
            db_pool,
            task=CACHE_TASK_NAME,
            prompt_version=DOCUMENT_TRIAGE_PROMPT_VERSION,
            model=model_name,
            input_hash=input_hash,
            response=response_payload,
            traced_to=None,
        )

    return out, False


# ─── Public entry point ───────────────────────────────────────────────────────


async def score_relevance(
    request: TriageRequest,
    db_pool: Optional[asyncpg.Pool] = None,
) -> TriageResponse:
    """Score every (criterion, document) pair for relevance.

    Algorithm:
      1. If `documents` is empty: return empty scores, NO LLM call.
      2. For each criterion (in order), call ONE Haiku-backed LLM session.
         The same docs are reused across all criteria so the canonical
         sort runs once per criterion (one cache key per criterion).
      3. Per-criterion scores go through `_apply_topk_and_threshold` to set
         `recommended_for_extraction`.
      4. Aggregate and return.

    Tracing: wrap the whole PA-driven triage in `PenguinTracer.session(...)`
    when `pa_id` is provided.  No-op when Langfuse env vars are missing.

    Empty-docs short-circuit: an empty `documents` list is a valid input
    (PA has no chart documents yet).  We skip the LLM altogether.  An
    empty `criteria` list is also valid — return empty.
    """
    if not request.documents or not request.criteria:
        # No-op: empty scores, no model call, but we still need to report a
        # model name for downstream telemetry.
        import services.ai.penguin_client as _pc  # noqa: PLC0415

        model_cfg = _pc.get_model("triage")
        model_name = getattr(model_cfg, "model_name", "claude-haiku-4-5")
        return TriageResponse(
            scores=[],
            prompt_version=DOCUMENT_TRIAGE_PROMPT_VERSION,
            model=model_name,
            trace_id=None,
            cached=False,
        )

    import services.ai.penguin_client as _pc  # noqa: PLC0415

    model_cfg = _pc.get_model("triage")
    model_name = getattr(model_cfg, "model_name", "claude-haiku-4-5")

    tracer_ctx = (
        _pc.get_tracer_session(request.pa_id, request.provider_id or "system")
        if request.pa_id
        else None
    )

    doc_meta_by_id = {d.id: d for d in request.documents}

    async def _run() -> tuple[list[RelevanceScore], bool]:
        all_scores: list[RelevanceScore] = []
        any_uncached = False
        for criterion in request.criteria:
            raw, cached_flag = await _score_one_criterion(
                criterion=criterion,
                documents=request.documents,
                model_name=model_name,
                db_pool=db_pool,
            )
            if not cached_flag:
                any_uncached = True
            ranked = _apply_topk_and_threshold(
                raw,
                top_k=request.top_k,
                threshold=request.threshold,
                doc_meta_by_id=doc_meta_by_id,
            )
            all_scores.extend(ranked)
        return all_scores, any_uncached

    trace_id: Optional[str] = None

    if tracer_ctx is not None:
        if hasattr(tracer_ctx, "__aenter__"):
            async with tracer_ctx as session:
                trace_id = getattr(session, "trace_id", None) if session is not None else None
                all_scores, any_uncached = await _run()
        else:
            with tracer_ctx as session:
                trace_id = getattr(session, "trace_id", None) if session is not None else None
                all_scores, any_uncached = await _run()
    else:
        all_scores, any_uncached = await _run()

    return TriageResponse(
        scores=all_scores,
        prompt_version=DOCUMENT_TRIAGE_PROMPT_VERSION,
        model=model_name,
        trace_id=trace_id,
        # `cached` is True only when EVERY criterion served from cache.  This
        # mirrors the convention in evidence_extraction / policy_ingestion.
        cached=not any_uncached,
    )


__all__ = [
    "CriterionMeta",
    "DocMeta",
    "TriageRequest",
    "TriageResponse",
    "RelevanceScore",
    "RelevanceScores",
    "score_relevance",
    "DEFAULT_TOP_K",
    "DEFAULT_THRESHOLD",
    "SPARSE_SNIPPET_THRESHOLD",
    "CACHE_TASK_NAME",
]
