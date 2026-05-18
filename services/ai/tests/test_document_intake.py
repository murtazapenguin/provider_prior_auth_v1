"""Tests for Phase 6 — FHIR DocumentReference intake pipeline.

Run: pytest services/ai/tests/test_document_intake.py -v

Coverage (per phase-6-foundation override §8):
  1. PDF passthrough — bytes-equal input/output; OCR runs; pageImages produced.
  2. RTF normalization — libreoffice converts; page count > 0; OCR runs.  (skipif soffice missing)
  3. CCDA XML normalization — extracts <section><text> → HTML → libreoffice.  (skipif soffice missing)
  4. Plain text — PyMuPDF text-on-page render; OCR runs.
  5. Idempotency — second `ingest_documents` call with same versionId reuses
     the existing row and does NOT re-Textract (spy on AWSTextractProvider).
  6. Route auth — POST /ingest-documents 401s without bearer.

All tests mock the OCR provider's `process_file` to avoid real AWS calls.
DB pool is mocked (db_pool=None path) where row idempotency isn't under test;
when row idempotency IS under test, we mock asyncpg.fetchrow.
"""

from __future__ import annotations

import base64
import json
import shutil
import tempfile
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.ai.document_intake import (
    DocRefRef,
    IngestDocumentsRequest,
    _canonical_basename,
    _doc_dir,
    ingest_documents,
)
from services.ai.utils.document_normalize import (
    LibreOfficeUnavailableError,
    _ccda_to_html,
    _find_soffice,
    normalize_to_pdf,
)


# ─── Fixture builders ─────────────────────────────────────────────────────────

def _make_pdf_bytes(text: str = "Hello world fixture document\nLine 2") -> bytes:
    """Render a tiny PDF via PyMuPDF, return the bytes."""
    import fitz

    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text, fontsize=11)
    raw = doc.tobytes()
    doc.close()
    return raw


def _make_rtf_bytes() -> bytes:
    """Minimal RTF that libreoffice can parse."""
    return (
        b"{\\rtf1\\ansi\\deff0\n"
        b"{\\fonttbl{\\f0 Times New Roman;}}\n"
        b"\\f0\\fs24\nHello from RTF.\\par\nSecond paragraph.\\par\n}"
    )


def _make_ccda_xml() -> bytes:
    """Minimal CCDA-shaped XML with one section/title/text triple."""
    return (
        b"<?xml version='1.0' encoding='UTF-8'?>\n"
        b'<ClinicalDocument xmlns="urn:hl7-org:v3">\n'
        b"  <title>Demo CCDA</title>\n"
        b"  <component><structuredBody>\n"
        b"    <component><section>\n"
        b"      <title>History of Present Illness</title>\n"
        b"      <text>Patient reports headache lasting 3 days. Severe quality.</text>\n"
        b"    </section></component>\n"
        b"    <component><section>\n"
        b"      <title>Assessment</title>\n"
        b"      <text>Probable migraine variant; rule out SAH.</text>\n"
        b"    </section></component>\n"
        b"  </structuredBody></component>\n"
        b"</ClinicalDocument>"
    )


def _make_fake_ocr_result(file_path: Path, line_count: int = 5) -> Any:
    """Return a Mock that quacks like penguin.ocr.OCRResult enough for serialization.

    `services.ai.ocr.serialize_ocr_result` only iterates `.lines` and computes
    page_count from `line.page_number`s, so a SimpleNamespace-style mock works.
    """
    from types import SimpleNamespace

    lines = [
        SimpleNamespace(
            content=f"Line content {i + 1}",
            page_number=1,
            line_number=i + 1,
            bounding_box=[
                {"x": 0.1, "y": 0.1 + i * 0.02},
                {"x": 0.4, "y": 0.1 + i * 0.02},
                {"x": 0.4, "y": 0.12 + i * 0.02},
                {"x": 0.1, "y": 0.12 + i * 0.02},
            ],
            confidence=0.99,
        )
        for i in range(line_count)
    ]
    # OCRResult uses pydantic; we need to monkey-patch the model_dump method to
    # return a plain dict.  Instead of mocking the pydantic model, just provide
    # a SimpleNamespace and override .model_dump via a function attribute.
    line_objs = []
    for line in lines:
        line.model_dump = lambda _line=line: {
            "content": _line.content,
            "page_number": _line.page_number,
            "line_number": _line.line_number,
            "bounding_box": _line.bounding_box,
            "confidence": _line.confidence,
        }
        line_objs.append(line)

    return SimpleNamespace(
        file_path=str(file_path),
        full_text="\n".join(f"{ln.content} || {ln.line_number}" for ln in line_objs),
        provider="aws",
        lines=line_objs,
        metadata={"page_dimensions": [{"page_number": 1, "width": 8.5, "height": 11.0, "unit": "inch"}]},
    )


def _patch_get_ocr_result(line_count: int = 5):
    """Patch get_ocr_result so document_intake uses a fake OCRResult.

    `document_intake._ocr_with_cache` does a local `from services.ai.ocr import
    get_ocr_result, serialize_ocr_result`, so we patch on the source module.
    """

    async def fake_get_ocr_result(file_path: str):
        return _make_fake_ocr_result(Path(file_path), line_count=line_count)

    return patch("services.ai.ocr.get_ocr_result", new=fake_get_ocr_result)


HAS_SOFFICE = _find_soffice() is not None


# ─── 1. normalize_to_pdf — content-type dispatch ──────────────────────────────

def test_normalize_pdf_passthrough_bytes_equal(tmp_path: Path):
    """PDF input is returned bytes-equal."""
    pdf_bytes = _make_pdf_bytes("passthrough test")
    out_path = tmp_path / "out.pdf"
    normalize_to_pdf(pdf_bytes, "application/pdf", out_path)
    assert out_path.exists()
    assert out_path.read_bytes() == pdf_bytes


def test_normalize_plain_text_renders_pdf_via_pymupdf(tmp_path: Path):
    """Plain text → PDF with at least one page; bytes start with %PDF-."""
    import fitz

    text = "Line one of clinical narrative.\nLine two: lab results normal."
    out_path = tmp_path / "plain.pdf"
    normalize_to_pdf(text.encode("utf-8"), "text/plain", out_path)
    assert out_path.exists()
    raw = out_path.read_bytes()
    assert raw.startswith(b"%PDF-"), "output must be a valid PDF"

    doc = fitz.open(str(out_path))
    try:
        assert len(doc) >= 1
        page_text = doc[0].get_text()
    finally:
        doc.close()
    # PyMuPDF stripping may add whitespace, but the substring should survive.
    assert "Line one" in page_text or "narrative" in page_text


@pytest.mark.skipif(not HAS_SOFFICE, reason="libreoffice (soffice) required for RTF normalization")
def test_normalize_rtf_via_libreoffice(tmp_path: Path):
    """RTF → PDF via libreoffice headless; produces a valid PDF with content."""
    import fitz

    rtf_bytes = _make_rtf_bytes()
    out_path = tmp_path / "rtf.pdf"
    normalize_to_pdf(rtf_bytes, "text/rtf", out_path)
    assert out_path.exists()

    doc = fitz.open(str(out_path))
    try:
        assert len(doc) >= 1
        page_text = doc[0].get_text()
    finally:
        doc.close()
    assert "RTF" in page_text or "Hello" in page_text or "paragraph" in page_text


def test_normalize_rtf_without_soffice_raises(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """Document the failure mode when libreoffice is absent."""
    monkeypatch.setattr("services.ai.utils.document_normalize._find_soffice", lambda: None)
    with pytest.raises(LibreOfficeUnavailableError):
        normalize_to_pdf(_make_rtf_bytes(), "text/rtf", tmp_path / "rtf.pdf")


def test_ccda_to_html_extracts_sections():
    """Pure XML→HTML extraction works without libreoffice."""
    html_str = _ccda_to_html(_make_ccda_xml(), title="Demo")
    assert "History of Present Illness" in html_str
    assert "headache lasting 3 days" in html_str
    assert "Assessment" in html_str
    assert "Probable migraine" in html_str


@pytest.mark.skipif(not HAS_SOFFICE, reason="libreoffice (soffice) required for CCDA normalization")
def test_normalize_ccda_via_libreoffice(tmp_path: Path):
    """CCDA → HTML → PDF via libreoffice."""
    import fitz

    ccda_bytes = _make_ccda_xml()
    out_path = tmp_path / "ccda.pdf"
    normalize_to_pdf(ccda_bytes, "application/x-ccda+xml", out_path)
    assert out_path.exists()

    doc = fitz.open(str(out_path))
    try:
        assert len(doc) >= 1
        all_text = "\n".join(doc[i].get_text() for i in range(len(doc)))
    finally:
        doc.close()
    assert "headache" in all_text.lower() or "History" in all_text


# ─── 2. ingest_documents — full pipeline, mocked OCR + no DB ──────────────────

@pytest.mark.asyncio
async def test_ingest_pdf_passthrough_full_pipeline(tmp_path: Path):
    """End-to-end: PDF → normalize → OCR (mocked) → page images → row."""
    pdf_bytes = _make_pdf_bytes("End-to-end PDF passthrough fixture.")
    request = IngestDocumentsRequest(
        pa_id="pa-test-1",
        encounter_id="encounter-test-1",
        document_references=[
            DocRefRef(
                fhir_id="docref-pdf-1",
                version_id="1",
                content_type="application/pdf",
                title="PDF Fixture",
                content_b64=base64.b64encode(pdf_bytes).decode("ascii"),
            ),
        ],
    )

    public_root = tmp_path / "public"
    public_root.mkdir()

    with _patch_get_ocr_result(line_count=4), patch(
        "services.ai.document_intake.get_settings"
    ) as mock_settings:
        # public_dir property must be the temp dir for this test.
        mock_settings.return_value = MagicMock(public_dir=public_root)
        response = await ingest_documents(request, db_pool=None)

    assert response.pa_id == "pa-test-1"
    assert len(response.documents) == 1
    row = response.documents[0]
    assert row.fhir_resource_id == "docref-pdf-1"
    assert row.fhir_version_id == "1"
    assert row.ocr_line_count == 4
    assert row.cached is False

    # Page image file landed under public/cached-docs/.
    doc_dir = _doc_dir("pa-test-1", "docref-pdf-1", public_root)
    canonical_pdf = doc_dir / _canonical_basename("docref-pdf-1")
    assert canonical_pdf.exists()
    # PDF passthrough: file bytes match input.
    assert canonical_pdf.read_bytes() == pdf_bytes
    assert (doc_dir / "page_1.png").exists()


@pytest.mark.asyncio
async def test_ingest_plain_text_full_pipeline(tmp_path: Path):
    """Plain text fixture: PyMuPDF text-on-page → OCR (mocked) → row."""
    text_bytes = (
        b"PROGRESS NOTE\n\n"
        b"Patient reports persistent headache. Plan: imaging.\n"
        b"Order CT head without contrast."
    )
    request = IngestDocumentsRequest(
        pa_id="pa-test-2",
        encounter_id="encounter-test-2",
        document_references=[
            DocRefRef(
                fhir_id="docref-text-1",
                version_id="1",
                content_type="text/plain",
                title="Progress Note",
                content_b64=base64.b64encode(text_bytes).decode("ascii"),
            ),
        ],
    )

    public_root = tmp_path / "public"
    public_root.mkdir()

    with _patch_get_ocr_result(line_count=3), patch(
        "services.ai.document_intake.get_settings"
    ) as mock_settings:
        mock_settings.return_value = MagicMock(public_dir=public_root)
        response = await ingest_documents(request, db_pool=None)

    assert len(response.documents) == 1
    row = response.documents[0]
    assert row.fhir_resource_id == "docref-text-1"
    assert row.ocr_line_count == 3

    doc_dir = _doc_dir("pa-test-2", "docref-text-1", public_root)
    pdf_path = doc_dir / _canonical_basename("docref-text-1")
    assert pdf_path.exists()
    assert pdf_path.read_bytes().startswith(b"%PDF-")


@pytest.mark.skipif(not HAS_SOFFICE, reason="libreoffice required for RTF intake")
@pytest.mark.asyncio
async def test_ingest_rtf_full_pipeline(tmp_path: Path):
    """RTF fixture flows through libreoffice → PDF → OCR → row."""
    request = IngestDocumentsRequest(
        pa_id="pa-test-3",
        encounter_id="encounter-test-3",
        document_references=[
            DocRefRef(
                fhir_id="docref-rtf-1",
                version_id="1",
                content_type="text/rtf",
                title="RTF Fixture",
                content_b64=base64.b64encode(_make_rtf_bytes()).decode("ascii"),
            ),
        ],
    )

    public_root = tmp_path / "public"
    public_root.mkdir()

    with _patch_get_ocr_result(line_count=2), patch(
        "services.ai.document_intake.get_settings"
    ) as mock_settings:
        mock_settings.return_value = MagicMock(public_dir=public_root)
        response = await ingest_documents(request, db_pool=None)

    assert len(response.documents) == 1
    canonical_pdf = (
        _doc_dir("pa-test-3", "docref-rtf-1", public_root)
        / _canonical_basename("docref-rtf-1")
    )
    assert canonical_pdf.exists()
    # libreoffice produces a valid PDF.
    assert canonical_pdf.read_bytes().startswith(b"%PDF-")


@pytest.mark.skipif(not HAS_SOFFICE, reason="libreoffice required for CCDA intake")
@pytest.mark.asyncio
async def test_ingest_ccda_full_pipeline(tmp_path: Path):
    """CCDA fixture flows through XML→HTML→libreoffice→PDF→OCR→row."""
    request = IngestDocumentsRequest(
        pa_id="pa-test-4",
        encounter_id="encounter-test-4",
        document_references=[
            DocRefRef(
                fhir_id="docref-ccda-1",
                version_id="1",
                content_type="application/x-ccda+xml",
                title="CCDA Fixture",
                content_b64=base64.b64encode(_make_ccda_xml()).decode("ascii"),
            ),
        ],
    )

    public_root = tmp_path / "public"
    public_root.mkdir()

    with _patch_get_ocr_result(line_count=8), patch(
        "services.ai.document_intake.get_settings"
    ) as mock_settings:
        mock_settings.return_value = MagicMock(public_dir=public_root)
        response = await ingest_documents(request, db_pool=None)

    assert len(response.documents) == 1
    row = response.documents[0]
    assert row.fhir_resource_id == "docref-ccda-1"
    assert row.ocr_line_count == 8


# ─── 3. Idempotency — second call reuses existing row, skips Textract ────────

@pytest.mark.asyncio
async def test_idempotent_reingest_same_version_skips_textract(tmp_path: Path):
    """Second call with same (fhirId, versionId) reuses existing row without OCR.

    Simulation:
      - Mock asyncpg pool that returns an existing row from `_find_existing_row`.
      - Spy on `get_ocr_result`; assert it's never invoked.
    """
    existing_row = {
        "id": "existing-cdr-id-1",
        "fhirContentType": "application/pdf",
        "pdfUrl": "/cached-docs/pa-idem/docref-idem/docref-idem.pdf",
        "ocrLineCount": 7,
    }

    fake_pool = MagicMock()
    fake_pool.fetchrow = AsyncMock(return_value=existing_row)
    fake_pool.fetchval = AsyncMock(return_value="should-not-be-inserted")
    fake_pool.execute = AsyncMock()

    request = IngestDocumentsRequest(
        pa_id="pa-idem",
        encounter_id="enc-idem",
        document_references=[
            DocRefRef(
                fhir_id="docref-idem",
                version_id="1",
                content_type="application/pdf",
                title="Idem Fixture",
                content_b64=base64.b64encode(_make_pdf_bytes()).decode("ascii"),
            ),
        ],
    )

    public_root = tmp_path / "public"
    public_root.mkdir()

    spy = AsyncMock(side_effect=AssertionError("Textract must NOT be called on idempotent re-ingest"))
    with patch("services.ai.ocr.get_ocr_result", new=spy), patch(
        "services.ai.document_intake.get_settings"
    ) as mock_settings:
        mock_settings.return_value = MagicMock(public_dir=public_root)
        response = await ingest_documents(request, db_pool=fake_pool)

    assert len(response.documents) == 1
    row = response.documents[0]
    assert row.id == "existing-cdr-id-1"
    assert row.cached is True
    assert row.ocr_line_count == 7

    # Assert the SELECT happened and the INSERT did NOT.
    fake_pool.fetchrow.assert_awaited_once()
    fake_pool.fetchval.assert_not_called()
    spy.assert_not_called()


@pytest.mark.asyncio
async def test_first_then_second_call_uses_ai_call_cache(tmp_path: Path):
    """OCR-level cache: row missing but ai_call_cache hits → no Textract.

    Verifies the §12 override's content-hash cache key works end-to-end.
    """
    fake_pool = MagicMock()
    # Row idempotency miss.
    fake_pool.fetchrow = AsyncMock(return_value=None)
    fake_pool.fetchval = AsyncMock(return_value="newly-inserted-id")
    fake_pool.execute = AsyncMock()

    # First call: ai_call_cache miss → Textract runs and writes cache.
    # Second call: ai_call_cache hit → Textract NOT called.
    captured_responses: list[dict] = []

    async def mock_get_cached(_pool, *, task, prompt_version, model, input_hash):
        if captured_responses:
            return captured_responses[-1]
        return None

    async def mock_set_cached(_pool, *, task, prompt_version, model, input_hash, response, traced_to=None):
        captured_responses.append(response)

    request = IngestDocumentsRequest(
        pa_id="pa-cache",
        encounter_id="enc-cache",
        document_references=[
            DocRefRef(
                fhir_id="docref-cache",
                version_id="1",
                content_type="application/pdf",
                title="Cache Fixture",
                content_b64=base64.b64encode(_make_pdf_bytes()).decode("ascii"),
            ),
        ],
    )

    public_root = tmp_path / "public"
    public_root.mkdir()

    textract_calls = {"n": 0}

    async def counting_get_ocr_result(file_path: str):
        textract_calls["n"] += 1
        return _make_fake_ocr_result(Path(file_path), line_count=4)

    with patch("services.ai.ocr.get_ocr_result", new=counting_get_ocr_result), patch(
        "services.ai.document_intake.get_cached", new=mock_get_cached
    ), patch("services.ai.document_intake.set_cached", new=mock_set_cached), patch(
        "services.ai.document_intake.get_settings"
    ) as mock_settings:
        mock_settings.return_value = MagicMock(public_dir=public_root)

        # First call.
        await ingest_documents(request, db_pool=fake_pool)
        assert textract_calls["n"] == 1, "first call must invoke Textract"

        # Second call — row still missing (pool.fetchrow returns None), but
        # ai_call_cache now has the OCR response.
        await ingest_documents(request, db_pool=fake_pool)
        assert textract_calls["n"] == 1, "second call must reuse ai_call_cache (no Textract)"


# ─── Citation-flow regression: text column must not contain "|| N" suffix ────


@pytest.mark.asyncio
async def test_text_column_is_plain_content_for_format_corpus(tmp_path: Path):
    """Phase 3 evidence_extraction.format_corpus expects raw line content.

    `_build_line_numbered_text` appends "|| N" — if we stored the OCR
    `full_text` (which already has "|| N") into ClinicalNote.text, the
    corpus would end up with double "|| N || N" markers and the LLM citations
    would no longer map to OCR line numbers cleanly.

    This test captures the INSERT statement's `plain_text` arg via the
    asyncpg pool spy and asserts no `||` markers leak into the column.
    """
    fake_pool = MagicMock()
    fake_pool.fetchrow = AsyncMock(return_value=None)
    fake_pool.fetchval = AsyncMock(return_value="new-row-id")
    fake_pool.execute = AsyncMock()

    request = IngestDocumentsRequest(
        pa_id="pa-text-col",
        encounter_id="enc-text-col",
        document_references=[
            DocRefRef(
                fhir_id="docref-text-col",
                version_id="1",
                content_type="application/pdf",
                title="text col test",
                content_b64=base64.b64encode(_make_pdf_bytes()).decode("ascii"),
            ),
        ],
    )

    public_root = tmp_path / "public"
    public_root.mkdir()

    with _patch_get_ocr_result(line_count=3), patch(
        "services.ai.document_intake.get_settings"
    ) as mock_settings:
        mock_settings.return_value = MagicMock(public_dir=public_root)
        await ingest_documents(request, db_pool=fake_pool)

    fake_pool.fetchval.assert_awaited_once()
    # Args to _insert_row's fetchval call — `plain_text` is positional arg 4
    # in the SQL bind order (encounterId, noteType, authorRole, text, source, ...).
    call_args = fake_pool.fetchval.await_args
    sql = call_args.args[0]
    bind_vals = call_args.args[1:]
    # bind_vals[0]=encounter_id, [1]=noteType, [2]=authorRole, [3]=text
    assert "INSERT INTO" in sql and "ClinicalNote" in sql
    text_arg = bind_vals[3]
    assert " || " not in text_arg, (
        "ClinicalNote.text must contain raw line content (no '|| N' markers) "
        "so evidence_extraction.format_corpus can rebuild numbering correctly."
    )
    # And the text is non-empty (OCR mock has 3 lines).
    assert text_arg.strip() != ""


# ─── Citation-flow integration: full pipeline → evidence_extraction ──────────


@pytest.mark.asyncio
async def test_citation_flow_regression_through_ocr_pipeline(tmp_path: Path):
    """End-to-end: ingest a doc through this pipeline, then run evidence
    extraction against the resulting text and assert citations validate.

    This is the citation-flow regression test from override §8 — proves that
    a CachedDocumentReference whose `text` came from OCR full-text output
    still works with extract_evidence_for_criterion + FaithfulnessDetector.
    """
    from services.ai.evidence_extraction import (
        CriterionEvaluation,
        LlmCitation,
        extract_evidence_for_criterion,
    )

    captured_text: dict[str, str] = {}

    fake_pool = MagicMock()
    fake_pool.fetchrow = AsyncMock(return_value=None)
    fake_pool.execute = AsyncMock()

    async def capture_fetchval(_sql, *args):
        # `text` is bind position 3 in our INSERT.
        captured_text["text"] = args[3]
        return "row-id"

    fake_pool.fetchval = capture_fetchval

    pdf_bytes = _make_pdf_bytes()
    request = IngestDocumentsRequest(
        pa_id="pa-cite-regress",
        encounter_id="enc-cite-regress",
        document_references=[
            DocRefRef(
                fhir_id="docref-cite-regress",
                version_id="1",
                content_type="application/pdf",
                title="Citation regression doc",
                content_b64=base64.b64encode(pdf_bytes).decode("ascii"),
            ),
        ],
    )

    public_root = tmp_path / "public"
    public_root.mkdir()

    with _patch_get_ocr_result(line_count=4), patch(
        "services.ai.document_intake.get_settings"
    ) as mock_settings:
        mock_settings.return_value = MagicMock(public_dir=public_root)
        await ingest_documents(request, db_pool=fake_pool)

    raw_text = captured_text["text"]
    # The OCR mock writes lines `Line content 1`..`Line content 4`.
    assert "Line content 1" in raw_text
    assert " || " not in raw_text  # plain content only

    # Now construct an LLM evaluation that cites verbatim text from raw_text.
    supporting = raw_text.splitlines()[0]
    evaluation = CriterionEvaluation(
        status="passed",
        reasoning="The doc references the relevant clinical finding.",
        confidence=0.95,
        citations=[
            LlmCitation(
                source_id="docref-cite-regress",
                line_numbers=[1],
                supporting_texts=[supporting],
            )
        ],
    )

    mock_model = MagicMock()
    mock_structured = MagicMock()
    mock_structured.ainvoke = AsyncMock(return_value=evaluation)
    mock_model.with_structured_output = MagicMock(return_value=mock_structured)
    mock_model.model_name = "claude-sonnet-4-5"

    with patch("services.ai.penguin_client.get_model", return_value=mock_model):
        result = await extract_evidence_for_criterion(
            criterion_id="crit-regress",
            criterion_text="The document supports the request",
            evidence_hint=None,
            required_codes=[],
            sources=[{"id": "docref-cite-regress", "kind": "clinical_note", "text": raw_text}],
            db_pool=None,
        )

    assert result["status"] == "passed", (
        "Pipeline-produced text must support the same citation flow as "
        "legacy seeded ClinicalNote.text rows."
    )
    assert len(result["citations"]) == 1
    assert result["citation_validation"] == "all_valid"


# ─── 4. Route auth ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_route_requires_bearer_token(client):
    """POST /ingest-documents without auth → 401."""
    resp = await client.post(
        "/ingest-documents",
        json={"pa_id": "x", "encounter_id": "y", "document_references": []},
    )
    assert resp.status_code == 401
