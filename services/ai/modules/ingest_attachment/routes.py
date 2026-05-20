"""Attachment ingest route — delegates to services.ai.attachment_intake."""

from fastapi import APIRouter, Depends, Request

from services.ai.attachment_intake import (
    IngestAttachmentRequest,
    IngestAttachmentResponse,
    ingest_attachment,
)
from services.ai.common.deps import require_token

router = APIRouter(tags=['ingest-attachment'])


@router.post(
    '/ingest-attachment',
    response_model=IngestAttachmentResponse,
    dependencies=[Depends(require_token)],
)
async def ingest_attachment_route(
    request: Request,
    body: IngestAttachmentRequest,
) -> IngestAttachmentResponse:
    """Ingest one S3-uploaded attachment.

    The client uploaded the PDF directly to S3 via a presigned PUT URL; this
    route fetches the file, OCRs it via Textract, renders page images, uploads
    the PNGs back to S3, and returns the pdfviewer-data shape for the Next.js
    caller to persist on the Attachment row.

    Idempotent on (attachment_id, content_sha256) — re-ingest skips Textract
    via the OCR ai_call_cache layer.

    Reads the asyncpg pool from app.state (lifespan-managed in main.py).
    """
    db_pool = getattr(request.app.state, 'db_pool', None)
    return await ingest_attachment(body, db_pool)
