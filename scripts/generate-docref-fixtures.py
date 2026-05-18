"""
Phase 6 / Session 7 pre-flight: generate DocumentReference + Binary fixtures for the 4 demo patients.

Sources content from the seeded ClinicalNote rows (Phase 1 SOAP-voice text)
so end-to-end demo flow uses realistic clinical content.

Run once after a fresh seed; safe to re-run.

Outputs:
- prisma/fixtures/fhir/binary/mock-{patient-slug}-{doc-slug}.{txt,pdf}  (8 files)
- prisma/fixtures/fhir/documentReference/{patient-id}.json              (4 files)
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
from pathlib import Path

import asyncpg  # type: ignore
import fitz  # PyMuPDF

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_ROOT = REPO_ROOT / "prisma" / "fixtures" / "fhir"
DOCREF_DIR = FIXTURE_ROOT / "documentReference"
BINARY_DIR = FIXTURE_ROOT / "binary"

DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://pa_app:pa_app_dev@localhost:5432/pa_app",
)

# Source-of-truth: which 2 seeded notes per patient become the DocumentReference fixtures.
# (patient_id, encounter_id, [(note_id, doc_slug, loinc_code, loinc_display, content_type, as_pdf?), ...])
PATIENT_SPECS = [
    (
        "patient-jordan-avery",
        "encounter-head-ct",
        [
            ("note-head-ct-hp", "hp", "11506-3", "Progress note", "text/plain", False),
            ("note-head-ct-ed-triage", "ed-triage", "34111-5", "Emergency department note", "text/plain", False),
        ],
    ),
    (
        "patient-sam-rodriguez",
        "encounter-knee-mri",
        [
            ("note-knee-mri-ortho-consult", "ortho-consult", "11488-4", "Consult note", "text/plain", False),
            ("note-knee-mri-pt-discharge", "pt-discharge", "18761-7", "Provider-unspecified Transfer summary", "text/plain", False),
        ],
    ),
    (
        "patient-priya-shah",
        "encounter-botox",
        [
            ("note-botox-neuro-progress", "neuro-progress", "11506-3", "Progress note", "text/plain", False),
            # The headache diary becomes a PDF (exercises T4's PDF passthrough + page-image path).
            ("note-botox-headache-diary", "headache-diary", "18842-5", "Discharge summary", "application/pdf", True),
        ],
    ),
    (
        "patient-eleanor-vance",
        "encounter-power-wheelchair",
        [
            ("note-pwc-pmr-f2f-eval", "pmr-f2f-eval", "11488-4", "Consult note", "text/plain", False),
            ("note-pwc-pt-mobility-assessment", "pt-mobility-assessment", "28570-0", "Provider-unspecified Procedure note", "text/plain", False),
        ],
    ),
]


async def fetch_note_text(conn: asyncpg.Connection, note_id: str) -> tuple[str, str, str, str]:
    row = await conn.fetchrow(
        'SELECT text, "noteType", "authoredAt", "authorRole" FROM "ClinicalNote" WHERE id = $1',
        note_id,
    )
    if not row:
        raise SystemExit(f"Seeded note {note_id} not found — run `pnpm db:seed` first.")
    return row["text"], row["noteType"], row["authoredAt"].isoformat() + "Z", row["authorRole"]


def text_to_pdf_bytes(text: str, title: str) -> bytes:
    """Render plain text into a single-page PDF for the priya-shah headache-diary fixture."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)  # US Letter
    # Use PyMuPDF default Helvetica; no explicit fontname (varies across versions).
    page.insert_text((72, 72), title, fontsize=14)
    body_rect = fitz.Rect(72, 110, 540, 720)
    page.insert_textbox(body_rect, text, fontsize=10, align=0)
    out = doc.tobytes()
    doc.close()
    return out


def build_docref(
    *,
    patient_id: str,
    encounter_id: str,
    note_id: str,
    doc_slug: str,
    loinc_code: str,
    loinc_display: str,
    content_type: str,
    title: str,
    authored_at: str,
) -> dict:
    """Build a FHIR R4 DocumentReference resource per https://www.hl7.org/fhir/R4/documentreference.html"""
    fhir_id = f"docref-{patient_id.replace('patient-', '')}-{doc_slug}"
    binary_id = f"mock-{patient_id.replace('patient-', '')}-{doc_slug}"
    return {
        "resourceType": "DocumentReference",
        "id": fhir_id,
        "meta": {"versionId": "1"},
        "status": "current",
        "type": {
            "coding": [
                {
                    "system": "http://loinc.org",
                    "code": loinc_code,
                    "display": loinc_display,
                }
            ]
        },
        "subject": {"reference": f"Patient/{patient_id}"},
        "context": {"encounter": [{"reference": f"Encounter/{encounter_id}"}]},
        "date": authored_at,
        "description": title,
        "content": [
            {
                "attachment": {
                    "contentType": content_type,
                    "url": f"Binary/{binary_id}",
                    "title": title,
                }
            }
        ],
    }


async def main() -> None:
    DOCREF_DIR.mkdir(parents=True, exist_ok=True)
    BINARY_DIR.mkdir(parents=True, exist_ok=True)

    conn = await asyncpg.connect(DB_URL)
    try:
        for patient_id, encounter_id, notes in PATIENT_SPECS:
            docrefs: list[dict] = []
            for note_id, doc_slug, loinc_code, loinc_display, content_type, as_pdf in notes:
                text, note_type, authored_at, _author_role = await fetch_note_text(conn, note_id)
                title = f"{note_type} — {patient_id}"
                binary_id = f"mock-{patient_id.replace('patient-', '')}-{doc_slug}"

                if as_pdf:
                    pdf_bytes = text_to_pdf_bytes(text, title)
                    (BINARY_DIR / f"{binary_id}.pdf").write_bytes(pdf_bytes)
                else:
                    (BINARY_DIR / f"{binary_id}.txt").write_text(text, encoding="utf-8")

                docrefs.append(
                    build_docref(
                        patient_id=patient_id,
                        encounter_id=encounter_id,
                        note_id=note_id,
                        doc_slug=doc_slug,
                        loinc_code=loinc_code,
                        loinc_display=loinc_display,
                        content_type=content_type,
                        title=title,
                        authored_at=authored_at,
                    )
                )

            out_path = DOCREF_DIR / f"{patient_id}.json"
            out_path.write_text(json.dumps(docrefs, indent=2) + "\n", encoding="utf-8")
            print(f"Wrote {out_path.relative_to(REPO_ROOT)} ({len(docrefs)} resources)")

    finally:
        await conn.close()

    binary_count = len(list(BINARY_DIR.iterdir()))
    docref_count = len(list(DOCREF_DIR.iterdir()))
    print(f"\nDone. {docref_count} DocumentReference JSON files, {binary_count} Binary fixtures.")


if __name__ == "__main__":
    asyncio.run(main())
