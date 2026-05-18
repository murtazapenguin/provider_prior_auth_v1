"""Task 2 — Per-criterion evidence extraction.

One LLM call per criterion.  Never batch criteria in a single call.

HARD RULES:
- No PHI / full-prompt logging at info/debug level.
- No direct openai / anthropic / boto3-Bedrock imports.  Penguin only via penguin_client.
- Citations must be verbatim substrings of the cited source.
- FaithfulnessDetector validates every citation; invalid ones are dropped and
  the verdict downgrades to 'needs_info'.
- Line-number-based bbox retrieval only.  Fuzzy text matching is forbidden.
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from pydantic import BaseModel, Field

from services.ai.cache import get_cached, hash_input, set_cached
from services.ai.prompts.evidence_extraction_v1 import (
    EVIDENCE_EXTRACTION_PROMPT_VERSION,
    EVIDENCE_EXTRACTION_SYSTEM_PROMPT,
    build_user_message,
    format_corpus,
)

logger = logging.getLogger(__name__)

# ─── LLM output schema ────────────────────────────────────────────────────────
# The LLM returns a CriterionEvaluation (single container model, never a list).
# After the LLM call we materialize bboxes and validate faithfulness before
# building the final API response.

class LlmCitation(BaseModel):
    """Citation as returned by the LLM (before bbox materialization)."""
    source_id: str = Field(description="Must match one of the source IDs provided in the corpus.")
    line_numbers: list[int] = Field(
        description="Line numbers (1-indexed, per-source) where the evidence appears."
    )
    supporting_texts: list[str] = Field(
        description="Verbatim text excerpts — exact character-for-character copies from the source."
    )


class CriterionEvaluation(BaseModel):
    """Container model for with_structured_output.  Single class — never List[...]."""
    status: Literal["passed", "failed", "needs_info"]
    reasoning: str = Field(description="1-2 sentences explaining the verdict.")
    confidence: float = Field(ge=0.0, le=1.0)
    citations: list[LlmCitation] = Field(default_factory=list)


# ─── Source lookup helper ─────────────────────────────────────────────────────

def _build_source_map(sources: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Index sources by id for O(1) lookup during citation validation."""
    return {s["id"]: s for s in sources}


# ─── FaithfulnessDetector integration ─────────────────────────────────────────

def _validate_supporting_texts(
    supporting_texts: list[str],
    source_text: str,
) -> tuple[list[str], bool]:
    """Return (valid_texts, had_invalid).

    Uses FaithfulnessDetector when available; falls back to substring check.
    Per AI_INTEGRATION.md, any supporting_text that is not a verbatim
    substring of the source is dropped.  Never paraphrase.
    """
    try:
        from penguin.output_guard.hallucination import FaithfulnessDetector, Citation  # noqa: PLC0415
        detector = FaithfulnessDetector()
        valid: list[str] = []
        had_invalid = False
        for text in supporting_texts:
            citation = Citation(claim=text, source=source_text)
            result = detector.check(citation)
            if result.is_faithful:
                valid.append(text)
            else:
                had_invalid = True
                logger.warning(
                    "Citation dropped by FaithfulnessDetector (text not found in source)"
                )
        return valid, had_invalid
    except ImportError:
        pass

    # Fallback: verbatim substring check (FaithfulnessDetector not installed).
    valid = []
    had_invalid = False
    for text in supporting_texts:
        if text and text in source_text:
            valid.append(text)
        else:
            had_invalid = True
            logger.warning(
                "Citation dropped — supporting_text is not a verbatim substring of the source"
            )
    return valid, had_invalid


# ─── Bbox materialization ─────────────────────────────────────────────────────

def _materialize_bboxes(
    line_numbers: list[int],
    source: dict[str, Any],
) -> list[dict[str, Any]]:
    """Build canonical bbox list for a citation.

    For sources that carry an OCRResult (kind='attachment' or 'policy_pdf' with
    OCR data), we call find_line_as_bbox per line_number.  Lines that don't exist
    in the OCRResult are silently dropped (find_line_as_bbox returns None).

    For plain text sources (clinical_note, or attachments without OCR), bboxes=[]
    but line_numbers are still recorded for in-app highlighting.

    NOTE: OCR source extension — a future ticket can add an optional 'ocr_result'
    key to Source (or a server-side OCR cache) so PDF attachments get real bboxes.
    For Phase 3 all sources are plain text, so this always returns [].
    """
    from services.ai.utils.bbox import strip_page_dimensions  # noqa: PLC0415

    ocr_result = source.get("ocr_result")  # Optional; not present in Phase 3.
    if ocr_result is None:
        return []

    bboxes: list[dict[str, Any]] = []
    document_name = source.get("document_name", source["id"])
    # OCRResult line numbers reset per page.  Use page_number=1 as default;
    # a richer implementation would pass page_number per line.
    for ln in line_numbers:
        try:
            bbox = ocr_result.find_line_as_bbox(
                line_number=ln,
                page_number=1,
                document_name=document_name,
            )
            if bbox:
                bboxes.append(strip_page_dimensions(bbox))
        except Exception:
            pass  # Line not found — silently skip.
    return bboxes


# ─── Core extraction function ─────────────────────────────────────────────────

async def extract_evidence_for_criterion(
    *,
    criterion_id: str,
    criterion_text: str,
    evidence_hint: str | None,
    required_codes: list[str],
    sources: list[dict[str, Any]],
    pa_id: str | None = None,
    provider_id: str | None = None,
    db_pool: Any | None = None,
) -> dict[str, Any]:
    """Evaluate one criterion against the clinical corpus.

    Args:
        criterion_id: Stable criterion identifier.
        criterion_text: The policy criterion being evaluated.
        evidence_hint: Optional tip from the policy ingestion step.
        required_codes: ICD-10 or procedure codes required by this criterion.
        sources: List of Source dicts —
            { id, kind, text, line_numbered_text? }
            Sources are sorted by id before hashing (cache key stability).
        pa_id: PA identifier for tracing.
        provider_id: Provider identifier for tracing.
        db_pool: asyncpg pool for cache read/write (None = skip cache).

    Returns:
        Dict matching ExtractEvidenceResponse schema.
    """
    import services.ai.penguin_client as _pc  # noqa: PLC0415
    from penguin.core import HumanMessage, SystemMessage  # noqa: PLC0415

    get_model = _pc.get_model
    get_tracer_session = _pc.get_tracer_session

    # ── Cache key ─────────────────────────────────────────────────────────────
    # Sort sources by id for stable hashing regardless of input order.
    sorted_sources = sorted(sources, key=lambda s: s["id"])
    cache_input = {
        "criterion": {
            "id": criterion_id,
            "text": criterion_text,
            "evidence_hint": evidence_hint,
            "required_codes": sorted(required_codes),
        },
        "corpus": [
            {"id": s["id"], "kind": s.get("kind", "clinical_note"), "text": s.get("text", "")}
            for s in sorted_sources
        ],
    }
    input_hash = hash_input(cache_input)

    model_cfg = get_model("extraction")
    # Extract model name string from whatever object get_model returns.
    model_name = getattr(model_cfg, "model_name", "claude-sonnet-4-5")

    # ── Cache read ────────────────────────────────────────────────────────────
    if db_pool is not None:
        cached = await get_cached(
            db_pool,
            task="evidence_extraction",
            prompt_version=EVIDENCE_EXTRACTION_PROMPT_VERSION,
            model=model_name,
            input_hash=input_hash,
        )
        if cached is not None:
            cached["cached"] = True
            return cached

    # ── Build corpus string ────────────────────────────────────────────────────
    corpus_str = format_corpus(sorted_sources)
    user_msg = build_user_message(
        criterion_id=criterion_id,
        criterion_text=criterion_text,
        evidence_hint=evidence_hint,
        required_codes=required_codes,
        corpus_with_source_ids=corpus_str,
    )

    # ── LLM call (one call per criterion) ────────────────────────────────────
    source_map = _build_source_map(sources)
    trace_id: str | None = None

    tracer_ctx = get_tracer_session(pa_id or "anon", provider_id or "system") if pa_id else None

    structured_model = get_model("extraction").with_structured_output(CriterionEvaluation)

    messages = [
        SystemMessage(content=EVIDENCE_EXTRACTION_SYSTEM_PROMPT),
        HumanMessage(content=user_msg),
    ]

    llm_result: CriterionEvaluation
    if tracer_ctx is not None:
        async with tracer_ctx as session:
            trace_id = getattr(session, "trace_id", None)
            llm_result = await structured_model.ainvoke(messages)
    else:
        llm_result = await structured_model.ainvoke(messages)

    # ── Post-processing: faithfulness + bbox materialization ──────────────────
    final_citations: list[dict[str, Any]] = []
    any_dropped = False

    for llm_cite in llm_result.citations:
        src = source_map.get(llm_cite.source_id)
        if src is None:
            # LLM invented a source_id — drop the citation.
            logger.warning(
                "Citation references unknown source_id=%s — dropped",
                llm_cite.source_id,
            )
            any_dropped = True
            continue

        # Validate that supporting_texts are verbatim substrings.
        valid_texts, had_invalid = _validate_supporting_texts(
            llm_cite.supporting_texts,
            src.get("text", ""),
        )
        if had_invalid:
            any_dropped = True
        if not valid_texts:
            # All texts for this citation were invalid — drop the citation.
            continue

        # Materialize bboxes from line numbers.
        bboxes = _materialize_bboxes(llm_cite.line_numbers, src)

        final_citations.append({
            "source_type": src.get("kind", "clinical_note"),
            "source_id": llm_cite.source_id,
            "supporting_texts": valid_texts,
            "reasoning": llm_result.reasoning,
            "confidence": llm_result.confidence,
            "bboxes": bboxes,
            "line_numbers": llm_cite.line_numbers,
        })

    # ── citation_validation field ─────────────────────────────────────────────
    # Priority: some_invalid > none_returned > all_valid.
    # If any citations were dropped (invalid or unknown source), report some_invalid
    # regardless of how many valid citations remain.
    # none_returned is reserved for the case where the LLM returned zero citations
    # AND nothing was dropped (i.e. the LLM genuinely produced nothing).
    if any_dropped:
        citation_validation = "some_invalid"
    elif not final_citations:
        citation_validation = "none_returned"
    else:
        citation_validation = "all_valid"

    # ── Downgrade to needs_info if citations were dropped ────────────────────
    status = llm_result.status
    if any_dropped and status in ("passed", "failed"):
        logger.info(
            "criterion=%s status downgraded to needs_info due to invalid citations",
            criterion_id,
        )
        status = "needs_info"

    response = {
        "criterion_id": criterion_id,
        "status": status,
        "rationale": llm_result.reasoning,  # TS schema field name is 'rationale'
        "reasoning": llm_result.reasoning,  # canonical contract field name
        "confidence": llm_result.confidence,
        "citations": final_citations,
        "model": model_name,
        "prompt_version": EVIDENCE_EXTRACTION_PROMPT_VERSION,
        "cached": False,
        "trace_id": trace_id,
        "citation_validation": citation_validation,
    }

    # ── Cache write ───────────────────────────────────────────────────────────
    if db_pool is not None:
        await set_cached(
            db_pool,
            task="evidence_extraction",
            prompt_version=EVIDENCE_EXTRACTION_PROMPT_VERSION,
            model=model_name,
            input_hash=input_hash,
            response=response,
            traced_to=trace_id,
        )

    return response
