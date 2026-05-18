"""Task — UHC policy PDF ingestion via OCR + structured LLM extraction.

Reads a PDF policy document, runs AWS Textract OCR, and extracts all
discrete PA criteria with source line numbers and bounding boxes.

HARD RULES:
- No PHI / full-prompt logging at info/debug level.
- No direct openai / anthropic / boto3-Bedrock imports.  Penguin only via penguin_client.
- Line-number-based bbox retrieval only.  Fuzzy text matching is forbidden.
- All OCR goes through penguin.ocr.providers.aws.AWSTextractProvider.
"""

from __future__ import annotations

import logging
from typing import Any, Literal, Optional

from pydantic import BaseModel

from services.ai.cache import get_cached, hash_input, set_cached
from services.ai.prompts.policy_ingestion_v1 import (
    POLICY_INGESTION_PROMPT_VERSION,
    POLICY_INGESTION_SYSTEM_PROMPT,
    build_user_message,
)

logger = logging.getLogger(__name__)


# ─── LLM output schema ────────────────────────────────────────────────────────
# Single container model — with_structured_output accepts one Pydantic class only.

class IngestedCriterion(BaseModel):
    """A single PA criterion extracted from the policy document."""
    ordinal: int
    text: str
    evidence_hint: Optional[str] = None
    upload_hint: Optional[str] = None
    group: Optional[str] = None
    group_operator: Optional[Literal["ALL", "ANY"]] = None
    source_line_numbers: list[int] = []


class ApplicableCode(BaseModel):
    """A procedure / drug / diagnosis code that the policy covers.

    Added in policy_ingestion_v2 (Phase 7). Without this, AI-ingested policies
    have no PolicyCode rows and the code-based lookup in
    `lib/policies/lookup.ts` cannot reach them.
    """
    code_type: Literal["CPT", "HCPCS", "ICD10"]
    code: str
    modifier: Optional[str] = None
    pos_codes: list[str] = []


class IngestionResult(BaseModel):
    """Container model for with_structured_output.  Never List[...] at top level."""
    criteria: list[IngestedCriterion]
    applicable_codes: list[ApplicableCode] = []


# ─── Bbox materialization ─────────────────────────────────────────────────────

def _materialize_criterion_bboxes(
    source_line_numbers: list[int],
    ocr_result: Any,
    policy_id: str,
) -> list[dict[str, Any]]:
    """Build bbox list for a criterion from its source line numbers.

    Calls find_line_as_bbox per line number using the OCR result.
    Lines that are not found in the OCR result are silently dropped.

    For multi-page documents, line numbers reset per page in Textract output.
    We iterate over ocr_result.lines to find the correct page_number for each
    line rather than hardcoding page 1, giving accurate bbox placement across
    all pages of a UHC policy PDF.
    """
    from services.ai.utils.bbox import strip_page_dimensions  # noqa: PLC0415

    if not source_line_numbers or ocr_result is None:
        return []

    # Build a map from line_number → page_number using the OCR lines so that
    # bboxes are correct on multi-page PDFs (line numbers reset per page).
    line_to_page: dict[int, int] = {}
    try:
        for ocr_line in ocr_result.lines:
            ln = getattr(ocr_line, "line_number", None)
            pg = getattr(ocr_line, "page_number", 1)
            if ln is not None and ln not in line_to_page:
                line_to_page[ln] = pg
    except Exception:
        pass  # OCRResult has no iterable .lines — fall back to page 1 for all.

    bboxes: list[dict[str, Any]] = []
    for ln in source_line_numbers:
        page_number = line_to_page.get(ln, 1)
        try:
            bbox = ocr_result.find_line_as_bbox(
                line_number=ln,
                page_number=page_number,
                document_name=policy_id,
            )
            if bbox:
                bboxes.append(strip_page_dimensions(bbox))
        except Exception:
            pass  # Line not found — silently skip.
    return bboxes


# ─── Core ingestion function ──────────────────────────────────────────────────

async def ingest_policy(
    pdf_path: str,
    policy_id: str,
    db_pool: Any | None = None,
) -> dict[str, Any]:
    """Ingest a PDF policy document and extract all PA criteria.

    Args:
        pdf_path: Absolute path to the PDF file on disk.
        policy_id: Stable identifier for the policy (used as cache key and
                   document_name in bbox results).
        db_pool: asyncpg pool for cache read/write (None = skip cache).

    Returns:
        Dict with keys: policy_id, criteria (list of dicts with source_bboxes),
        model, prompt_version, cached.

    Raises:
        Re-raises any OCR or LLM exception after logging. Retry logic lives
        in the CLI script or the calling route.
    """
    import services.ai.penguin_client as _pc  # noqa: PLC0415
    from penguin.core import HumanMessage, SystemMessage  # noqa: PLC0415

    from services.ai.ocr import get_ocr_result  # noqa: PLC0415

    get_model = _pc.get_model

    # ── Cache key ─────────────────────────────────────────────────────────────
    input_hash = hash_input({"pdf_path": pdf_path, "policy_id": policy_id})

    model_cfg = get_model("ingestion")
    model_name = getattr(model_cfg, "model_name", "claude-sonnet-4-5")

    # ── Cache read ────────────────────────────────────────────────────────────
    if db_pool is not None:
        cached = await get_cached(
            db_pool,
            task="policy_ingestion",
            prompt_version=POLICY_INGESTION_PROMPT_VERSION,
            model=model_name,
            input_hash=input_hash,
        )
        if cached is not None:
            cached["cached"] = True
            return cached

    # ── OCR ───────────────────────────────────────────────────────────────────
    # Delegated to services/ai/ocr.py so the upload pipeline + /ocr-document
    # route share the same provider construction.  Returns the raw OCRResult
    # because we still need find_line_as_bbox below.
    ocr_result = await get_ocr_result(pdf_path)

    # Build the full text in "{content} || {line_number}" format.
    full_text = "\n".join(
        f"{line.content} || {line.line_number}"
        for line in ocr_result.lines
    )

    # ── LLM call — structured output ─────────────────────────────────────────
    user_msg = build_user_message(full_text=full_text)
    messages = [
        SystemMessage(content=POLICY_INGESTION_SYSTEM_PROMPT),
        HumanMessage(content=user_msg),
    ]

    structured_model = get_model("ingestion").with_structured_output(IngestionResult)

    try:
        llm_result: IngestionResult = await structured_model.ainvoke(messages)
    except Exception:
        logger.exception("LLM extraction failed for policy_id=%s", policy_id)
        raise

    # ── Bbox materialization per criterion ────────────────────────────────────
    criteria_out: list[dict[str, Any]] = []
    for criterion in llm_result.criteria:
        source_bboxes = _materialize_criterion_bboxes(
            source_line_numbers=criterion.source_line_numbers,
            ocr_result=ocr_result,
            policy_id=policy_id,
        )
        criteria_out.append({
            **criterion.model_dump(),
            "source_bboxes": source_bboxes,
        })

    # ── Applicable codes (Phase 7, policy_ingestion_v2) ───────────────────────
    applicable_codes_out: list[dict[str, Any]] = [
        code.model_dump() for code in llm_result.applicable_codes
    ]

    # ── Build response ────────────────────────────────────────────────────────
    response: dict[str, Any] = {
        "policy_id": policy_id,
        "criteria": criteria_out,
        "applicable_codes": applicable_codes_out,
        "model": model_name,
        "prompt_version": POLICY_INGESTION_PROMPT_VERSION,
        "cached": False,
    }

    # ── Cache write ───────────────────────────────────────────────────────────
    if db_pool is not None:
        await set_cached(
            db_pool,
            task="policy_ingestion",
            prompt_version=POLICY_INGESTION_PROMPT_VERSION,
            model=model_name,
            input_hash=input_hash,
            response=response,
            traced_to=None,
        )

    return response
