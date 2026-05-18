"""Extract-evidence-criterion route — Task 2 (Phase 3).

One LLM call per criterion.  Callers (matchEngine) run criteria in parallel;
this route never batches.

HARD RULE: No PHI / full-prompt content in info/debug logs.
"""

from fastapi import APIRouter, Depends, Request

from services.ai.common.deps import require_token
from services.ai.common.schemas import (
    EvidenceCitation,
    ExtractEvidenceRequest,
    ExtractEvidenceResponse,
)
from services.ai.evidence_extraction import extract_evidence_for_criterion

router = APIRouter(tags=["extract-evidence"])


@router.post(
    "/extract-evidence-criterion",
    response_model=ExtractEvidenceResponse,
    dependencies=[Depends(require_token)],
)
async def extract_evidence_criterion(
    body: ExtractEvidenceRequest,
    request: Request,
) -> ExtractEvidenceResponse:
    """Evaluate a single policy criterion against the clinical corpus.

    Accepts ONE criterion per call — never batch criteria here.
    The Next.js match engine calls this in parallel (p-limit(12)).
    """
    db_pool = getattr(request.app.state, "db_pool", None)

    sources = [
        {
            "id": src.id,
            "kind": src.kind,
            "text": src.text,
            "line_numbered_text": src.line_numbered_text,
        }
        for src in body.corpus
    ]

    result = await extract_evidence_for_criterion(
        criterion_id=body.criterion.id,
        criterion_text=body.criterion.text,
        evidence_hint=body.criterion.evidence_hint,
        required_codes=body.criterion.required_codes,
        sources=sources,
        pa_id=body.pa_id,
        provider_id=body.provider_id,
        db_pool=db_pool,
    )

    # Convert raw citation dicts to Pydantic EvidenceCitation objects.
    citations = [
        EvidenceCitation(
            source_type=c.get("source_type", "clinical_note"),
            source_id=c.get("source_id", ""),
            supporting_texts=c["supporting_texts"],
            reasoning=c.get("reasoning"),
            confidence=c.get("confidence", result["confidence"]),
            bboxes=c.get("bboxes", []),
            line_numbers=c.get("line_numbers", []),
        )
        for c in result["citations"]
    ]

    return ExtractEvidenceResponse(
        criterion_id=result["criterion_id"],
        status=result["status"],
        rationale=result.get("rationale"),
        reasoning=result.get("reasoning"),
        confidence=result["confidence"],
        citations=citations,
        model=result["model"],
        prompt_version=result["prompt_version"],
        cached=result.get("cached", False),
        trace_id=result.get("trace_id"),
        citation_validation=result.get("citation_validation", "none_returned"),
    )
