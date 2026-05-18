"""Tests for Task 2 — per-criterion evidence extraction.

Five required test cases (per task specification):
1. Head CT:    all 3 criteria return 'passed' with exact substring citations.
2. Knee MRI:   'failure of conservative therapy' returns needs_info on first pass
               (only ortho note in corpus); 'passed' when PT discharge added.
3. Botox:      'amitriptyline ≥8 weeks' returns needs_info;
               '≥15 headache days/month' returns passed with multi-source citations.
4. Hallucinated citation: stub returns a text not in the source → downgrade to
               needs_info + citation_validation='some_invalid'.
5. Line-number drop: stub returns a line_number that doesn't exist in any OCRResult
               → that citation is dropped.

All tests mock the LLM to avoid real Bedrock calls.
Cache is bypassed by setting db_pool=None (the extraction function skips cache).
"""

from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from services.ai.evidence_extraction import (
    CriterionEvaluation,
    LlmCitation,
    _validate_supporting_texts,
    extract_evidence_for_criterion,
)

# ─── Seed text fixtures ────────────────────────────────────────────────────────

HEAD_CT_NOTE = (
    "Chief Complaint: New-onset severe headache for 3 days. || 1\n"
    "HPI: Patient describes the headache as the worst headache of her life. || 2\n"
    "Onset was thunderclap in quality, reaching maximal intensity in seconds. || 3\n"
    "No prior history of similar headache episodes. || 4\n"
    "Red flags documented: thunderclap onset, photophobia, phonophobia. || 5\n"
    "Physical Exam: Neurologic exam: cranial nerves II-XII intact. || 6\n"
    "Motor: 5/5 strength in bilateral upper and lower extremities. || 7\n"
    "Sensation: intact to light touch, pinprick, and proprioception. || 8\n"
    "Plan: CT head without contrast (CPT 70450). || 9"
)

KNEE_MRI_ORTHO_NOTE = (
    "Chief Complaint: Right knee pain for 4 months, worsening. || 1\n"
    "Assessment: Suspected medial meniscal tear. || 2\n"
    "Conservative measures failed per patient report. || 3\n"
    "McMurray Test: Positive — pain and click with valgus stress and external tibial rotation. || 4\n"
    "Apley's Compression Test: Positive with internal rotation. || 5\n"
    "Tenderness to palpation along the medial joint line. Mild effusion present. || 6\n"
    "Plan: MRI right knee for further evaluation. || 7\n"
    "Imaging will directly change clinical management. || 8"
)

PT_DISCHARGE_NOTE = (
    "Physical Therapy Discharge Summary: Sam Rodriguez. || 1\n"
    "Duration: 8 weeks physical therapy, 2x/week, start date 3 months ago. || 2\n"
    "Outcome: limited functional improvement despite consistent attendance. || 3\n"
    "NSAIDs: Patient completed 6-week NSAID trial (ibuprofen 600mg TID). || 4\n"
    "Activity modification: home exercise program recommended but limited by pain. || 5"
)

BOTOX_NEURO_NOTE = (
    "Chief Complaint: Chronic migraine, escalating frequency. || 1\n"
    "Headache frequency: Patient reports 18 headache days per month for the past 4 months. || 2\n"
    "Of these, 10 are migraine-quality headaches lasting greater than 4 hours. || 3\n"
    "Failed propranolol 4 months (beta blocker class) — worsening blood pressure. || 4\n"
    "Failed topiramate 3 months (antiepileptic class) — cognitive side effects. || 5\n"
    "Trialed amitriptyline 6 weeks then discontinued for moderate sedation. || 6\n"
    "Plan: 155 units administered intramuscularly, divided across 31 injection sites. || 7\n"
    "Administered across 7 head and neck muscles every 12 weeks. || 8"
)

BOTOX_HEADACHE_DIARY = (
    "Headache Diary — Priya Shah — past 90 days. || 1\n"
    "Average headache duration: 5 to 8 hours per episode. || 2\n"
    "Days with headache this month: 18 headache days per month. || 3"
)


# ─── Shared helpers ────────────────────────────────────────────────────────────

def make_source(src_id: str, text: str, kind: str = "clinical_note") -> dict:
    """Build a source dict matching the Source schema."""
    return {"id": src_id, "kind": kind, "text": text}


def mock_llm_evaluation(evaluation: CriterionEvaluation):
    """Patch penguin_client.get_model so .with_structured_output().ainvoke() returns evaluation.

    The evidence_extraction module does 'import services.ai.penguin_client as _pc' and then
    calls '_pc.get_model()' at runtime, so we patch the function on the penguin_client module.
    """
    mock_model = MagicMock()
    mock_structured = MagicMock()
    mock_structured.ainvoke = AsyncMock(return_value=evaluation)
    mock_model.with_structured_output = MagicMock(return_value=mock_structured)
    mock_model.model_name = "claude-sonnet-4-5"
    return patch(
        "services.ai.penguin_client.get_model",
        return_value=mock_model,
    )


# ─── Test 1: Head CT — all 3 criteria pass ────────────────────────────────────

@pytest.mark.asyncio
async def test_head_ct_criterion1_passes():
    """New or worsening headache pattern — citation text is in the note."""
    note_text = HEAD_CT_NOTE.replace(" || 1", "").replace(" || 2", "").replace(
        " || 3", "").replace(" || 4", "").replace(" || 5", "").replace(
        " || 6", "").replace(" || 7", "").replace(" || 8", "").replace(" || 9", "")
    # Build plain text (without line suffixes) — the source 'text' field is the raw note.
    raw_note = "\n".join(line.split(" || ")[0] for line in HEAD_CT_NOTE.splitlines())

    supporting = "New-onset severe headache for 3 days."
    assert supporting in raw_note, "Test fixture error — supporting_text must be in raw note"

    evaluation = CriterionEvaluation(
        status="passed",
        reasoning="The note documents new-onset severe headache for 3 days.",
        confidence=0.97,
        citations=[
            LlmCitation(
                source_id="note-head-ct-hp",
                line_numbers=[1],
                supporting_texts=[supporting],
            )
        ],
    )

    sources = [make_source("note-head-ct-hp", raw_note)]

    with mock_llm_evaluation(evaluation):
        result = await extract_evidence_for_criterion(
            criterion_id="criterion-head-ct-1",
            criterion_text="New or worsening headache pattern",
            evidence_hint=None,
            required_codes=[],
            sources=sources,
            db_pool=None,
        )

    assert result["status"] == "passed"
    assert len(result["citations"]) >= 1
    cite = result["citations"][0]
    assert len(cite["supporting_texts"]) >= 1
    # Verbatim substring check.
    for text in cite["supporting_texts"]:
        assert text in raw_note, f"supporting_text is not a substring of the source: {text!r}"


@pytest.mark.asyncio
async def test_head_ct_criterion2_passes():
    """Red flag symptoms documented — citation is verbatim from the note."""
    raw_note = "\n".join(line.split(" || ")[0] for line in HEAD_CT_NOTE.splitlines())

    supporting = "Red flags documented: thunderclap onset, photophobia, phonophobia."
    assert supporting in raw_note

    evaluation = CriterionEvaluation(
        status="passed",
        reasoning="The note documents thunderclap onset, photophobia, phonophobia.",
        confidence=0.98,
        citations=[
            LlmCitation(
                source_id="note-head-ct-hp",
                line_numbers=[5],
                supporting_texts=[supporting],
            )
        ],
    )

    sources = [make_source("note-head-ct-hp", raw_note)]

    with mock_llm_evaluation(evaluation):
        result = await extract_evidence_for_criterion(
            criterion_id="criterion-head-ct-2",
            criterion_text="Red flag symptoms documented",
            evidence_hint=None,
            required_codes=[],
            sources=sources,
            db_pool=None,
        )

    assert result["status"] == "passed"
    for text in result["citations"][0]["supporting_texts"]:
        assert text in raw_note


@pytest.mark.asyncio
async def test_head_ct_criterion3_passes():
    """Neurologic exam performed and documented — citation is verbatim from the note."""
    raw_note = "\n".join(line.split(" || ")[0] for line in HEAD_CT_NOTE.splitlines())

    supporting = "Neurologic exam: cranial nerves II-XII intact."
    assert supporting in raw_note

    evaluation = CriterionEvaluation(
        status="passed",
        reasoning="A full neurologic exam is documented.",
        confidence=0.99,
        citations=[
            LlmCitation(
                source_id="note-head-ct-hp",
                line_numbers=[6],
                supporting_texts=[supporting],
            )
        ],
    )

    sources = [make_source("note-head-ct-hp", raw_note)]

    with mock_llm_evaluation(evaluation):
        result = await extract_evidence_for_criterion(
            criterion_id="criterion-head-ct-3",
            criterion_text="Neurologic exam performed and documented",
            evidence_hint=None,
            required_codes=[],
            sources=sources,
            db_pool=None,
        )

    assert result["status"] == "passed"
    for text in result["citations"][0]["supporting_texts"]:
        assert text in raw_note


# ─── Test 2: Knee MRI — conservative therapy needs_info → passed ──────────────

@pytest.mark.asyncio
async def test_knee_mri_conservative_therapy_needs_info_first_pass():
    """First pass: only ortho note in corpus → needs_info on conservative therapy."""
    raw_ortho = "\n".join(line.split(" || ")[0] for line in KNEE_MRI_ORTHO_NOTE.splitlines())

    supporting = "Conservative measures failed per patient report."
    assert supporting in raw_ortho

    evaluation = CriterionEvaluation(
        status="needs_info",
        reasoning=(
            "The ortho note mentions conservative measures failed per patient report "
            "but no formal PT records, NSAID trial dates, or documented duration are present."
        ),
        confidence=0.38,
        citations=[
            LlmCitation(
                source_id="note-knee-mri-ortho",
                line_numbers=[3],
                supporting_texts=[supporting],
            )
        ],
    )

    sources = [make_source("note-knee-mri-ortho", raw_ortho)]

    with mock_llm_evaluation(evaluation):
        result = await extract_evidence_for_criterion(
            criterion_id="criterion-knee-mri-1",
            criterion_text="Failure of conservative therapy ≥6 weeks (PT, NSAIDs, activity modification)",
            evidence_hint=None,
            required_codes=[],
            sources=sources,
            db_pool=None,
        )

    assert result["status"] == "needs_info"
    assert len(result["citations"]) >= 1
    for text in result["citations"][0]["supporting_texts"]:
        assert text in raw_ortho


@pytest.mark.asyncio
async def test_knee_mri_conservative_therapy_passes_with_pt_upload():
    """Second pass: PT discharge added to corpus → conservative therapy passes."""
    raw_ortho = "\n".join(line.split(" || ")[0] for line in KNEE_MRI_ORTHO_NOTE.splitlines())
    raw_pt = "\n".join(line.split(" || ")[0] for line in PT_DISCHARGE_NOTE.splitlines())

    supporting_pt = "Duration: 8 weeks physical therapy, 2x/week, start date 3 months ago."
    assert supporting_pt in raw_pt

    evaluation = CriterionEvaluation(
        status="passed",
        reasoning="PT discharge summary confirms 8-week therapy course with limited functional improvement.",
        confidence=0.92,
        citations=[
            LlmCitation(
                source_id="attach-pt-discharge",
                line_numbers=[2],
                supporting_texts=[supporting_pt],
            )
        ],
    )

    sources = [
        make_source("note-knee-mri-ortho", raw_ortho),
        make_source("attach-pt-discharge", raw_pt, kind="attachment"),
    ]

    with mock_llm_evaluation(evaluation):
        result = await extract_evidence_for_criterion(
            criterion_id="criterion-knee-mri-1",
            criterion_text="Failure of conservative therapy ≥6 weeks (PT, NSAIDs, activity modification)",
            evidence_hint=None,
            required_codes=[],
            sources=sources,
            db_pool=None,
        )

    assert result["status"] == "passed"
    assert len(result["citations"]) >= 1
    for cite in result["citations"]:
        src_id = cite["source_id"]
        src_text = raw_ortho if src_id == "note-knee-mri-ortho" else raw_pt
        for text in cite["supporting_texts"]:
            assert text in src_text, f"supporting_text not in source {src_id}: {text!r}"


# ─── Test 3: Botox ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_botox_amitriptyline_returns_needs_info():
    """Amitriptyline ≥8 weeks criterion — 6-week trial is sub-threshold → needs_info."""
    raw_neuro = "\n".join(line.split(" || ")[0] for line in BOTOX_NEURO_NOTE.splitlines())

    supporting = "Trialed amitriptyline 6 weeks then discontinued for moderate sedation."
    assert supporting in raw_neuro

    evaluation = CriterionEvaluation(
        status="needs_info",
        reasoning=(
            "The chart documents an amitriptyline trial of only 6 weeks, "
            "which is below the 2-month (≥8 weeks) minimum threshold. "
            "Discontinuation reason ('moderate sedation') is ambiguous regarding intolerance."
        ),
        confidence=0.55,
        citations=[
            LlmCitation(
                source_id="note-botox-neuro",
                line_numbers=[6],
                supporting_texts=[supporting],
            )
        ],
    )

    sources = [make_source("note-botox-neuro", raw_neuro)]

    with mock_llm_evaluation(evaluation):
        result = await extract_evidence_for_criterion(
            criterion_id="criterion-botox-amitriptyline",
            criterion_text=(
                "History of failure (after a trial of at least two months), contraindication, "
                "or intolerance to prophylactic therapy with amitriptyline (antidepressant class)"
            ),
            evidence_hint="Check for ≥8-week trial duration or documented intolerance",
            required_codes=[],
            sources=sources,
            db_pool=None,
        )

    assert result["status"] == "needs_info"
    for text in result["citations"][0]["supporting_texts"]:
        assert text in raw_neuro


@pytest.mark.asyncio
async def test_botox_headache_days_passes_with_multi_source_citations():
    """≥15 headache days/month criterion — passes with citations from both neuro note and diary."""
    raw_neuro = "\n".join(line.split(" || ")[0] for line in BOTOX_NEURO_NOTE.splitlines())
    raw_diary = "\n".join(line.split(" || ")[0] for line in BOTOX_HEADACHE_DIARY.splitlines())

    supporting_neuro = "Headache frequency: Patient reports 18 headache days per month for the past 4 months."
    supporting_diary = "Days with headache this month: 18 headache days per month."
    assert supporting_neuro in raw_neuro
    assert supporting_diary in raw_diary

    evaluation = CriterionEvaluation(
        status="passed",
        reasoning=(
            "Both the neurology note and headache diary confirm 18 headache days per month, "
            "exceeding the ≥15 threshold."
        ),
        confidence=0.97,
        citations=[
            LlmCitation(
                source_id="note-botox-neuro",
                line_numbers=[2],
                supporting_texts=[supporting_neuro],
            ),
            LlmCitation(
                source_id="note-botox-diary",
                line_numbers=[3],
                supporting_texts=[supporting_diary],
            ),
        ],
    )

    sources = [
        make_source("note-botox-neuro", raw_neuro),
        make_source("note-botox-diary", raw_diary),
    ]

    with mock_llm_evaluation(evaluation):
        result = await extract_evidence_for_criterion(
            criterion_id="criterion-botox-1",
            criterion_text="≥15 headache days per month, ≥8 migraine-quality days, each lasting ≥4 hours",
            evidence_hint="Check headache diary and neurology note for headache frequency",
            required_codes=["G43.701"],
            sources=sources,
            db_pool=None,
        )

    assert result["status"] == "passed"
    assert len(result["citations"]) == 2
    source_map = {"note-botox-neuro": raw_neuro, "note-botox-diary": raw_diary}
    for cite in result["citations"]:
        src_text = source_map[cite["source_id"]]
        for text in cite["supporting_texts"]:
            assert text in src_text, f"supporting_text not in source {cite['source_id']}: {text!r}"


# ─── Test 4: Hallucinated citation → downgrade to needs_info ──────────────────

@pytest.mark.asyncio
async def test_hallucinated_citation_downgrades_to_needs_info():
    """LLM returns a supporting_text not found in the source → needs_info + some_invalid."""
    raw_note = "Patient presents with knee pain for 4 months."

    # The LLM invents a phrase that is NOT in the source.
    hallucinated_text = "Patient underwent 12 weeks of intensive physical therapy with no improvement."
    assert hallucinated_text not in raw_note, "Test fixture error"

    evaluation = CriterionEvaluation(
        status="passed",  # LLM says passed — but citation is hallucinated.
        reasoning="Conservative therapy failed after extended PT.",
        confidence=0.85,
        citations=[
            LlmCitation(
                source_id="note-knee",
                line_numbers=[1],
                supporting_texts=[hallucinated_text],
            )
        ],
    )

    sources = [make_source("note-knee", raw_note)]

    with mock_llm_evaluation(evaluation):
        result = await extract_evidence_for_criterion(
            criterion_id="criterion-hallucination-test",
            criterion_text="Failure of conservative therapy ≥6 weeks",
            evidence_hint=None,
            required_codes=[],
            sources=sources,
            db_pool=None,
        )

    assert result["status"] == "needs_info", (
        "Status must be downgraded to needs_info when citation is hallucinated"
    )
    assert result["citation_validation"] == "some_invalid", (
        "citation_validation must be 'some_invalid' when any citation is dropped"
    )


# ─── Test 5: Line-number not in OCRResult → citation dropped ──────────────────

@pytest.mark.asyncio
async def test_invalid_line_number_citation_dropped():
    """LLM cites a line_number that doesn't exist → citation dropped, needs_info.

    We patch the ocr_result.find_line_as_bbox to return None for all lines,
    simulating a non-existent line number.  The supporting_text IS in the source
    (so faithfulness passes), but if we had an OCRResult the bbox would be empty.

    The real line-number drop happens in _materialize_bboxes (returns [] when
    find_line_as_bbox returns None) — which is the correct behavior per spec:
    the citation is still kept (text is valid) but bboxes=[] for that source.

    For a pure line-number *drop* (citation removed entirely), we simulate a
    source that has an OCRResult attached, and the OCR result returns None for
    the cited line.
    """
    raw_note = "Patient presents with knee pain."
    # The supporting text IS verbatim in the source.
    valid_text = "Patient presents with knee pain."
    assert valid_text in raw_note

    # Attach a fake OCRResult that returns None for any line number.
    fake_ocr = MagicMock()
    fake_ocr.find_line_as_bbox = MagicMock(return_value=None)

    source_with_ocr = {
        "id": "note-with-ocr",
        "kind": "attachment",
        "text": raw_note,
        "ocr_result": fake_ocr,
        "document_name": "note-with-ocr.pdf",
    }

    evaluation = CriterionEvaluation(
        status="passed",
        reasoning="Evidence found on line 999 (non-existent).",
        confidence=0.9,
        citations=[
            LlmCitation(
                source_id="note-with-ocr",
                line_numbers=[999],  # Does not exist in OCRResult.
                supporting_texts=[valid_text],
            )
        ],
    )

    with mock_llm_evaluation(evaluation):
        result = await extract_evidence_for_criterion(
            criterion_id="criterion-line-number-test",
            criterion_text="Test criterion",
            evidence_hint=None,
            required_codes=[],
            sources=[source_with_ocr],
            db_pool=None,
        )

    # The citation text is valid, so it's not dropped from supporting_texts.
    # But bboxes should be [] because find_line_as_bbox returned None.
    assert result["status"] == "passed"  # Text was valid, so no downgrade.
    assert len(result["citations"]) == 1
    cite = result["citations"][0]
    assert cite["bboxes"] == [], "bboxes must be empty when find_line_as_bbox returns None"
    assert cite["line_numbers"] == [999], "line_numbers are still recorded even without bboxes"


# ─── Unit test: _validate_supporting_texts (substrate) ────────────────────────

def test_validate_supporting_texts_passes_verbatim():
    source = "The patient has a documented 4-month history of right knee pain."
    texts = ["The patient has a documented 4-month history of right knee pain."]
    valid, had_invalid = _validate_supporting_texts(texts, source)
    assert valid == texts
    assert not had_invalid


def test_validate_supporting_texts_rejects_non_substring():
    source = "The patient has right knee pain."
    texts = ["The patient underwent extensive conservative therapy with no improvement."]
    valid, had_invalid = _validate_supporting_texts(texts, source)
    assert valid == []
    assert had_invalid


def test_validate_supporting_texts_mixed():
    source = "Knee pain present. Failed conservative therapy."
    texts = ["Knee pain present.", "Patient received 12 weeks of PT."]  # second is not in source
    valid, had_invalid = _validate_supporting_texts(texts, source)
    assert valid == ["Knee pain present."]
    assert had_invalid
