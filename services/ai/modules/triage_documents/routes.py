"""Document-triage route — delegates to services.ai.document_triage."""

from fastapi import APIRouter, Depends, Request

from services.ai.common.deps import require_token
from services.ai.document_triage import (
    TriageRequest,
    TriageResponse,
    score_relevance,
)

router = APIRouter(tags=['triage-documents'])


@router.post(
    '/triage-documents',
    response_model=TriageResponse,
    dependencies=[Depends(require_token)],
)
async def triage_documents_route(
    request: Request, body: TriageRequest
) -> TriageResponse:
    """Score each (criterion, document) pair for relevance.

    One Haiku call per criterion (NOT per criterion x document pair).
    Cache via ai_call_cache keyed on (task='triage', prompt_version, model,
    sha256({criterion_id, sorted-docs-by-fhir_id})).

    Reads the DB pool from app.state (set up in main.py lifespan).
    Pool may be None in test/dev environments with no DB configured.
    """
    db_pool = getattr(request.app.state, 'db_pool', None)
    return await score_relevance(body, db_pool)
