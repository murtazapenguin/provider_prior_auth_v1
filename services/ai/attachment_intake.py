"""Task — S3-uploaded attachment ingest pipeline.

Mirrors `document_intake.py` (FHIR DocumentReference flow) but for tester /
provider uploads landed directly in S3 via a presigned PUT.  Given the S3 key
of an uploaded file, normalize to PDF if needed, OCR with AWS Textract, render
page images, upload them back to S3 under a stable layout, and return the
pdfviewer-data shape for the Next.js upload route to persist on the
`Attachment` row.

HARD RULES (CLAUDE.md / role brief):
- OCR via penguin.ocr.providers.aws.AWSTextractProvider (delegated through
  services.ai.ocr — no direct provider calls).
- PDF page rasterization via PyMuPDF (`fitz`) only.
- Non-PDF normalization via the same libreoffice helper as document_intake
  (`services.ai.utils.document_normalize.normalize_to_pdf`).
- `boto3` for S3 is fine (CLAUDE.md "Forbidden libraries" only forbids
  boto3-for-Bedrock).  Used here for download / put_object / presign.
- Per-OCR ai_call_cache key includes (attachment_id, content_sha256) so
  re-OCRing the same content is a free hit.

Persistence boundary: this module does NOT write to the `Attachment` row.
The Next.js upload route owns that — the sidecar returns the payload and
the route persists it (mirrors the legacy upload flow contract).

Storage layout (S3):
    attachments/<paId>/<attachmentId>/<filename>.pdf   ← original upload
    attachments/<paId>/<attachmentId>/page_N.png        ← rendered pages

All URLs in the response are S3 presigned GET URLs with a 7-day expiry; the
Next.js side may refresh them via a separate code path before they lapse.
"""

from __future__ import annotations

import hashlib
import logging
import tempfile
from pathlib import Path
from typing import Any

import asyncpg
from pydantic import BaseModel, Field

from services.ai.cache import get_cached, hash_input, set_cached
from services.ai.config import get_settings
from services.ai.utils.document_normalize import normalize_to_pdf

logger = logging.getLogger(__name__)


# ─── Pydantic request / response contracts ────────────────────────────────────

class IngestAttachmentRequest(BaseModel):
    """One uploaded attachment to ingest from S3."""

    pa_id: str = Field(description="PriorAuth.id this upload belongs to.")
    attachment_id: str = Field(
        description="Attachment.id — used for canonical bbox `document_name` and S3 layout.",
    )
    s3_key: str = Field(
        description="S3 object key where the client uploaded the file (in the attachments bucket).",
    )
    filename: str = Field(description="Original filename for display.")
    mime_type: str = Field(
        default="application/pdf",
        description="MIME type — non-PDFs go through libreoffice.",
    )


class IngestAttachmentResponse(BaseModel):
    """The payload the Next.js upload route writes to the Attachment row."""

    pdf_url: str = Field(description="Presigned GET URL for the canonical PDF (7-day expiry).")
    page_images: dict[str, Any] = Field(
        description="pdfviewer-data shape: {files: [doc_basename], presigned_urls: {doc_basename: {pageNum: url}}}.",
    )
    ocr_line_count: int
    extracted_text: str = Field(description="OCR plain text (no '|| N' line-number suffixes).")
    cached: bool = Field(
        default=False,
        description="True when the OCR result came from ai_call_cache (re-OCR skipped).",
    )


# ─── S3 helpers (boto3 — direct use is allowed) ───────────────────────────────

S3_PRESIGN_EXPIRY_SEC = 60 * 60 * 24 * 7  # 7 days


def _get_s3_client() -> Any:
    """Return a boto3 S3 client using the sidecar's AWS creds.

    Imported lazily so test environments without boto3 still load the module.
    """
    import boto3  # noqa: PLC0415

    settings = get_settings()
    return boto3.client(
        "s3",
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id or None,
        aws_secret_access_key=settings.aws_secret_access_key or None,
        aws_session_token=settings.aws_session_token or None,
    )


def _download_to_tempfile(client: Any, bucket: str, key: str, suffix: str = ".pdf") -> Path:
    """Download an S3 object to a NamedTemporaryFile and return the path.

    Caller is responsible for unlinking the file.
    """
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp.close()
    client.download_file(bucket, key, tmp.name)
    return Path(tmp.name)


def _upload_bytes(client: Any, bucket: str, key: str, data: bytes, content_type: str) -> None:
    """Upload bytes to S3 with explicit content-type."""
    client.put_object(Bucket=bucket, Key=key, Body=data, ContentType=content_type)


def _presign(client: Any, bucket: str, key: str, expires: int = S3_PRESIGN_EXPIRY_SEC) -> str:
    """Generate a presigned GET URL with the given expiry (seconds)."""
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": key},
        ExpiresIn=expires,
    )


def _safe_segment(s: str) -> str:
    """Strip the input to alphanumeric + `-_` for use in S3 keys."""
    return "".join(c for c in s if c.isalnum() or c in "-_")


def _render_and_upload_pages(
    pdf_path: Path,
    *,
    pa_id: str,
    attachment_id: str,
    client: Any,
    bucket: str,
) -> dict[str, Any]:
    """Render PDF pages to 150-DPI PNGs, upload to S3, return pdfviewer-data dict.

    Layout: `s3://<bucket>/attachments/<paId>/<attachmentId>/page_N.png`

    Returns the canonical pdfviewer-data shape — files list is
    `[<doc_basename>]` (one file per attachment), presigned_urls maps that
    basename to a `{pageNumber: presigned_url}` dict.  The basename is
    `<attachment_id>.pdf` so citation bboxes' `document_name` aligns
    automatically with Textract's `find_line_as_bbox` derivation.
    """
    import fitz  # noqa: PLC0415 — PyMuPDF (only allowed non-Penguin PDF lib)

    safe_pa = _safe_segment(pa_id)
    safe_att = _safe_segment(attachment_id)
    doc_basename = f"{safe_att}.pdf"

    page_urls: dict[str, str] = {}
    doc = fitz.open(str(pdf_path))
    try:
        for page_num in range(len(doc)):
            page = doc[page_num]
            mat = fitz.Matrix(150 / 72, 150 / 72)  # 150 DPI (PDFViewer rule)
            pix = page.get_pixmap(matrix=mat)
            png_bytes = pix.tobytes("png")
            page_filename = f"page_{page_num + 1}.png"
            key = f"attachments/{safe_pa}/{safe_att}/{page_filename}"
            _upload_bytes(client, bucket, key, png_bytes, "image/png")
            page_urls[str(page_num + 1)] = _presign(client, bucket, key)
    finally:
        doc.close()

    return {
        "files": [doc_basename],
        "presigned_urls": {doc_basename: page_urls},
    }


# ─── OCR with ai_call_cache layered ───────────────────────────────────────────

OCR_TASK = "attachment_intake_ocr"
OCR_PROMPT_VERSION = "v1"


async def _ocr_with_cache(
    pdf_path: Path,
    *,
    attachment_id: str,
    content_sha256: str,
    content_type: str,
    db_pool: asyncpg.Pool | None,
) -> tuple[dict[str, Any], bool]:
    """Run Textract on `pdf_path`, caching by (attachment_id, content_sha256).

    Returns (serialized_ocr_dict, was_cache_hit).
    """
    cache_input = {
        "attachment_id": attachment_id,
        "content_sha256": content_sha256,
        "content_type": content_type,
    }
    input_hash = hash_input(cache_input)

    if db_pool is not None:
        cached = await get_cached(
            db_pool,
            task=OCR_TASK,
            prompt_version=OCR_PROMPT_VERSION,
            model="aws-textract",
            input_hash=input_hash,
        )
        if cached is not None:
            logger.info(
                "attachment_intake OCR cache hit attachment=%s sha256=%s",
                attachment_id, content_sha256[:12],
            )
            return cached, True

    # Cache miss — run Textract.
    from services.ai.ocr import get_ocr_result, serialize_ocr_result  # noqa: PLC0415

    ocr_result = await get_ocr_result(str(pdf_path))
    serialized = serialize_ocr_result(ocr_result)

    if db_pool is not None:
        await set_cached(
            db_pool,
            task=OCR_TASK,
            prompt_version=OCR_PROMPT_VERSION,
            model="aws-textract",
            input_hash=input_hash,
            response=serialized,
            traced_to=None,
        )

    return serialized, False


# ─── Public entry point ───────────────────────────────────────────────────────

async def ingest_attachment(
    request: IngestAttachmentRequest,
    db_pool: asyncpg.Pool | None,
) -> IngestAttachmentResponse:
    """Ingest one S3-uploaded attachment.

    Steps:
      1. Download from S3 → temp file.
      2. If non-PDF, normalize via libreoffice; replace the working file.
      3. OCR via Textract (with ai_call_cache by (attachment_id, content_sha256)).
      4. Render PDF pages to PNGs; upload each PNG to S3.
      5. Return the pdfviewer-data shape + presigned URLs + OCR plain text.
    """
    settings = get_settings()
    bucket = settings.s3_attachments_bucket
    if not bucket:
        raise RuntimeError(
            "S3_ATTACHMENTS_BUCKET not configured — set the env var on the sidecar.",
        )

    client = _get_s3_client()

    # 1. Download.
    tmp_path = _download_to_tempfile(client, bucket, request.s3_key, suffix=".pdf")
    try:
        # 2. Normalize if needed.
        if request.mime_type != "application/pdf":
            normalized = tmp_path.with_suffix(".normalized.pdf")
            with tmp_path.open("rb") as f:
                raw_bytes = f.read()
            normalize_to_pdf(
                raw_bytes,
                request.mime_type,
                normalized,
                title=request.filename,
            )
            pdf_path = normalized
        else:
            pdf_path = tmp_path

        # SHA256 over the post-normalize bytes — cache key.
        with pdf_path.open("rb") as f:
            pdf_bytes = f.read()
        content_sha256 = hashlib.sha256(pdf_bytes).hexdigest()

        # 3. OCR (with ai_call_cache).
        serialized_ocr, was_cached = await _ocr_with_cache(
            pdf_path,
            attachment_id=request.attachment_id,
            content_sha256=content_sha256,
            content_type=request.mime_type,
            db_pool=db_pool,
        )

        line_objs = serialized_ocr.get("lines") or []
        ocr_line_count = len(line_objs)

        # Plain text WITHOUT the "|| N" suffix — Phase 3 evidence extraction
        # rebuilds line-number suffixes from this text via _build_line_numbered_text.
        extracted_text = "\n".join(
            str(line.get("content", "")) if isinstance(line, dict) else str(getattr(line, "content", ""))
            for line in line_objs
        )

        # 4. Render + upload pages.
        page_images = _render_and_upload_pages(
            pdf_path,
            pa_id=request.pa_id,
            attachment_id=request.attachment_id,
            client=client,
            bucket=bucket,
        )

        # 5. Presign the original PDF for the viewer's "open original" link.
        pdf_url = _presign(client, bucket, request.s3_key)

        return IngestAttachmentResponse(
            pdf_url=pdf_url,
            page_images=page_images,
            ocr_line_count=ocr_line_count,
            extracted_text=extracted_text,
            cached=was_cached,
        )
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            logger.warning("attachment_intake tempfile cleanup failed", exc_info=True)


__all__ = [
    "IngestAttachmentRequest",
    "IngestAttachmentResponse",
    "ingest_attachment",
]
