"""Task: Submission packet generation.

Produces a multi-page PDF combining:
  - Page 1: Cover letter (provider/patient header + codes + narrative
            + attached-documents list + signature)
  - Pages 2+: Cited clinical notes
  - Pages N+: Cited provider uploads

HARD RULES:
- No PHI / full-prompt logging at info/debug level.
- No direct openai / anthropic / boto3-Bedrock imports. Penguin only via penguin_client.
- PDF generation via PyMuPDF (fitz) only. reportlab/weasyprint are forbidden.
- LLM (narrative) uses get_model("narrative") → claude-haiku-4-5.
- asyncpg for all DB reads/writes (Prisma is TS-only).
- storageUrl in Attachment row = relative path (/submission-packets/<paId>.pdf).
- Filesystem write uses absolute path from settings.public_dir.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from services.ai.cache import get_cached, hash_input, set_cached
from services.ai.config import get_settings
from services.ai.prompts.cover_letter_v1 import (
    COVER_LETTER_PROMPT_VERSION,
    COVER_LETTER_SYSTEM_PROMPT,
    build_user_message as build_narrative_user_message,
    format_criteria_summary,
)

logger = logging.getLogger(__name__)

# ─── LLM output schema ─────────────────────────────────────────────────────────


class NarrativeParagraph(BaseModel):
    """Container model for the LLM-generated cover letter narrative paragraph."""
    paragraph: str = Field(description="Medical necessity narrative paragraph (3-5 sentences).")


# ─── DB loader ─────────────────────────────────────────────────────────────────

async def _load_pa_data(pa_id: str, pool: Any) -> dict[str, Any]:
    """Load all PA data needed for packet generation from Postgres.

    Returns a dict with keys:
      pa, patient, coverage, provider, payer, encounter,
      codes, criteria_results (with citations), attachments
    """
    # Main PA + relations.
    pa_row = await pool.fetchrow(
        '''
        SELECT
          pa.id, pa."encounterId", pa."providerId", pa."payerId", pa.status,
          pa."createdAt", pa.priority, pa."priorityRationale",
          p."firstName" AS patient_first, p."lastName" AS patient_last,
          p.dob AS patient_dob, p.sex AS patient_sex,
          pr."firstName" AS provider_first, pr."lastName" AS provider_last,
          pr.npi AS provider_npi, pr.specialty AS provider_specialty,
          py.name AS payer_name,
          e."encounterDate"
        FROM "PriorAuth" pa
        JOIN "Encounter" e ON e.id = pa."encounterId"
        JOIN "Patient" p ON p.id = e."patientId"
        JOIN "Provider" pr ON pr.id = pa."providerId"
        JOIN "Payer" py ON py.id = pa."payerId"
        WHERE pa.id = $1
        ''',
        pa_id,
    )
    if pa_row is None:
        raise ValueError(f"PriorAuth not found: {pa_id}")

    # Coverage (primary).
    coverage_row = await pool.fetchrow(
        '''
        SELECT c."planName", c."memberId", c."groupNumber"
        FROM "Coverage" c
        JOIN "Encounter" e ON e."patientId" = c."patientId"
        JOIN "PriorAuth" pa ON pa."encounterId" = e.id
        WHERE pa.id = $1 AND c."isPrimary" = true
        ORDER BY c."effectiveFrom" DESC
        LIMIT 1
        ''',
        pa_id,
    )

    # PriorAuthCodes.
    code_rows = await pool.fetch(
        '''
        SELECT id, "codeType", code, modifier, description, "isPrimary"
        FROM "PriorAuthCode"
        WHERE "priorAuthId" = $1
        ORDER BY "isPrimary" DESC, "codeType", code
        ''',
        pa_id,
    )

    # CriterionResults with citations.
    result_rows = await pool.fetch(
        '''
        SELECT cr.id, cr."criterionId", cr.status, cr.rationale, cr.confidence,
               cr."evaluatedAt",
               pc.text AS criterion_text, pc.ordinal AS criterion_ordinal
        FROM "CriterionResult" cr
        JOIN "PolicyCriterion" pc ON pc.id = cr."criterionId"
        WHERE cr."priorAuthId" = $1
        ORDER BY pc.ordinal
        ''',
        pa_id,
    )

    citation_rows = await pool.fetch(
        '''
        SELECT c.id, c."criterionResultId", c."sourceType", c."sourceId",
               c."supportingTexts", c.reasoning, c.confidence, c.bboxes, c."lineNumbers"
        FROM "Citation" c
        JOIN "CriterionResult" cr ON cr.id = c."criterionResultId"
        WHERE cr."priorAuthId" = $1
        ''',
        pa_id,
    )

    # Group citations by criterionResultId.
    citations_by_result: dict[str, list[dict]] = {}
    for cit in citation_rows:
        rid = cit["criterionResultId"]
        citations_by_result.setdefault(rid, []).append(dict(cit))

    # Build criteria_results list.
    criteria_results = []
    for row in result_rows:
        cit_list = citations_by_result.get(row["id"], [])
        criteria_results.append({
            "criterion_id": row["criterionId"],
            "criterion_text": row["criterion_text"],
            "criterion_ordinal": row["criterion_ordinal"],
            "status": row["status"],
            "rationale": row["rationale"],
            "confidence": row["confidence"],
            "citations": cit_list,
        })

    # Attachments (kind='upload' only — we don't need previous submission_packet rows here).
    attachment_rows = await pool.fetch(
        '''
        SELECT id, filename, "mimeType", "storageUrl", "uploadedBy", "uploadedAt",
               "extractedText", kind
        FROM "Attachment"
        WHERE "priorAuthId" = $1 AND kind = 'upload'
        ORDER BY "uploadedAt"
        ''',
        pa_id,
    )

    # Clinical notes from the encounter.
    # Phase 6: rows with non-null pdfUrl are FHIR-ingested CachedDocumentReferences
    # (via document_intake.py) — the actual PDF lives at <public_dir>/<pdfUrl>.
    # Rows with null pdfUrl are legacy seeded ClinicalNote rows (Phase 1 seed
    # data, plain text only) — page 2+ rendering falls back to text synthesis.
    clinical_note_rows = await pool.fetch(
        '''
        SELECT id, "noteType", "authoredAt", "authorRole", text, source, "pdfUrl"
        FROM "ClinicalNote"
        WHERE "encounterId" = $1
        ORDER BY "authoredAt"
        ''',
        pa_row["encounterId"],
    )

    return {
        "pa_id": pa_id,
        "status": pa_row["status"],
        "created_at": pa_row["createdAt"],
        "encounter_date": pa_row["encounterDate"],
        "priority": pa_row["priority"],
        "priority_rationale": pa_row["priorityRationale"],
        "patient": {
            "first_name": pa_row["patient_first"],
            "last_name": pa_row["patient_last"],
            "dob": pa_row["patient_dob"],
            "sex": pa_row["patient_sex"],
        },
        "provider": {
            "first_name": pa_row["provider_first"],
            "last_name": pa_row["provider_last"],
            "npi": pa_row["provider_npi"],
            "specialty": pa_row["provider_specialty"],
        },
        "payer": {
            "name": pa_row["payer_name"],
        },
        "coverage": dict(coverage_row) if coverage_row else None,
        "codes": [dict(r) for r in code_rows],
        "criteria_results": criteria_results,
        "attachments": [dict(r) for r in attachment_rows],
        "clinical_notes": [dict(r) for r in clinical_note_rows],
    }


# ─── Cache key builder ──────────────────────────────────────────────────────────

def _build_cache_input(pa_data: dict[str, Any]) -> dict[str, Any]:
    """Build a cache-key-stable representation of the inputs for the narrative LLM call.

    Sort criteria by criterion_id and codes by (codeType, code) for stable hashing.
    Include patient summary (first name + last initial only — no PHI).
    """
    passed_criteria = [
        {"criterion_id": r["criterion_id"], "criterion_text": r["criterion_text"], "status": r["status"]}
        for r in pa_data["criteria_results"]
        if r["status"] in ("passed", "manual_override")
    ]
    passed_criteria.sort(key=lambda r: r["criterion_id"])

    codes = sorted(
        [{"codeType": c["codeType"], "code": c["code"]} for c in pa_data["codes"]],
        key=lambda c: (c["codeType"], c["code"]),
    )

    patient = pa_data["patient"]
    patient_summary = f"{patient['first_name']} {patient['last_name'][0]}."

    return {
        "patient_summary": patient_summary,
        "payer": pa_data["payer"]["name"],
        "codes": codes,
        "criteria": passed_criteria,
    }


# ─── PDF builder ────────────────────────────────────────────────────────────────

# Layout constants (A4 points: 595 × 842).
_PAGE_W = 595.0
_PAGE_H = 842.0
_MARGIN = 50.0
_TEXT_W = _PAGE_W - 2 * _MARGIN
_LINE_H = 14.0

# Penguin brand color (RGB 0-1).
_BRAND_R, _BRAND_G, _BRAND_B = 0.988, 0.271, 0.616  # #fc459d

# Helvetica (built-in) only covers Latin-1. Normalize Unicode to ASCII equivalents.
_UNICODE_REPLACE = [
    ('\u2265', '>='),    # >=
    ('\u2264', '<='),    # <=
    ('\u2014', ' - '),   # em dash
    ('\u2013', ' - '),   # en dash
    ('\u2018', "'"),     # left single quote
    ('\u2019', "'"),     # right single quote
    ('\u201c', '"'),     # left double quote
    ('\u201d', '"'),     # right double quote
    ('\u2022', '*'),     # bullet
    ('\u2192', '->'),    # arrow
    ('\u00b7', '*'),     # middle dot
    ('\u00d7', 'x'),     # multiplication
    ('\u2026', '...'),   # ellipsis
]


def _normalize(text: str) -> str:
    for src, dst in _UNICODE_REPLACE:
        text = text.replace(src, dst)
    return text


def _new_page(doc: Any) -> tuple[Any, float]:
    """Add a blank page to the doc and return (page, y_cursor)."""
    page = doc.new_page(width=_PAGE_W, height=_PAGE_H)
    return page, _MARGIN


def _draw_rule(page: Any, y: float, color: tuple = (0.8, 0.8, 0.8)) -> float:
    """Draw a horizontal rule and return new y cursor."""
    import fitz  # noqa: PLC0415
    page.draw_line(
        fitz.Point(_MARGIN, y),
        fitz.Point(_PAGE_W - _MARGIN, y),
        color=color,
        width=0.5,
    )
    return y + 6


def _insert_text_wrapped(
    page: Any,
    doc: Any,
    y: float,
    text: str,
    fontsize: float = 10,
    bold: bool = False,
    color: tuple = (0, 0, 0),
    top_margin: float = 0,
) -> tuple[Any, float]:
    """Insert wrapped text; create new page(s) if overflow.

    Returns (current_page, new_y_cursor).
    """
    import fitz  # noqa: PLC0415

    y += top_margin
    text = _normalize(text)
    fontname = "helv"  # helvetica (built-in)

    # Protect bottom margin.
    page_bottom = _PAGE_H - _MARGIN

    rect = fitz.Rect(_MARGIN, y, _MARGIN + _TEXT_W, page_bottom)
    result = page.insert_textbox(
        rect,
        text,
        fontsize=fontsize,
        fontname=fontname,
        color=color,
        align=fitz.TEXT_ALIGN_LEFT,
    )

    if result >= 0:
        # result = remaining vertical space in the rect after text is drawn.
        # height_used = rect_height - remaining = (page_bottom - y) - result
        height_used = (page_bottom - y) - result
        return page, y + height_used

    # result < 0 → overflow. Split text: write what fits on this page, continue on next.
    # Strategy: binary-search by splitting on newlines / word boundaries.
    # Simplified: chunk by line, fill current page, then new page.
    text_lines = text.split("\n")
    lines_per_page = max(1, int((page_bottom - y) // (fontsize + 2)))

    chunk = "\n".join(text_lines[:lines_per_page])
    rest = "\n".join(text_lines[lines_per_page:])

    rect_chunk = fitz.Rect(_MARGIN, y, _MARGIN + _TEXT_W, page_bottom)
    page.insert_textbox(rect_chunk, chunk, fontsize=fontsize, fontname=fontname, color=color)

    if rest.strip():
        page, y = _new_page(doc)
        return _insert_text_wrapped(page, doc, y, rest, fontsize=fontsize, bold=bold, color=color)

    return page, page_bottom


def _ensure_y(page: Any, doc: Any, y: float, needed: float = 40) -> tuple[Any, float]:
    """If less than `needed` points remain on this page, start a new one."""
    if y + needed > _PAGE_H - _MARGIN:
        return _new_page(doc)
    return page, y


def _build_pdf(pa_data: dict[str, Any], narrative: str) -> bytes:
    """Build the submission packet PDF and return raw bytes.

    Page 1: Cover letter (provider/patient blocks, codes, narrative,
            attached-documents list, signature).
    Pages 2+: Cited clinical notes.
    Pages N+: Cited provider uploads.
    """
    import fitz  # noqa: PLC0415

    doc = fitz.open()
    today_str = datetime.now(timezone.utc).strftime("%B %d, %Y")

    patient = pa_data["patient"]
    provider = pa_data["provider"]
    payer = pa_data["payer"]
    coverage = pa_data["coverage"] or {}
    codes = pa_data["codes"]

    patient_display = f"{patient['first_name']} {patient['last_name'][0]}."
    patient_dob = patient["dob"]
    if isinstance(patient_dob, datetime):
        dob_str = patient_dob.strftime("%m/%d/%Y")
    else:
        dob_str = str(patient_dob)[:10]

    # ── PAGE 1: Cover letter ─────────────────────────────────────────────────
    page, y = _new_page(doc)

    # Header bar.
    import fitz as _fitz  # noqa: PLC0415
    page.draw_rect(
        _fitz.Rect(0, 0, _PAGE_W, 36),
        color=(_BRAND_R, _BRAND_G, _BRAND_B),
        fill=(_BRAND_R, _BRAND_G, _BRAND_B),
    )
    page.insert_text(
        _fitz.Point(_MARGIN, 24),
        "PRIOR AUTHORIZATION SUBMISSION PACKET",
        fontsize=12,
        color=(1, 1, 1),
        fontname="helv",
    )
    y = 48

    # Date line.
    page.insert_text(_fitz.Point(_MARGIN, y), today_str, fontsize=9, color=(0.4, 0.4, 0.4))
    y += 20

    y = _draw_rule(page, y)

    # Provider block.
    provider_lines = (
        f"Ordering Provider: Dr. {provider['first_name']} {provider['last_name']}, "
        f"{provider['specialty']}\n"
        f"NPI: {provider['npi']}"
    )
    page, y = _insert_text_wrapped(page, doc, y, provider_lines, fontsize=10, top_margin=4)
    y += 8

    # Patient block.
    member_id = coverage.get("memberId", "N/A")
    plan_name = coverage.get("planName", "N/A")
    patient_lines = (
        f"Patient: {patient['first_name']} {patient['last_name']} | DOB: {dob_str} | "
        f"Sex: {patient['sex']}\n"
        f"Payer: {payer['name']} | Plan: {plan_name} | Member ID: {member_id}"
    )
    page, y = _insert_text_wrapped(page, doc, y, patient_lines, fontsize=10, top_margin=0)
    y += 8

    y = _draw_rule(page, y)

    # Procedure codes block.
    page, y = _insert_text_wrapped(page, doc, y, "REQUESTED PROCEDURE(S)", fontsize=10, top_margin=4, color=(0.2, 0.2, 0.2))
    y += 2
    for code in codes:
        modifier_str = f" ({code['modifier']})" if code.get("modifier") else ""
        primary_marker = " [PRIMARY]" if code.get("isPrimary") else ""
        code_line = f"  {code['codeType']} {code['code']}{modifier_str}{primary_marker} — {code['description']}"
        page, y = _insert_text_wrapped(page, doc, y, code_line, fontsize=9)

    priority = pa_data.get("priority")
    if priority and priority != "standard":
        label = priority.title()  # 'Expedited' or 'Urgent'
        rationale = pa_data.get("priority_rationale") or ""
        line = f"  Priority: {label} — {rationale}" if rationale else f"  Priority: {label}"
        page, y = _insert_text_wrapped(
            page, doc, y, line,
            fontsize=9, top_margin=4, color=(_BRAND_R, _BRAND_G, _BRAND_B),
        )

    y += 8

    y = _draw_rule(page, y)

    # Narrative paragraph (LLM-generated).
    page, y = _insert_text_wrapped(page, doc, y, "MEDICAL NECESSITY NARRATIVE", fontsize=10, top_margin=4, color=(0.2, 0.2, 0.2))
    y += 4
    page, y = _insert_text_wrapped(page, doc, y, narrative, fontsize=10, top_margin=0)
    y += 10

    y = _draw_rule(page, y)

    # ── Cited source IDs (drives ATTACHED DOCUMENTS list + later filters) ────
    criteria_results = pa_data["criteria_results"]
    cited_source_ids: set[str] = set()
    for result in criteria_results:
        if result["status"] in ("passed", "manual_override"):
            for cit in result.get("citations", []):
                if cit.get("sourceId"):
                    cited_source_ids.add(cit["sourceId"])

    # ── ATTACHED DOCUMENTS section ────────────────────────────────────────────
    clinical_notes = pa_data.get("clinical_notes", [])
    attachments = pa_data["attachments"]

    cited_notes = [n for n in clinical_notes if n["id"] in cited_source_ids]
    cited_attachments = [a for a in attachments if a["id"] in cited_source_ids]

    page, y = _insert_text_wrapped(page, doc, y, "ATTACHED DOCUMENTS",
        fontsize=10, top_margin=4, color=(0.2, 0.2, 0.2))
    y += 4
    page, y = _insert_text_wrapped(page, doc, y, "The following documents are attached:",
        fontsize=10, top_margin=0)
    y += 2

    if not cited_notes and not cited_attachments:
        page, y = _insert_text_wrapped(page, doc, y, "  • None — manual override only",
            fontsize=9, color=(0.4, 0.4, 0.4))
    else:
        for n in cited_notes:
            note_type = (n.get("noteType") or "note").replace("_", " ").title()
            author_role = n.get("authorRole") or "clinician"
            authored_at = n.get("authoredAt")
            if isinstance(authored_at, datetime):
                date_str = authored_at.strftime("%m/%d/%Y")
            elif authored_at:
                date_str = str(authored_at)[:10]
            else:
                date_str = ""
            line = f"  • {note_type} — {date_str}, {author_role}" if date_str else f"  • {note_type} — {author_role}"
            page, y = _insert_text_wrapped(page, doc, y, line, fontsize=9)
        for a in cited_attachments:
            page, y = _insert_text_wrapped(page, doc, y, f"  • {a['filename']}", fontsize=9)

    y += 6
    y = _draw_rule(page, y)

    # Signature line.
    page, y = _ensure_y(page, doc, y, needed=60)
    sig_text = (
        f"Submitted by: Dr. {provider['first_name']} {provider['last_name']}, "
        f"{provider['specialty']}\n"
        f"NPI: {provider['npi']}\n"
        f"Date: {today_str}\n\n"
        f"______________________________\n"
        f"Provider Signature"
    )
    page, y = _insert_text_wrapped(page, doc, y, sig_text, fontsize=10, top_margin=4)

    # ── PAGES 2+: Supporting documents ────────────────────────────────────────
    # Clinical notes from the encounter — only cited notes.
    if clinical_notes:
        page, y = _new_page(doc)
        page.draw_rect(
            _fitz.Rect(0, 0, _PAGE_W, 36),
            color=(0.2, 0.2, 0.2),
            fill=(0.2, 0.2, 0.2),
        )
        page.insert_text(
            _fitz.Point(_MARGIN, 24),
            "CLINICAL NOTES",
            fontsize=11,
            color=(1, 1, 1),
        )
        y = 48

        encounter_date = pa_data.get("encounter_date")
        if isinstance(encounter_date, datetime):
            enc_date_str = encounter_date.strftime("%m/%d/%Y")
        elif encounter_date:
            enc_date_str = str(encounter_date)[:10]
        else:
            enc_date_str = today_str
        page.insert_text(
            _fitz.Point(_MARGIN, y),
            f"From encounter on {enc_date_str}",
            fontsize=9,
            color=(0.4, 0.4, 0.4),
        )
        y += 18
        y = _draw_rule(page, y)

        for note in clinical_notes:
            if note["id"] not in cited_source_ids:
                continue
            note_type = note.get("noteType") or "note"
            author_role = note.get("authorRole") or "clinician"
            authored_at = note.get("authoredAt")
            note_text = note.get("text") or ""
            pdf_url = note.get("pdfUrl") or ""

            readable_type = note_type.replace("_", " ").title()
            if isinstance(authored_at, datetime):
                authored_str = authored_at.strftime("%m/%d/%Y %H:%M")
            elif authored_at:
                authored_str = str(authored_at)[:16]
            else:
                authored_str = ""

            header_line = f"{readable_type} — {author_role}"
            if authored_str:
                header_line = f"{header_line} — {authored_str}"

            # Phase 6 branch: if this is a FHIR-ingested CachedDocumentReference
            # (pdfUrl is non-empty), append the real PDF pages via
            # fitz.Document.insert_pdf so the payer receives the actual source
            # document rather than synthesized text.  On any resolution error
            # we fall back to the seeded plain-text path below.
            appended_real_pdf = False
            if pdf_url:
                settings = get_settings()
                candidate_paths = [
                    settings.public_dir / pdf_url.lstrip("/"),
                    Path(pdf_url),
                ]
                for candidate in candidate_paths:
                    if not candidate.exists():
                        continue
                    try:
                        src_doc = _fitz.open(str(candidate))
                        try:
                            doc.insert_pdf(src_doc)
                            appended_real_pdf = True
                            break
                        finally:
                            src_doc.close()
                    except Exception:  # noqa: BLE001 — log + fall back
                        logger.warning(
                            "Could not append PDF for clinical note %s at %s",
                            note["id"], candidate,
                        )
                if not appended_real_pdf:
                    logger.warning(
                        "Could not resolve clinical note pdfUrl=%s for note %s; "
                        "falling back to text rendering",
                        pdf_url, note["id"],
                    )

            if appended_real_pdf:
                # `doc.insert_pdf` appended the source PDF's pages at the end
                # of the doc.  Reset `page` to point at the LAST appended page
                # and set `y = _PAGE_H` so any subsequent _insert_text_wrapped
                # / _ensure_y triggers a fresh page (rather than scribbling on
                # the appended PDF's last page or backwards onto the section
                # header page).  No trailing blank page when this is the last
                # iteration.
                page = doc[-1]
                y = _PAGE_H
                continue

            # Fallback: synthesized text rendering (Phase 3 path, unchanged).
            # Reserve space for header + a few body lines before page break.
            page, y = _ensure_y(page, doc, y, needed=80)
            page, y = _insert_text_wrapped(
                page, doc, y, header_line, fontsize=10, top_margin=6, color=(0.2, 0.2, 0.2)
            )
            page, y = _insert_text_wrapped(
                page, doc, y, note_text, fontsize=9, top_margin=2, color=(0, 0, 0)
            )
            y = _draw_rule(page, y, color=(0.85, 0.85, 0.85))
            y += 4

    # Provider upload attachments — only cited uploads.
    for att in attachments:
        if att["id"] not in cited_source_ids:
            continue
        storage_url = att["storageUrl"]
        filename = att["filename"]
        extracted_text = att.get("extractedText") or ""
        mime_type = att.get("mimeType", "")

        # Section divider page for this document.
        page, y = _new_page(doc)
        page.draw_rect(
            _fitz.Rect(0, 0, _PAGE_W, 36),
            color=(0.2, 0.2, 0.2),
            fill=(0.2, 0.2, 0.2),
        )
        page.insert_text(
            _fitz.Point(_MARGIN, 24),
            f"SUPPORTING DOCUMENT: {filename}",
            fontsize=11,
            color=(1, 1, 1),
        )
        y = 48

        if "pdf" in mime_type.lower():
            # Try to append the actual PDF pages.
            settings = get_settings()
            # storage_url is like /submission-packets/... or just /uploads/...
            # Try both repo public dir and absolute path.
            candidate_paths = [
                settings.public_dir / storage_url.lstrip("/"),
                Path(storage_url),
            ]
            appended = False
            for path in candidate_paths:
                if path.exists():
                    try:
                        src_doc = _fitz.open(str(path))
                        doc.insert_pdf(src_doc)
                        src_doc.close()
                        appended = True
                        break
                    except Exception:
                        logger.warning("Could not append PDF %s", path)
            if not appended and extracted_text:
                page, y = _insert_text_wrapped(page, doc, y, extracted_text[:3000], fontsize=9, top_margin=4)
        elif extracted_text:
            # Plain text — render as text pages.
            page, y = _insert_text_wrapped(page, doc, y, extracted_text[:3000], fontsize=9, top_margin=4)
        else:
            page, y = _insert_text_wrapped(
                page, doc, y, f"[Document not available for inline preview: {filename}]",
                fontsize=9, top_margin=4, color=(0.5, 0.5, 0.5)
            )

    return doc.tobytes()


# ─── Attachment persistence ────────────────────────────────────────────────────

async def _insert_attachment(
    pool: Any,
    pa_id: str,
    storage_url: str,
    pdf_url: str,
) -> str:
    """Insert an Attachment row for the generated PDF. Returns the new attachment id."""
    today_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    filename = f"pa-{pa_id}-packet-{today_str}.pdf"

    row = await pool.fetchrow(
        '''
        INSERT INTO "Attachment"
          (id, "priorAuthId", filename, "mimeType", "storageUrl", "uploadedBy", "uploadedAt", kind)
        VALUES
          (gen_random_uuid()::text, $1, $2, 'application/pdf', $3, 'system', now(), 'submission_packet')
        RETURNING id
        ''',
        pa_id,
        filename,
        storage_url,
    )
    return row["id"]


# ─── Core generate function ────────────────────────────────────────────────────

async def generate_submission_packet(
    *,
    pa_id: str,
    regenerate: bool = False,
    provider_id: str | None = None,
    db_pool: Any | None = None,
) -> dict[str, Any]:
    """Generate (or regenerate) the submission packet PDF for a PA.

    Steps:
      1. Load PA data from DB.
      2. Check AI cache for narrative (keyed by criteria + codes + patient summary).
      3. Call LLM (get_model("narrative")) for cover-letter paragraph if cache miss.
      4. Build PDF with fitz.
      5. Save to <public_dir>/submission-packets/<paId>.pdf.
      6. Persist Attachment row (kind='submission_packet'). Old rows kept for audit.
      7. Return GeneratePacketResponse-compatible dict.

    db_pool=None skips all DB operations (used in tests with fixture data).
    """
    import services.ai.penguin_client as _pc  # noqa: PLC0415
    from penguin.core import HumanMessage, SystemMessage  # noqa: PLC0415

    settings = get_settings()
    get_model = _pc.get_model
    get_tracer_session = _pc.get_tracer_session

    # ── Load PA data ──────────────────────────────────────────────────────────
    if db_pool is not None:
        pa_data = await _load_pa_data(pa_id, db_pool)
    else:
        raise ValueError("db_pool is required for submission packet generation")

    # ── Cache key ─────────────────────────────────────────────────────────────
    cache_input = _build_cache_input(pa_data)
    input_hash = hash_input(cache_input)

    model_cfg = get_model("narrative")
    model_name = getattr(model_cfg, "model_name", "claude-haiku-4-5")

    # ── Cache read ────────────────────────────────────────────────────────────
    narrative_paragraph: str | None = None
    trace_id: str | None = None
    cached = False

    if db_pool is not None and not regenerate:
        cached_result = await get_cached(
            db_pool,
            task="cover_letter",
            prompt_version=COVER_LETTER_PROMPT_VERSION,
            model=model_name,
            input_hash=input_hash,
        )
        if cached_result is not None:
            narrative_paragraph = cached_result.get("narrative_paragraph", "")
            trace_id = cached_result.get("trace_id")
            cached = True

    # ── LLM call ─────────────────────────────────────────────────────────────
    if narrative_paragraph is None:
        patient = pa_data["patient"]
        last_initial = patient["last_name"][0] if patient["last_name"] else "?"
        codes = pa_data["codes"]
        procedure_codes_str = "; ".join(
            f"{c['codeType']} {c['code']} — {c['description']}" for c in codes
        )

        # Build criteria summary for narrative prompt.
        # Enrich criteria_results with citations for format_criteria_summary.
        criteria_summary = format_criteria_summary(pa_data["criteria_results"])

        user_msg = build_narrative_user_message(
            patient_first_name=patient["first_name"],
            patient_last_initial=last_initial,
            procedure_codes_and_descriptions=procedure_codes_str,
            payer_name=pa_data["payer"]["name"],
            criteria_summary=criteria_summary,
        )

        structured_model = get_model("narrative").with_structured_output(NarrativeParagraph)
        messages = [
            SystemMessage(content=COVER_LETTER_SYSTEM_PROMPT),
            HumanMessage(content=user_msg),
        ]

        tracer_ctx = (
            get_tracer_session(pa_id, provider_id)
            if provider_id
            else None
        )

        if tracer_ctx is not None:
            async with tracer_ctx as session:
                trace_id = getattr(session, "trace_id", None)
                llm_result: NarrativeParagraph = await structured_model.ainvoke(messages)
        else:
            llm_result = await structured_model.ainvoke(messages)

        narrative_paragraph = llm_result.paragraph

        # Cache write.
        if db_pool is not None:
            await set_cached(
                db_pool,
                task="cover_letter",
                prompt_version=COVER_LETTER_PROMPT_VERSION,
                model=model_name,
                input_hash=input_hash,
                response={"narrative_paragraph": narrative_paragraph, "trace_id": trace_id},
                traced_to=trace_id,
            )

    # ── Build PDF ─────────────────────────────────────────────────────────────
    pdf_bytes = _build_pdf(pa_data, narrative_paragraph)

    # ── Save PDF to disk ──────────────────────────────────────────────────────
    packets_dir = settings.public_dir / "submission-packets"
    packets_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = packets_dir / f"{pa_id}.pdf"
    pdf_path.write_bytes(pdf_bytes)
    logger.info("Submission packet written: %s (%d bytes)", pdf_path, len(pdf_bytes))

    storage_url = f"/submission-packets/{pa_id}.pdf"
    pdf_url = storage_url  # Relative; Next.js serves from public/

    # ── Render pages to PNG for PDFViewer ─────────────────────────────────────
    # PDFViewer cannot display raw PDF URLs — it requires pre-rendered PNG images.
    import fitz as _fitz2  # noqa: PLC0415
    pages_dir = packets_dir / pa_id
    pages_dir.mkdir(parents=True, exist_ok=True)
    rendered_doc = _fitz2.open(str(pdf_path))
    page_count = len(rendered_doc)
    for page_num in range(page_count):
        pg = rendered_doc[page_num]
        pix = pg.get_pixmap(matrix=_fitz2.Matrix(150 / 72, 150 / 72))
        pix.save(str(pages_dir / f"page_{page_num + 1}.png"))
    rendered_doc.close()
    logger.info("Submission packet page images rendered: %d pages", page_count)

    # ── Persist Attachment row ────────────────────────────────────────────────
    attachment_id = await _insert_attachment(db_pool, pa_id, storage_url, pdf_url)

    generated_at = datetime.now(timezone.utc)

    return {
        "pdf_url": pdf_url,
        "attachment_id": attachment_id,
        "generated_at": generated_at,
        "narrative_paragraph": narrative_paragraph,
        "prompt_version": COVER_LETTER_PROMPT_VERSION,
        "model": model_name,
        "trace_id": trace_id,
        "cached": cached,
        "page_count": page_count,
    }


# ─── Test-only: generate from fixture data (no DB required) ──────────────────

async def generate_submission_packet_from_fixture(
    pa_data: dict[str, Any],
    narrative: str,
    pa_id: str,
    output_dir: Path | None = None,
) -> bytes:
    """Build and return PDF bytes from fixture data (for tests).

    Optionally writes the PDF to output_dir/<pa_id>.pdf if output_dir is provided.
    Does NOT call the LLM or write Attachment rows.
    """
    pdf_bytes = _build_pdf(pa_data, narrative)
    if output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)
        out_path = output_dir / f"{pa_id}.pdf"
        out_path.write_bytes(pdf_bytes)
        logger.info("Test PDF written: %s (%d bytes)", out_path, len(pdf_bytes))
    return pdf_bytes
