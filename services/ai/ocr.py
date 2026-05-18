"""Shared OCR helpers — runs AWS Textract via the Penguin SDK.

Used by `policy_ingestion.py` (returns the raw OCRResult so downstream code
can call `find_line_as_bbox` etc.) and by the `/ocr-document` HTTP route
(returns a JSON-friendly dict for transport).

HARD RULES:
- All OCR goes through penguin.ocr.providers.aws.AWSTextractProvider.
- No PDF content logged at info/debug level.
- Provider credentials come from pydantic settings (services/ai/.env), NOT
  os.environ — env vars there are stale.
- Do NOT require an S3 bucket; pass `or None` so files <5MB take the sync
  Textract path when no bucket is configured locally.
"""

from __future__ import annotations

import logging
from typing import Any

from penguin.ocr import AWSTextractProvider, OCRResult

from services.ai.config import get_settings

logger = logging.getLogger(__name__)


async def get_ocr_result(file_path: str) -> OCRResult:
    """Run OCR on a file and return the raw OCRResult.

    Internal helper — used by `policy_ingestion.py` because downstream code
    needs the full OCRResult object (for `find_line_as_bbox`, etc.).

    Raises:
        Re-raises any provider exception after logging. Retry / fallback
        decisions are the caller's responsibility.
    """
    settings = get_settings()
    try:
        ocr_provider = AWSTextractProvider(
            region_name=settings.aws_region,
            aws_access_key_id=settings.aws_access_key_id or None,
            aws_secret_access_key=settings.aws_secret_access_key or None,
            aws_session_token=settings.aws_session_token or None,
            s3_bucket=settings.s3_ocr_staging_bucket or None,
        )
        return await ocr_provider.process_file(file_path)
    except Exception:
        logger.exception("OCR failed for file_path=%s", file_path)
        raise


def serialize_ocr_result(result: OCRResult) -> dict[str, Any]:
    """Serialize OCRResult to a JSON-friendly dict for HTTP transport.

    Output shape:
        {
            "full_text": "{content} || {line_number}\\n…",
            "lines": [{ content, page_number, line_number, bounding_box, confidence }],
            "page_count": int,
        }

    The `full_text` format MUST match `policy_ingestion.py`'s in-process
    construction — evidence extraction depends on the `"content || line_number"`
    line shape.
    """
    full_text = "\n".join(
        f"{line.content} || {line.line_number}" for line in result.lines
    )
    page_count = max((line.page_number for line in result.lines), default=0)
    return {
        "full_text": full_text,
        "lines": [line.model_dump() for line in result.lines],
        "page_count": page_count,
    }


async def ocr_document(file_path: str) -> dict[str, Any]:
    """Public helper — runs OCR + serializes for HTTP transport."""
    return serialize_ocr_result(await get_ocr_result(file_path))
