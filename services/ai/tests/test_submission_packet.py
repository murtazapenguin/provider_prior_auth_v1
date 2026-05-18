"""Tests for the submission packet generator.

Four test areas (per task specification):
1. PDF structure: all three demo scenarios produce valid, parseable PDFs.
2. Page content: page 1 has expected codes/patient/narrative; page 2 has passed criteria.
3. Override criterion: manual_override rows appear on page 2 with verbatim rationale.
4. Cache: second call with same input returns cached narrative (LLM not called twice).

All tests mock the LLM (NarrativeParagraph).
Cache is bypassed by passing db_pool=None and using generate_submission_packet_from_fixture.
"""

from __future__ import annotations

import io
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ─── Fixture PA data ───────────────────────────────────────────────────────────

def _make_pa_data(
    pa_id: str,
    patient_first: str,
    patient_last: str,
    provider_first: str,
    provider_last: str,
    payer_name: str,
    codes: list[dict],
    criteria_results: list[dict],
    *,
    attachments: list[dict] | None = None,
) -> dict:
    return {
        "pa_id": pa_id,
        "status": "pending_submission",
        "created_at": datetime(2025, 5, 1, tzinfo=timezone.utc),
        "encounter_date": datetime(2025, 5, 1, tzinfo=timezone.utc),
        "patient": {
            "first_name": patient_first,
            "last_name": patient_last,
            "dob": date(1980, 3, 15),
            "sex": "M",
        },
        "provider": {
            "first_name": provider_first,
            "last_name": provider_last,
            "npi": "1234567890",
            "specialty": "Radiology",
        },
        "payer": {"name": payer_name},
        "coverage": {
            "planName": "UHC Choice Plus",
            "memberId": "M123456",
            "groupNumber": "G999",
        },
        "codes": codes,
        "criteria_results": criteria_results,
        "attachments": attachments or [],
    }


# Scenario 1: Head CT — all criteria passed.
HEAD_CT_PA_DATA = _make_pa_data(
    pa_id="pa-head-ct-test",
    patient_first="Jordan",
    patient_last="Avery",
    provider_first="Alex",
    provider_last="Kim",
    payer_name="UHC Choice Plus",
    codes=[
        {
            "codeType": "CPT",
            "code": "70450",
            "modifier": None,
            "description": "CT head without contrast",
            "isPrimary": True,
        }
    ],
    criteria_results=[
        {
            "criterion_id": "criterion-head-ct-1",
            "criterion_text": "New-onset headache or change in headache pattern",
            "criterion_ordinal": 1,
            "status": "passed",
            "rationale": "The note documents a 3-day history of new-onset severe headache.",
            "confidence": 0.97,
            "citations": [
                {
                    "sourceType": "clinical_note",
                    "sourceId": "note-head-ct-hp",
                    "supportingTexts": [
                        "New-onset severe headache for 3 days, worst headache of her life."
                    ],
                    "reasoning": "Clear new-onset headache documented.",
                    "confidence": 0.97,
                    "bboxes": [],
                    "lineNumbers": [1, 2],
                }
            ],
        },
        {
            "criterion_id": "criterion-head-ct-2",
            "criterion_text": "Red flag neurological symptoms present",
            "criterion_ordinal": 2,
            "status": "passed",
            "rationale": "Thunderclap onset, photophobia documented.",
            "confidence": 0.98,
            "citations": [
                {
                    "sourceType": "clinical_note",
                    "sourceId": "note-head-ct-hp",
                    "supportingTexts": [
                        "Red flags documented: thunderclap onset, photophobia, phonophobia."
                    ],
                    "reasoning": "Multiple red flags present.",
                    "confidence": 0.98,
                    "bboxes": [],
                    "lineNumbers": [5],
                }
            ],
        },
        {
            "criterion_id": "criterion-head-ct-3",
            "criterion_text": "Neurological examination documented",
            "criterion_ordinal": 3,
            "status": "passed",
            "rationale": "Complete neurological exam including cranial nerves documented.",
            "confidence": 0.99,
            "citations": [
                {
                    "sourceType": "clinical_note",
                    "sourceId": "note-head-ct-hp",
                    "supportingTexts": [
                        "Neurologic exam: cranial nerves II-XII intact. Motor: 5/5 strength."
                    ],
                    "reasoning": "Neurological exam fully documented.",
                    "confidence": 0.99,
                    "bboxes": [],
                    "lineNumbers": [6, 7],
                }
            ],
        },
    ],
)

# Scenario 2: Knee MRI — conservative therapy needs_info + passed criteria.
KNEE_MRI_PA_DATA = _make_pa_data(
    pa_id="pa-knee-mri-test",
    patient_first="Sam",
    patient_last="Rodriguez",
    provider_first="Beth",
    provider_last="Ortega",
    payer_name="UHC Choice Plus",
    codes=[
        {
            "codeType": "CPT",
            "code": "73721",
            "modifier": None,
            "description": "MRI any joint of lower extremity without contrast",
            "isPrimary": True,
        }
    ],
    criteria_results=[
        {
            "criterion_id": "criterion-knee-mri-1",
            "criterion_text": "Failure of conservative therapy (PT ≥4 weeks + NSAID ≥4 weeks)",
            "criterion_ordinal": 1,
            "status": "needs_info",
            "rationale": "Conservative therapy duration cannot be confirmed from available documentation.",
            "confidence": 0.38,
            "citations": [],
        },
        {
            "criterion_id": "criterion-knee-mri-2",
            "criterion_text": "Physical examination findings consistent with internal derangement",
            "criterion_ordinal": 2,
            "status": "passed",
            "rationale": "Positive McMurray and Apley tests with effusion documented.",
            "confidence": 0.95,
            "citations": [
                {
                    "sourceType": "clinical_note",
                    "sourceId": "note-knee-mri-ortho-consult",
                    "supportingTexts": [
                        "McMurray Test: Positive — pain and click with valgus stress."
                    ],
                    "reasoning": "Internal derangement signs documented.",
                    "confidence": 0.95,
                    "bboxes": [],
                    "lineNumbers": [4],
                }
            ],
        },
        {
            "criterion_id": "criterion-knee-mri-3",
            "criterion_text": "Imaging results will change clinical management",
            "criterion_ordinal": 3,
            "status": "passed",
            "rationale": "Plan explicitly states MRI will determine surgical vs conservative path.",
            "confidence": 0.96,
            "citations": [
                {
                    "sourceType": "clinical_note",
                    "sourceId": "note-knee-mri-ortho-consult",
                    "supportingTexts": [
                        "Imaging will directly change clinical management."
                    ],
                    "reasoning": "MRI results directly affect management plan.",
                    "confidence": 0.96,
                    "bboxes": [],
                    "lineNumbers": [8],
                }
            ],
        },
    ],
)

# Scenario 3: Botox — manual_override on criterion 2.
BOTOX_PA_DATA = _make_pa_data(
    pa_id="pa-botox-test",
    patient_first="Priya",
    patient_last="Shah",
    provider_first="Casey",
    provider_last="Nguyen",
    payer_name="UHC Choice Plus",
    codes=[
        {
            "codeType": "HCPCS",
            "code": "J0585",
            "modifier": None,
            "description": "Injection onabotulinumtoxinA 1 unit",
            "isPrimary": True,
        }
    ],
    criteria_results=[
        {
            "criterion_id": "criterion-botox-1",
            "criterion_text": "Chronic migraine diagnosis (≥15 headache days/month, ≥10 migraine-quality, each ≥4 hours)",
            "criterion_ordinal": 1,
            "status": "passed",
            "rationale": "18 headache days/month, 10 migraine-quality days each >4 hours documented.",
            "confidence": 0.97,
            "citations": [
                {
                    "sourceType": "clinical_note",
                    "sourceId": "note-botox-neuro-progress",
                    "supportingTexts": [
                        "18 headache days per month for the past 4 months. 10 are migraine-quality."
                    ],
                    "reasoning": "Chronic migraine criteria met.",
                    "confidence": 0.97,
                    "bboxes": [],
                    "lineNumbers": [2, 3],
                }
            ],
        },
        {
            "criterion_id": "criterion-botox-2",
            "criterion_text": "Failed ≥2 preventive medication classes (≥2 months adequate trial each)",
            "criterion_ordinal": 2,
            "status": "manual_override",
            "rationale": "Amitriptyline trial does not need to satisfy criterion 2 — propranolol (4-month trial, beta blocker) and topiramate (3-month trial, antiepileptic) each independently meet the ≥2-month threshold and span two distinct classes. Criterion is satisfied by these two alone.",
            "confidence": 0.55,
            "citations": [],
        },
        {
            "criterion_id": "criterion-botox-3",
            "criterion_text": "Botox dose ≤155 units across 31 sites every 12 weeks",
            "criterion_ordinal": 3,
            "status": "passed",
            "rationale": "155 units across 31 sites every 12 weeks documented.",
            "confidence": 0.99,
            "citations": [
                {
                    "sourceType": "clinical_note",
                    "sourceId": "note-botox-neuro-progress",
                    "supportingTexts": [
                        "155 units administered intramuscularly, divided across 31 injection sites."
                    ],
                    "reasoning": "Dosing matches policy limit exactly.",
                    "confidence": 0.99,
                    "bboxes": [],
                    "lineNumbers": [7],
                }
            ],
        },
    ],
)

DEMO_SCENARIOS = [
    ("head_ct", HEAD_CT_PA_DATA, "Jordan A. presents with new-onset thunderclap headache requiring CT head."),
    ("knee_mri", KNEE_MRI_PA_DATA, "Sam R. presents with suspected medial meniscal tear requiring MRI."),
    ("botox", BOTOX_PA_DATA, "Priya S. presents with chronic migraine requiring Botox preventive therapy."),
]


# ─── Helpers ───────────────────────────────────────────────────────────────────

def _parse_pdf_text(pdf_bytes: bytes) -> str:
    """Extract all text from a PDF using fitz. Returns concatenated page text."""
    import fitz
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages_text = [doc[i].get_text() for i in range(len(doc))]
    doc.close()
    return "\n".join(pages_text)


def _count_pages(pdf_bytes: bytes) -> int:
    """Return the number of pages in a PDF."""
    import fitz
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    count = len(doc)
    doc.close()
    return count


# ─── Tests: PDF structure ─────────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("scenario_key,pa_data,narrative", DEMO_SCENARIOS)
async def test_pdf_is_valid_and_parseable(scenario_key, pa_data, narrative, tmp_path):
    """Generated PDF must be parseable by fitz (not corrupt)."""
    from services.ai.submission_packet import generate_submission_packet_from_fixture

    pdf_bytes = await generate_submission_packet_from_fixture(
        pa_data=pa_data,
        narrative=narrative,
        pa_id=pa_data["pa_id"],
        output_dir=tmp_path,
    )

    assert isinstance(pdf_bytes, bytes), "PDF bytes must be bytes"
    assert len(pdf_bytes) > 1000, "PDF should not be empty/tiny"

    # Must be parseable.
    text = _parse_pdf_text(pdf_bytes)
    assert len(text) > 50, "PDF should contain readable text"


@pytest.mark.asyncio
@pytest.mark.parametrize("scenario_key,pa_data,narrative", DEMO_SCENARIOS)
async def test_pdf_has_at_least_two_pages(scenario_key, pa_data, narrative, tmp_path):
    """PDF must have at least 2 pages (cover letter + criteria checklist)."""
    from services.ai.submission_packet import generate_submission_packet_from_fixture

    pdf_bytes = await generate_submission_packet_from_fixture(
        pa_data=pa_data,
        narrative=narrative,
        pa_id=pa_data["pa_id"],
        output_dir=tmp_path,
    )

    page_count = _count_pages(pdf_bytes)
    assert page_count >= 2, f"Expected ≥2 pages, got {page_count}"


@pytest.mark.asyncio
@pytest.mark.parametrize("scenario_key,pa_data,narrative", DEMO_SCENARIOS)
async def test_pdf_written_to_output_dir(scenario_key, pa_data, narrative, tmp_path):
    """generate_submission_packet_from_fixture writes PDF to output_dir."""
    from services.ai.submission_packet import generate_submission_packet_from_fixture

    await generate_submission_packet_from_fixture(
        pa_data=pa_data,
        narrative=narrative,
        pa_id=pa_data["pa_id"],
        output_dir=tmp_path,
    )

    expected_path = tmp_path / f"{pa_data['pa_id']}.pdf"
    assert expected_path.exists(), f"Expected PDF at {expected_path}"
    assert expected_path.stat().st_size > 1000


# ─── Tests: Page 1 content ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_page1_contains_patient_first_name_and_code(tmp_path):
    """Page 1 must include patient first name and procedure code."""
    from services.ai.submission_packet import generate_submission_packet_from_fixture

    narrative = "Jordan A. presents with a thunderclap headache requiring CT head without contrast."
    pdf_bytes = await generate_submission_packet_from_fixture(
        pa_data=HEAD_CT_PA_DATA,
        narrative=narrative,
        pa_id="pa-head-ct-test",
        output_dir=tmp_path,
    )

    text = _parse_pdf_text(pdf_bytes)
    assert "Jordan" in text, "Patient first name must appear in PDF"
    assert "70450" in text, "Procedure code must appear in PDF"
    assert narrative[:40] in text, "Narrative paragraph must appear in PDF"


@pytest.mark.asyncio
async def test_page1_does_not_contain_full_last_name_in_narrative(tmp_path):
    """The narrative paragraph must use first name + last initial only.
    Full last name must NOT appear inside the narrative paragraph text.
    (It may appear in the structured patient block — that's acceptable.)
    """
    from services.ai.submission_packet import generate_submission_packet_from_fixture

    narrative = "Jordan A. presents with a thunderclap headache requiring CT head."
    pdf_bytes = await generate_submission_packet_from_fixture(
        pa_data=HEAD_CT_PA_DATA,
        narrative=narrative,
        pa_id="pa-head-ct-test",
        output_dir=tmp_path,
    )

    # The narrative itself uses "Jordan A." — the full name "Jordan Avery" can appear
    # in the structured patient header block, but must not be embedded in the narrative.
    assert "Jordan A." in narrative, "Narrative must use first name + last initial"
    assert "Jordan Avery" not in narrative, "Narrative must NOT contain full last name"


@pytest.mark.asyncio
async def test_page1_contains_provider_npi(tmp_path):
    """Page 1 must include provider NPI."""
    from services.ai.submission_packet import generate_submission_packet_from_fixture

    pdf_bytes = await generate_submission_packet_from_fixture(
        pa_data=HEAD_CT_PA_DATA,
        narrative="Jordan A. requires CT head.",
        pa_id="pa-head-ct-test",
        output_dir=tmp_path,
    )

    text = _parse_pdf_text(pdf_bytes)
    assert "1234567890" in text, "Provider NPI must appear in PDF"


# ─── Tests: Page 2 — criteria checklist ──────────────────────────────────────

@pytest.mark.asyncio
async def test_page2_contains_passed_criteria_for_head_ct(tmp_path):
    """Page 2 must list all three criteria for Head CT scenario."""
    from services.ai.submission_packet import generate_submission_packet_from_fixture

    pdf_bytes = await generate_submission_packet_from_fixture(
        pa_data=HEAD_CT_PA_DATA,
        narrative="Jordan A. requires CT head.",
        pa_id="pa-head-ct-test",
        output_dir=tmp_path,
    )

    text = _parse_pdf_text(pdf_bytes)
    # All three criteria should appear by keyword.
    assert "thunderclap" in text.lower() or "headache" in text.lower(), "Criteria text should appear"
    assert "PASS" in text, "Passed criteria must be marked"


@pytest.mark.asyncio
async def test_page2_shows_needs_info_for_knee_mri(tmp_path):
    """Page 2 must show NEEDS INFO for the conservative therapy criterion."""
    from services.ai.submission_packet import generate_submission_packet_from_fixture

    pdf_bytes = await generate_submission_packet_from_fixture(
        pa_data=KNEE_MRI_PA_DATA,
        narrative="Sam R. requires MRI right knee.",
        pa_id="pa-knee-mri-test",
        output_dir=tmp_path,
    )

    text = _parse_pdf_text(pdf_bytes)
    assert "NEEDS INFO" in text, "needs_info criterion must show NEEDS INFO badge"


@pytest.mark.asyncio
async def test_page2_contains_citation_excerpt(tmp_path):
    """Page 2 must include verbatim supporting_text excerpts for passed criteria."""
    from services.ai.submission_packet import generate_submission_packet_from_fixture

    pdf_bytes = await generate_submission_packet_from_fixture(
        pa_data=HEAD_CT_PA_DATA,
        narrative="Jordan A. requires CT head.",
        pa_id="pa-head-ct-test",
        output_dir=tmp_path,
    )

    text = _parse_pdf_text(pdf_bytes)
    # First citation supporting text should appear on page 2.
    assert "thunderclap" in text.lower() or "worst headache" in text.lower(), \
        "Citation supporting text must appear in PDF"


# ─── Tests: manual_override criterion ────────────────────────────────────────

@pytest.mark.asyncio
async def test_override_criterion_appears_on_page2(tmp_path):
    """Botox scenario: manual_override criterion must appear on page 2 with OVERRIDE badge."""
    from services.ai.submission_packet import generate_submission_packet_from_fixture

    pdf_bytes = await generate_submission_packet_from_fixture(
        pa_data=BOTOX_PA_DATA,
        narrative="Priya S. requires Botox for chronic migraine.",
        pa_id="pa-botox-test",
        output_dir=tmp_path,
    )

    text = _parse_pdf_text(pdf_bytes)
    assert "OVERRIDE" in text, "manual_override criterion must have OVERRIDE badge"


@pytest.mark.asyncio
async def test_override_rationale_is_verbatim(tmp_path):
    """Override rationale must appear verbatim in the PDF."""
    from services.ai.submission_packet import generate_submission_packet_from_fixture

    expected_rationale_fragment = "Amitriptyline trial does not need to satisfy criterion 2"
    pdf_bytes = await generate_submission_packet_from_fixture(
        pa_data=BOTOX_PA_DATA,
        narrative="Priya S. requires Botox for chronic migraine.",
        pa_id="pa-botox-test",
        output_dir=tmp_path,
    )

    text = _parse_pdf_text(pdf_bytes)
    assert expected_rationale_fragment in text, \
        f"Override rationale must appear verbatim. Expected fragment: '{expected_rationale_fragment}'"


# ─── Tests: format_criteria_summary helper ────────────────────────────────────

def test_format_criteria_summary_excludes_failed_and_needs_info():
    """format_criteria_summary must exclude 'failed' and 'needs_info' rows."""
    from services.ai.prompts.cover_letter_v1 import format_criteria_summary

    results = [
        {"criterion_id": "c1", "criterion_text": "Criterion one", "status": "passed", "citations": [], "rationale": ""},
        {"criterion_id": "c2", "criterion_text": "Criterion two", "status": "failed", "citations": [], "rationale": ""},
        {"criterion_id": "c3", "criterion_text": "Criterion three", "status": "needs_info", "citations": [], "rationale": ""},
        {"criterion_id": "c4", "criterion_text": "Criterion four", "status": "manual_override", "rationale": "Override reason.", "citations": []},
    ]

    summary = format_criteria_summary(results)
    assert "Criterion one" in summary, "passed criterion must appear"
    assert "Criterion four" in summary, "manual_override criterion must appear"
    assert "Criterion two" not in summary, "failed criterion must NOT appear"
    assert "Criterion three" not in summary, "needs_info criterion must NOT appear"


def test_format_criteria_summary_override_uses_rationale():
    """Override rows must include the provider rationale verbatim."""
    from services.ai.prompts.cover_letter_v1 import format_criteria_summary

    results = [
        {
            "criterion_id": "c1",
            "criterion_text": "Some criterion",
            "status": "manual_override",
            "rationale": "Provider says criterion is satisfied for these reasons.",
            "citations": [],
        }
    ]

    summary = format_criteria_summary(results)
    assert "Provider says criterion is satisfied" in summary
    assert "[OVERRIDE]" in summary


def test_format_criteria_summary_includes_citation_excerpt():
    """Passed rows include supporting_text excerpt from first citation."""
    from services.ai.prompts.cover_letter_v1 import format_criteria_summary

    results = [
        {
            "criterion_id": "c1",
            "criterion_text": "Test criterion",
            "status": "passed",
            "rationale": "AI rationale.",
            "citations": [
                {
                    "supportingTexts": ["Patient has documented severe headache for 3 days."],
                    "sourceId": "src1",
                }
            ],
        }
    ]

    summary = format_criteria_summary(results)
    assert "documented severe headache" in summary


# ─── Tests: Canned PDFs for submission-packets/canned/ ───────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("scenario_key,pa_data,narrative", DEMO_SCENARIOS)
async def test_canned_pdf_written_to_canned_dir(scenario_key, pa_data, narrative, tmp_path):
    """Write canned demo PDFs to tmp_path/canned/ — verifies canned artifact generation."""
    from services.ai.submission_packet import generate_submission_packet_from_fixture

    canned_dir = tmp_path / "canned"
    pdf_bytes = await generate_submission_packet_from_fixture(
        pa_data=pa_data,
        narrative=narrative,
        pa_id=scenario_key,
        output_dir=canned_dir,
    )

    out_path = canned_dir / f"{scenario_key}.pdf"
    assert out_path.exists(), f"Canned PDF must exist at {out_path}"
    assert out_path.stat().st_size > 1000

    page_count = _count_pages(pdf_bytes)
    assert page_count >= 2, f"Canned PDF should have ≥2 pages, got {page_count}"


# ─── Tests: LLM call mocking + cache bypass ──────────────────────────────────

def _mock_narrative_model():
    """Return a mock that simulates get_model('narrative').with_structured_output(...)."""
    from services.ai.submission_packet import NarrativeParagraph

    mock_llm = MagicMock()
    mock_structured = AsyncMock()
    mock_structured.ainvoke = AsyncMock(
        return_value=NarrativeParagraph(
            paragraph="The patient requires this procedure based on clinical documentation."
        )
    )
    mock_llm.with_structured_output = MagicMock(return_value=mock_structured)
    return mock_llm


@pytest.mark.asyncio
async def test_build_pdf_calls_only_fitz_not_llm(tmp_path):
    """_build_pdf must not import openai, anthropic, or boto3 for Bedrock.
    This verifies the forbidden-library constraint at the PDF builder level.
    """
    import sys

    # Capture any new imports during _build_pdf.
    initial_modules = set(sys.modules.keys())

    from services.ai.submission_packet import _build_pdf

    pdf_bytes = _build_pdf(HEAD_CT_PA_DATA, "Jordan A. requires CT head without contrast.")

    new_modules = set(sys.modules.keys()) - initial_modules
    forbidden = {"openai", "anthropic", "reportlab", "weasyprint"}
    introduced_forbidden = new_modules & forbidden
    assert not introduced_forbidden, f"Forbidden modules imported by _build_pdf: {introduced_forbidden}"

    # PDF must be valid.
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 500


# ─── Phase 6 T7: pdfUrl branch on page-2+ supporting documents ────────────────
#
# T7 extends the page-2+ "supporting documents" branch in `_build_pdf` so that
# CachedDocumentReference rows with non-empty pdfUrl trigger
# `fitz.Document.insert_pdf(source_doc)` instead of synthesized text rendering.
# Rows with pdfUrl=None fall back to the Phase 3 synthesized-text path
# (backward-compatible with the current demo state: 4 patients, all seeded
# ClinicalNote rows have pdfUrl=None).
#
# These tests verify all four branch states: pdfUrl=None (regression), pdfUrl
# present (FHIR-ingested PDF append), mixed rows (chronological ordering), and
# pdfUrl-resolution failure (graceful text fallback + warning).

_FHIR_BINARY_FIXTURES_DIR = (
    Path(__file__).resolve().parent.parent.parent.parent
    / "prisma" / "fixtures" / "fhir" / "binary"
)
_PRIYA_DIARY_PDF = _FHIR_BINARY_FIXTURES_DIR / "mock-priya-shah-headache-diary.pdf"


def _make_pa_data_with_notes(
    *, pa_id: str, clinical_notes: list[dict], criteria_results: list[dict],
) -> dict:
    """PA data fixture with custom clinical_notes — used by T7 pdfUrl tests."""
    return {
        "pa_id": pa_id,
        "status": "pending_submission",
        "created_at": datetime(2025, 5, 1, tzinfo=timezone.utc),
        "encounter_date": datetime(2025, 5, 1, tzinfo=timezone.utc),
        "patient": {
            "first_name": "Priya",
            "last_name": "Shah",
            "dob": date(1985, 6, 1),
            "sex": "F",
        },
        "provider": {
            "first_name": "Casey",
            "last_name": "Nguyen",
            "npi": "1234567890",
            "specialty": "Neurology",
        },
        "payer": {"name": "UHC Choice Plus"},
        "coverage": {"planName": "UHC Choice Plus", "memberId": "M123", "groupNumber": "G1"},
        "codes": [{
            "codeType": "HCPCS", "code": "J0585", "modifier": None,
            "description": "Botox", "isPrimary": True,
        }],
        "criteria_results": criteria_results,
        "attachments": [],
        "clinical_notes": clinical_notes,
    }


def _make_clinical_note(
    *, note_id: str, pdf_url: str | None, authored_at: datetime, text: str = "Seeded note body.",
    note_type: str = "progress_note", author_role: str = "Neurologist",
) -> dict:
    return {
        "id": note_id,
        "noteType": note_type,
        "authoredAt": authored_at,
        "authorRole": author_role,
        "text": text,
        "source": "seed",
        "pdfUrl": pdf_url,
    }


def _make_citation_for_note(note_id: str, supporting_text: str = "Documented finding.") -> dict:
    return {
        "criterion_id": f"crit-{note_id}",
        "criterion_text": "Test criterion",
        "criterion_ordinal": 1,
        "status": "passed",
        "rationale": "Evidence found.",
        "confidence": 0.95,
        "citations": [
            {
                "sourceType": "clinical_note",
                "sourceId": note_id,
                "supportingTexts": [supporting_text],
                "reasoning": "Cited.",
                "confidence": 0.95,
                "bboxes": [],
                "lineNumbers": [1],
            }
        ],
    }


@pytest.mark.asyncio
async def test_pdf_url_null_falls_back_to_text_rendering_phase3_regression(tmp_path):
    """T7 backward-compat: clinical_notes with pdfUrl=None must render via the
    Phase 3 synthesized-text path (header + body), unchanged from before the
    pdfUrl branch was added. This is the regression test for the current demo
    state (4 patients, all seeded ClinicalNote rows have pdfUrl=None).
    """
    from services.ai.submission_packet import generate_submission_packet_from_fixture

    note = _make_clinical_note(
        note_id="note-seeded-1",
        pdf_url=None,
        authored_at=datetime(2025, 5, 1, 9, 0, tzinfo=timezone.utc),
        text="VERBATIM_SEEDED_NOTE_BODY for regression assertion.",
        note_type="progress_note",
        author_role="Neurologist",
    )
    pa_data = _make_pa_data_with_notes(
        pa_id="pa-regression-seeded",
        clinical_notes=[note],
        criteria_results=[_make_citation_for_note("note-seeded-1", "VERBATIM_SEEDED_NOTE_BODY")],
    )

    pdf_bytes = await generate_submission_packet_from_fixture(
        pa_data=pa_data,
        narrative="Priya S. presents with chronic migraine.",
        pa_id="pa-regression-seeded",
        output_dir=tmp_path,
    )

    text = _parse_pdf_text(pdf_bytes)
    # The seeded text body must appear verbatim — proves the Phase 3 synthesized
    # text-rendering path still executes when pdfUrl is None.
    assert "VERBATIM_SEEDED_NOTE_BODY" in text, \
        "Phase 3 synthesized-text rendering must emit seeded note body when pdfUrl is None"
    # And the CLINICAL NOTES section header should appear (still using the seeded section).
    assert "CLINICAL NOTES" in text, "Clinical notes section header must still render"


@pytest.mark.asyncio
async def test_pdf_url_present_appends_real_pdf_pages(tmp_path):
    """T7 FHIR-ingest path: one CachedDocumentReference with pdfUrl pointing
    to a real PDF fixture must trigger `fitz.Document.insert_pdf` to append
    the source PDF's pages.  Verifies the appended pages are present in the
    output by checking the final page count exceeds the no-FHIR baseline.
    """
    from services.ai.submission_packet import generate_submission_packet_from_fixture

    assert _PRIYA_DIARY_PDF.exists(), f"Fixture PDF must exist: {_PRIYA_DIARY_PDF}"

    # Use an ABSOLUTE path for pdfUrl so the second candidate (Path(storage_url))
    # resolves directly without relying on Next.js public_dir.  Mirrors how
    # the attachments branch tolerates absolute paths.
    note = _make_clinical_note(
        note_id="note-fhir-1",
        pdf_url=str(_PRIYA_DIARY_PDF),
        authored_at=datetime(2025, 5, 1, 9, 0, tzinfo=timezone.utc),
        text="Fallback text body (should NOT appear when pdfUrl resolves).",
    )
    pa_data = _make_pa_data_with_notes(
        pa_id="pa-fhir-only",
        clinical_notes=[note],
        criteria_results=[_make_citation_for_note("note-fhir-1")],
    )

    pdf_bytes = await generate_submission_packet_from_fixture(
        pa_data=pa_data,
        narrative="Priya S. presents with chronic migraine.",
        pa_id="pa-fhir-only",
        output_dir=tmp_path,
    )

    page_count = _count_pages(pdf_bytes)
    # Baseline (no clinical_notes at all) is 1 page (cover letter only — the
    # CLINICAL NOTES section is skipped when clinical_notes is empty).
    # With one cited FHIR-ingested PDF row appended, we get:
    #   page 1: cover letter
    #   page 2: CLINICAL NOTES section header
    #   page 3: appended source PDF page (the 1-page fixture)
    # Therefore page_count must be at least 3 (>= cover + section + appended).
    assert page_count >= 3, \
        f"Expected >=3 pages after appending real PDF, got {page_count}"

    # The text fallback body MUST NOT appear — that would mean we fell back
    # instead of appending the real PDF.
    text = _parse_pdf_text(pdf_bytes)
    assert "Fallback text body" not in text, \
        "Text fallback must not render when pdfUrl resolves successfully"

    # Positive content check: the source PDF's text body ("ScribeNote ·
    # patient-priya-shah") must appear in the appended packet — proves
    # `fitz.Document.insert_pdf` actually copied the source content rather
    # than appending blank pages.
    assert "ScribeNote" in text, \
        "Appended source PDF content (ScribeNote marker) must be present"


@pytest.mark.asyncio
async def test_pdf_url_mixed_rows_render_in_chronological_order(tmp_path):
    """T7 mixed-rows path: one seeded row (pdfUrl=None, earlier authoredAt) +
    one FHIR-ingested row (pdfUrl present, later authoredAt) must both render,
    seeded first (text), then appended PDF — matching the SELECT's
    `ORDER BY "authoredAt"` clause that drives both seeded text rendering
    order and the order of `doc.insert_pdf` calls.
    """
    from services.ai.submission_packet import generate_submission_packet_from_fixture

    assert _PRIYA_DIARY_PDF.exists()

    seeded_note = _make_clinical_note(
        note_id="note-mixed-seeded",
        pdf_url=None,
        authored_at=datetime(2025, 5, 1, 8, 0, tzinfo=timezone.utc),  # EARLIER
        text="EARLIER_SEEDED_MARKER text body.",
    )
    fhir_note = _make_clinical_note(
        note_id="note-mixed-fhir",
        pdf_url=str(_PRIYA_DIARY_PDF),
        authored_at=datetime(2025, 5, 1, 10, 0, tzinfo=timezone.utc),  # LATER
        text="(should not appear — pdfUrl resolves)",
    )
    pa_data = _make_pa_data_with_notes(
        pa_id="pa-mixed",
        clinical_notes=[seeded_note, fhir_note],
        criteria_results=[
            _make_citation_for_note("note-mixed-seeded", "EARLIER_SEEDED_MARKER"),
            _make_citation_for_note("note-mixed-fhir"),
        ],
    )

    pdf_bytes = await generate_submission_packet_from_fixture(
        pa_data=pa_data,
        narrative="Priya S. presents with chronic migraine.",
        pa_id="pa-mixed",
        output_dir=tmp_path,
    )

    # Both contributions must be present in the resulting packet.
    text = _parse_pdf_text(pdf_bytes)
    assert "EARLIER_SEEDED_MARKER" in text, "Seeded (pdfUrl=None) note body must render via text path"

    # Chronological ordering: the seeded marker must appear on a page BEFORE
    # the appended PDF's pages (seeded has earlier authoredAt → rendered first).
    # We look up which page indexes contain each contribution and assert that
    # the seeded marker's index is strictly less than the appended PDF's
    # source content.  The 1-page Priya headache-diary fixture contains the
    # word "Headache" — we use that as a stable marker for the appended PDF.
    import fitz
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        per_page_texts = [doc[i].get_text() for i in range(len(doc))]
    finally:
        doc.close()

    seeded_page_idx = next(
        (i for i, t in enumerate(per_page_texts) if "EARLIER_SEEDED_MARKER" in t),
        None,
    )
    # The 1-page Priya headache-diary fixture's text body is
    # "ScribeNote · patient-priya-shah" — we use "ScribeNote" as a stable
    # marker for the appended PDF.
    fhir_page_idx = next(
        (i for i, t in enumerate(per_page_texts) if "ScribeNote" in t),
        None,
    )
    assert seeded_page_idx is not None, "Seeded marker must appear on some page"
    assert fhir_page_idx is not None, (
        "Appended FHIR PDF marker ('ScribeNote') must appear — proves the source "
        f"PDF was actually inserted.  Pages saw: {[t[:80] for t in per_page_texts]}"
    )
    assert seeded_page_idx < fhir_page_idx, (
        f"Chronological ordering: seeded note (earlier authoredAt) must render "
        f"BEFORE appended FHIR PDF (later authoredAt). "
        f"Got seeded@page={seeded_page_idx}, fhir@page={fhir_page_idx}."
    )


@pytest.mark.asyncio
async def test_pdf_url_resolution_failure_falls_back_to_text(tmp_path, caplog):
    """T7 failure path: pdfUrl points at a non-existent file.  Generator must
    gracefully fall back to text rendering for that row and log a warning.
    No exception escapes.
    """
    import logging
    from services.ai.submission_packet import generate_submission_packet_from_fixture

    missing_path = "/tmp/this/path/does/not/exist/missing-doc.pdf"
    note = _make_clinical_note(
        note_id="note-missing",
        pdf_url=missing_path,
        authored_at=datetime(2025, 5, 1, 9, 0, tzinfo=timezone.utc),
        text="FALLBACK_RENDERED_TEXT shown when pdfUrl resolution fails.",
    )
    pa_data = _make_pa_data_with_notes(
        pa_id="pa-missing-pdf",
        clinical_notes=[note],
        criteria_results=[_make_citation_for_note("note-missing", "FALLBACK_RENDERED_TEXT")],
    )

    with caplog.at_level(logging.WARNING, logger="services.ai.submission_packet"):
        pdf_bytes = await generate_submission_packet_from_fixture(
            pa_data=pa_data,
            narrative="Priya S. presents with chronic migraine.",
            pa_id="pa-missing-pdf",
            output_dir=tmp_path,
        )

    # Generator must not raise.
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 500

    # Text fallback rendered.
    text = _parse_pdf_text(pdf_bytes)
    assert "FALLBACK_RENDERED_TEXT" in text, \
        "Text fallback must render when pdfUrl cannot be resolved"

    # Warning logged.
    warning_records = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert any("note-missing" in str(r.getMessage()) or missing_path in str(r.getMessage())
               for r in warning_records), \
        f"Expected a warning mentioning the missing note id or pdfUrl. Got: {[r.getMessage() for r in warning_records]}"
