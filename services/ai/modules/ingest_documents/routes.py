"""Document-intake route — delegates to services.ai.document_intake."""

from fastapi import APIRouter, Depends, Request

from services.ai.common.deps import require_token
from services.ai.document_intake import (
    IngestDocumentsRequest,
    IngestDocumentsResponse,
    ingest_documents,
)

router = APIRouter(tags=['ingest-documents'])


@router.post(
    '/ingest-documents',
    response_model=IngestDocumentsResponse,
    dependencies=[Depends(require_token)],
)
async def ingest_documents_route(
    request: Request, body: IngestDocumentsRequest
) -> IngestDocumentsResponse:
    """Ingest one PA's FHIR DocumentReferences.

    Each document is normalized to PDF, OCR'd, page-rendered, and persisted as a
    CachedDocumentReference row.  Idempotent on (paId, fhirResourceId,
    fhirVersionId) — re-ingest skips Textract via the OCR ai_call_cache.

    Reads the DB pool from app.state (set up in main.py lifespan).
    Pool may be None in test/dev environments with no DB configured.
    """
    db_pool = getattr(request.app.state, 'db_pool', None)
    return await ingest_documents(body, db_pool)
