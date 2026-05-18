"""Task — FHIR DocumentReference ingest pipeline.

Given a list of FHIR DocumentReferences (with their raw Binary content
base64-encoded), normalize each to PDF, OCR with AWS Textract, render page
images, and persist a `CachedDocumentReference` row (Postgres table:
`ClinicalNote` via `@@map` — see prisma/schema.prisma).

HARD RULES (CLAUDE.md / role brief):
- OCR via penguin.ocr.providers.aws.AWSTextractProvider (no direct boto3).
- PDF passthrough + page-image rasterization via PyMuPDF (`fitz`) only.
- HTML/RTF/CCDA → PDF via libreoffice headless subprocess.  NO weasyprint,
  reportlab, pdfkit, pdf2image.
- Line-number-based bbox retrieval (find_line_as_bbox) — never fuzzy match.
- Don't log Binary content, OCR full text, or any bearer tokens at info/debug.
- Per-OCR AI cache key includes (fhirResourceId, fhirVersionId, content_sha256)
  so re-OCRing the same FHIR version is a free cache hit.

Persistence boundary: the AI service owns the row write.  TS wrapper just
triggers the call and receives the resulting `CachedDocumentReference.id`
values.  This mirrors how `policy_ingestion.py` writes the AiCallCache rows.

Filename canonicalization: every produced PDF / pageImages entry / bbox
`document_name` uses `{fhirResourceId}.pdf`.  AWSTextractProvider's
`find_line_as_bbox` derives `document_name` from `OCRResult.file_path`'s
basename, so we ensure the file we hand Textract is named `{fhirResourceId}.pdf`.

Idempotency: TWO checks, in order
  1. Row-level — SELECT FROM "ClinicalNote" WHERE fhirResourceId=$1 AND
     fhirVersionId=$2.  Hit → return existing row's id, `cached=True`.
  2. OCR-level — `ai_call_cache` keyed by content hash.  Hit → skip Textract,
     reuse cached OCR result for bbox materialization / line count.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
from pathlib import Path
from typing import Any

import asyncpg
from pydantic import BaseModel, Field

from services.ai.cache import get_cached, hash_input, set_cached
from services.ai.config import get_settings
from services.ai.utils.document_normalize import normalize_to_pdf

logger = logging.getLogger(__name__)


# ─── Pydantic request / response contracts ────────────────────────────────────

class DocRefRef(BaseModel):
    """One FHIR DocumentReference + its raw binary content.

    The TS caller (`lib/ai/documentIntake.ts`) fetches the Binary bytes via
    `lib/fhir/documentReference.fetchBinary` and base64s them inline so the
    sidecar doesn't need to know about Epic.
    """

    fhir_id: str = Field(description="FHIR DocumentReference.id (stable per resource).")
    version_id: str = Field(description="DocumentReference.meta.versionId — re-ingest when this changes.")
    content_type: str = Field(description='MIME type, e.g. "application/pdf", "text/plain".')
    title: str = Field(default="", description="Optional human-readable title from DocumentReference.description.")
    content_b64: str = Field(description="Base64-encoded Binary bytes — opaque to the AI service.")


class IngestDocumentsRequest(BaseModel):
    """One PA's worth of DocumentReferences to ingest."""
    pa_id: str
    encounter_id: str = Field(
        description="Encounter id this PA is scoped to.  The CachedDocumentReference rows are written under this encounter.",
    )
    document_references: list[DocRefRef]


class IngestedDocumentRow(BaseModel):
    """One CachedDocumentReference row produced by the pipeline."""
    id: str
    fhir_resource_id: str
    fhir_version_id: str
    fhir_content_type: str
    ocr_line_count: int
    pdf_url: str
    cached: bool = Field(description="True when the row already existed at this version_id (no re-OCR).")


class IngestDocumentsResponse(BaseModel):
    pa_id: str
    documents: list[IngestedDocumentRow]


# ─── Output paths ─────────────────────────────────────────────────────────────

def _doc_dir(pa_id: str, fhir_id: str, public_root: Path) -> Path:
    """Return the per-document output directory under public/cached-docs/.

    Layout: public/cached-docs/{paId}/{fhirId}/{fhirId}.pdf + page_N.png
    """
    safe_pa = "".join(c for c in pa_id if c.isalnum() or c in "-_")
    safe_fhir = "".join(c for c in fhir_id if c.isalnum() or c in "-_")
    return public_root / "cached-docs" / safe_pa / safe_fhir


def _public_url_for_doc(pa_id: str, fhir_id: str, filename: str) -> str:
    """Build the relative URL under Next.js public/ for a doc artifact."""
    safe_pa = "".join(c for c in pa_id if c.isalnum() or c in "-_")
    safe_fhir = "".join(c for c in fhir_id if c.isalnum() or c in "-_")
    return f"/cached-docs/{safe_pa}/{safe_fhir}/{filename}"


def _canonical_basename(fhir_id: str) -> str:
    """Canonical OCR'd filename — drives `document_name` in bboxes everywhere."""
    safe_fhir = "".join(c for c in fhir_id if c.isalnum() or c in "-_")
    return f"{safe_fhir}.pdf"


# ─── Page-image rasterization (PyMuPDF, mirrors policy_ingestion approach) ────

def _render_page_images(
    pdf_path: Path,
    doc_basename: str,
    out_dir: Path,
    url_prefix: str,
) -> dict[str, Any]:
    """Render PDF pages to 150-DPI PNGs and return canonical `pdfviewer-data` shape.

    Output:
        {
          "files": [doc_basename],
          "presigned_urls": {doc_basename: {"1": "/cached-docs/.../page_1.png", ...}}
        }

    NOTE: For local-demo deploy we serve from Next.js public/.  Production
    swap to S3 presigned URLs — same shape, different URL strings.
    """
    import fitz  # PyMuPDF — only allowed non-Penguin PDF lib

    out_dir.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(str(pdf_path))
    page_urls: dict[str, str] = {}
    try:
        for page_num in range(len(doc)):
            page = doc[page_num]
            mat = fitz.Matrix(150 / 72, 150 / 72)  # 150 DPI minimum (PDFViewer rule)
            pix = page.get_pixmap(matrix=mat)
            filename = f"page_{page_num + 1}.png"
            pix.save(str(out_dir / filename))
            page_urls[str(page_num + 1)] = f"{url_prefix}/{filename}"
    finally:
        doc.close()

    return {
        "files": [doc_basename],
        "presigned_urls": {doc_basename: page_urls},
    }


# ─── DB helpers (asyncpg, mirror cache.py style) ──────────────────────────────

async def _find_existing_row(
    pool: asyncpg.Pool,
    pa_id: str,
    fhir_id: str,
    fhir_version_id: str,
) -> dict[str, Any] | None:
    """Idempotency check: row with matching (encounter→PA, fhirId, fhirVersionId).

    PA scope is implicit — a CachedDocumentReference is attached to an
    Encounter, and a PA points at one Encounter.  We accept rows scoped to
    the same encounter id (which we look up from the PA before the insert).
    """
    row = await pool.fetchrow(
        '''
        SELECT n."id", n."fhirContentType", n."pdfUrl", n."ocrLineCount"
        FROM "ClinicalNote" n
        JOIN "Encounter" e ON e."id" = n."encounterId"
        JOIN "PriorAuth" pa ON pa."encounterId" = e."id"
        WHERE pa."id" = $1
          AND n."fhirResourceId" = $2
          AND n."fhirVersionId" = $3
        LIMIT 1
        ''',
        pa_id, fhir_id, fhir_version_id,
    )
    if row is None:
        return None
    return dict(row)


async def _insert_row(
    pool: asyncpg.Pool,
    *,
    encounter_id: str,
    fhir_id: str,
    fhir_version_id: str,
    content_type: str,
    title: str,
    pdf_url: str,
    page_images: dict[str, Any],
    ocr_line_count: int,
    plain_text: str,
) -> str:
    """Insert a CachedDocumentReference row (table ClinicalNote via @@map)."""
    new_id = await pool.fetchval(
        '''
        INSERT INTO "ClinicalNote"
            (id, "encounterId", "noteType", "authoredAt", "authorRole",
             "text", "source",
             "fhirResourceId", "fhirVersionId", "fhirContentType",
             "pdfUrl", "pageImages", "ocrLineCount", "lastFetchedAt",
             "kind")
        VALUES
            (gen_random_uuid()::text, $1, $2, now(), $3,
             $4, $5,
             $6, $7, $8,
             $9, $10::jsonb, $11, now(),
             'clinical_note')
        RETURNING id
        ''',
        encounter_id,
        title or 'Clinical Document',
        'Clinician',
        plain_text,
        'fhir',
        fhir_id,
        fhir_version_id,
        content_type,
        pdf_url,
        json.dumps(page_images),
        ocr_line_count,
    )
    return str(new_id)


# ─── OCR with ai_call_cache layered on top ────────────────────────────────────

OCR_TASK = "document_intake_ocr"
OCR_PROMPT_VERSION = "v1"


async def _ocr_with_cache(
    pdf_path: Path,
    *,
    fhir_id: str,
    fhir_version_id: str,
    content_type: str,
    content_sha256: str,
    db_pool: asyncpg.Pool | None,
) -> tuple[dict[str, Any], object]:
    """Run Textract on `pdf_path`, caching the JSON-serialized OCR result.

    Returns:
        (serialized_ocr_dict, raw_ocr_result_or_none)
        - serialized_ocr_dict is what we persist in `ai_call_cache.responseJson`
        - raw_ocr_result_or_none is the live OCRResult instance from
          AWSTextractProvider.process_file, or None when we got a cache hit
          (we don't reconstruct OCRResult from the serialized form — for the
          intake row write we only need the line count, which is on the dict).

    Cache miss-then-hit path keeps the second `ingest_documents` call free of
    Textract cost — required for re-ingest idempotency tests.
    """
    cache_input = {
        "fhir_resource_id": fhir_id,
        "fhir_version_id": fhir_version_id,
        "content_type": content_type,
        "content_sha256": content_sha256,
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
            return cached, None

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

    return serialized, ocr_result


# ─── Per-document orchestration ───────────────────────────────────────────────

async def _process_one(
    doc: DocRefRef,
    *,
    pa_id: str,
    encounter_id: str,
    db_pool: asyncpg.Pool | None,
    public_root: Path,
) -> IngestedDocumentRow:
    """Normalize → OCR → render pages → persist row for one DocumentReference."""
    # ── 1. Idempotency: row already exists at this version_id? ───────────────
    if db_pool is not None:
        existing = await _find_existing_row(db_pool, pa_id, doc.fhir_id, doc.version_id)
        if existing is not None:
            logger.info(
                "document_intake row hit pa=%s fhir=%s version=%s",
                pa_id, doc.fhir_id, doc.version_id,
            )
            return IngestedDocumentRow(
                id=str(existing["id"]),
                fhir_resource_id=doc.fhir_id,
                fhir_version_id=doc.version_id,
                fhir_content_type=str(existing.get("fhirContentType") or doc.content_type),
                ocr_line_count=int(existing.get("ocrLineCount") or 0),
                pdf_url=str(existing.get("pdfUrl") or ""),
                cached=True,
            )

    # ── 2. Decode + normalize to PDF under canonical filename ────────────────
    raw_bytes = base64.b64decode(doc.content_b64)
    content_sha256 = hashlib.sha256(raw_bytes).hexdigest()

    doc_basename = _canonical_basename(doc.fhir_id)
    out_dir = _doc_dir(pa_id, doc.fhir_id, public_root)
    out_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = out_dir / doc_basename

    normalize_to_pdf(
        raw_bytes,
        doc.content_type,
        pdf_path,
        title=doc.title or doc.fhir_id,
    )

    # ── 3. OCR (with ai_call_cache layered) ──────────────────────────────────
    serialized_ocr, raw_ocr = await _ocr_with_cache(
        pdf_path,
        fhir_id=doc.fhir_id,
        fhir_version_id=doc.version_id,
        content_type=doc.content_type,
        content_sha256=content_sha256,
        db_pool=db_pool,
    )

    # `lines` is the authoritative line count; `page_count` is page count.
    # We persist line count, which matters more for the corpus / triage.
    ocr_line_count = len(serialized_ocr.get("lines") or [])

    # `text` column stores the OCR plain text WITHOUT the "|| N" suffix.
    # Phase 3 evidence extraction's `format_corpus` rebuilds the line-number
    # suffixes from this raw text via `_build_line_numbered_text` — so if we
    # stored the SDK's `full_text` (which already has `|| N`) we'd end up
    # with double-numbered lines like "content || 1 || 1".  The legacy seeded
    # ClinicalNote.text rows are plain text; we match that contract.
    line_objs = serialized_ocr.get("lines") or []
    plain_text = "\n".join(
        str(line.get("content", "")) if isinstance(line, dict) else str(getattr(line, "content", ""))
        for line in line_objs
    )

    # ── 4. Page images (PyMuPDF, 150 DPI) ────────────────────────────────────
    url_prefix = _public_url_for_doc(pa_id, doc.fhir_id, "").rstrip("/")
    page_images = _render_page_images(pdf_path, doc_basename, out_dir, url_prefix)

    # ── 5. Persist row ───────────────────────────────────────────────────────
    pdf_url = _public_url_for_doc(pa_id, doc.fhir_id, doc_basename)

    if db_pool is None:
        # Test / no-DB path — synthesize an id so callers still get a stable
        # contract.  Production always has a db_pool via lifespan().
        new_id = f"cdr-{doc.fhir_id}-{doc.version_id}"
    else:
        new_id = await _insert_row(
            db_pool,
            encounter_id=encounter_id,
            fhir_id=doc.fhir_id,
            fhir_version_id=doc.version_id,
            content_type=doc.content_type,
            title=doc.title,
            pdf_url=pdf_url,
            page_images=page_images,
            ocr_line_count=ocr_line_count,
            plain_text=plain_text,
        )
    # Suppress lint on raw_ocr — caller may extend to pull bboxes later (T5/T8).
    _ = raw_ocr

    return IngestedDocumentRow(
        id=new_id,
        fhir_resource_id=doc.fhir_id,
        fhir_version_id=doc.version_id,
        fhir_content_type=doc.content_type,
        ocr_line_count=ocr_line_count,
        pdf_url=pdf_url,
        cached=False,
    )


# ─── Public entry point ───────────────────────────────────────────────────────

async def ingest_documents(
    request: IngestDocumentsRequest,
    db_pool: asyncpg.Pool | None,
) -> IngestDocumentsResponse:
    """Ingest a list of DocumentReferences for a PA's encounter.

    See the module docstring for layered idempotency semantics.

    NOTE: tracing is wrapped at the per-PA level — every PA-driven request
    runs inside `PenguinTracer.session()` if Langfuse env vars are set.  When
    they aren't (default for the demo), this is a no-op nullcontext.
    """
    import services.ai.penguin_client as _pc  # noqa: PLC0415

    settings = get_settings()
    public_root = settings.public_dir

    tracer_ctx = _pc.get_tracer_session(request.pa_id, "system")

    out_rows: list[IngestedDocumentRow] = []
    if hasattr(tracer_ctx, "__aenter__"):
        async with tracer_ctx:
            for doc in request.document_references:
                row = await _process_one(
                    doc,
                    pa_id=request.pa_id,
                    encounter_id=request.encounter_id,
                    db_pool=db_pool,
                    public_root=public_root,
                )
                out_rows.append(row)
    else:
        with tracer_ctx:
            for doc in request.document_references:
                row = await _process_one(
                    doc,
                    pa_id=request.pa_id,
                    encounter_id=request.encounter_id,
                    db_pool=db_pool,
                    public_root=public_root,
                )
                out_rows.append(row)

    return IngestDocumentsResponse(pa_id=request.pa_id, documents=out_rows)


# Re-export for tests / external callers that need to introspect paths.
__all__ = [
    "DocRefRef",
    "IngestDocumentsRequest",
    "IngestDocumentsResponse",
    "IngestedDocumentRow",
    "ingest_documents",
    "_canonical_basename",
    "_doc_dir",
    "_public_url_for_doc",
    "_render_page_images",
]
