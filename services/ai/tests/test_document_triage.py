"""Tests for Phase 6 — document triage.

Run: pytest services/ai/tests/test_document_triage.py -v

Coverage (per ticket spec + override §11):
  1. Empty documents list → empty scores, NO LLM call.
  2. One document → still triaged (no short-circuit).
  3. Synthetic 10 docs × 3 criteria → relevant docs ranked above irrelevant.
  4. Exactly N_criteria Haiku calls (not N_criteria × N_docs).
  5. Cache: repeat with same input → cached=True, NO LLM call.
  6. Cache: same docs in different order → still cached (canonical sort).
  7. Sparse snippet → recommended_for_extraction=True regardless of score.
  8. Threshold/top-K filter: vary threshold; (precision, recall) baseline.
  9. Auth: POST /triage-documents 401s without bearer.

All tests mock the Haiku LLM to avoid real Bedrock calls.
DB pool is mocked or `None` per the test's intent.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.ai.document_triage import (
    CriterionMeta,
    DocMeta,
    RelevanceScore,
    RelevanceScores,
    SPARSE_SNIPPET_THRESHOLD,
    TriageRequest,
    score_relevance,
)


# ─── Synthetic fixture: 10 documents, 3 criteria ──────────────────────────────
# Relevant docs have keywords matching the criterion; irrelevant docs are
# unrelated chart entries (dental, eye exam, pediatric vaccination, etc.).


CRITERION_MIGRAINE = CriterionMeta(
    id="crit-migraine",
    text="≥15 headache days per month, ≥8 migraine-quality days, each lasting ≥4 hours",
    evidence_hint="Check headache diary or neurology note for monthly headache frequency",
    required_codes=["G43.701"],
)

CRITERION_PT_TRIAL = CriterionMeta(
    id="crit-pt-trial",
    text="Failure of conservative therapy ≥6 weeks (physical therapy, NSAIDs, activity modification)",
    evidence_hint="Look for PT discharge summary, NSAID trial dates, or pain-management plan",
    required_codes=[],
)

CRITERION_NEURO_EXAM = CriterionMeta(
    id="crit-neuro-exam",
    text="Neurologic examination performed and documented",
    evidence_hint="Cranial nerves, motor strength, sensation, coordination",
    required_codes=[],
)

SYN_CRITERIA = [CRITERION_MIGRAINE, CRITERION_PT_TRIAL, CRITERION_NEURO_EXAM]

# 10 synthetic documents.  Truth labels per criterion below.
SYN_DOCS = [
    # Relevant to migraine criterion only.
    DocMeta(
        id="doc-neuro-progress",
        fhir_id="fhir-doc-001",
        doc_type="Progress Note",
        author_role="Neurologist",
        authored_at="2026-02-14",
        snippet=(
            "Patient reports 18 headache days per month for the past 4 months. "
            "10 are migraine-quality lasting greater than 4 hours."
        ),
    ),
    DocMeta(
        id="doc-headache-diary",
        fhir_id="fhir-doc-002",
        doc_type="Patient Diary",
        author_role="Patient",
        authored_at="2026-02-20",
        snippet="Headache diary past 90 days: average 17 headache days per month, duration 5-8 hours.",
    ),
    # Relevant to PT trial criterion only.
    DocMeta(
        id="doc-pt-discharge",
        fhir_id="fhir-doc-003",
        doc_type="Therapy Summary",
        author_role="Physical Therapist",
        authored_at="2026-01-05",
        snippet=(
            "Physical Therapy Discharge Summary: 8 weeks of PT, 2x/week, limited functional improvement. "
            "NSAID trial 6 weeks (ibuprofen 600mg TID)."
        ),
    ),
    DocMeta(
        id="doc-ortho-consult",
        fhir_id="fhir-doc-004",
        doc_type="Consult",
        author_role="Orthopedic Surgeon",
        authored_at="2026-01-20",
        snippet="Conservative measures failed per patient report. NSAID and home exercise program tried.",
    ),
    # Relevant to neuro exam criterion only.
    DocMeta(
        id="doc-neuro-exam",
        fhir_id="fhir-doc-005",
        doc_type="Physical Exam",
        author_role="Neurologist",
        authored_at="2026-02-14",
        snippet=(
            "Neurologic examination: cranial nerves II-XII intact. Motor 5/5 bilateral. "
            "Sensation intact. Coordination normal. No focal deficits."
        ),
    ),
    # Irrelevant: dental visit.
    DocMeta(
        id="doc-dental",
        fhir_id="fhir-doc-006",
        doc_type="Dental Visit",
        author_role="Dentist",
        authored_at="2024-08-10",
        snippet="Routine cleaning. No new caries. Floss daily, brush twice daily, return in 6 months.",
    ),
    # Irrelevant: vision exam.
    DocMeta(
        id="doc-vision",
        fhir_id="fhir-doc-007",
        doc_type="Vision Exam",
        author_role="Optometrist",
        authored_at="2024-09-15",
        snippet="Refraction stable, prescription unchanged. No signs of glaucoma. RTC 1 year.",
    ),
    # Irrelevant: derm visit.
    DocMeta(
        id="doc-derm",
        fhir_id="fhir-doc-008",
        doc_type="Dermatology Visit",
        author_role="Dermatologist",
        authored_at="2024-06-30",
        snippet="Skin tag removal on neck. Wound cleaned and dressed. No further treatment needed.",
    ),
    # Irrelevant: pediatric vaccination.
    DocMeta(
        id="doc-vaccine",
        fhir_id="fhir-doc-009",
        doc_type="Immunization",
        author_role="Pediatrician",
        authored_at="2020-10-12",
        snippet="Annual flu vaccine administered. No adverse reactions. Follow vaccination schedule.",
    ),
    # Irrelevant: foot orthotic fitting.
    DocMeta(
        id="doc-podiatry",
        fhir_id="fhir-doc-010",
        doc_type="Podiatry Visit",
        author_role="Podiatrist",
        authored_at="2024-04-22",
        snippet="Custom orthotic fitting for plantar fasciitis. No surgical intervention indicated.",
    ),
]

# Ground-truth labels: which doc IDs are RELEVANT per criterion.
SYN_TRUTH: dict[str, set[str]] = {
    "crit-migraine": {"doc-neuro-progress", "doc-headache-diary"},
    "crit-pt-trial": {"doc-pt-discharge", "doc-ortho-consult"},
    "crit-neuro-exam": {"doc-neuro-exam", "doc-neuro-progress"},
}


# ─── LLM mock helpers ─────────────────────────────────────────────────────────


def _truth_based_llm_scores(criterion_id: str, docs: list[DocMeta]) -> RelevanceScores:
    """Generate RelevanceScores reflecting the synthetic truth labels.

    Relevant docs get score=0.9, irrelevant docs get score=0.1.
    This simulates a well-behaved Haiku triage call.
    """
    truth = SYN_TRUTH[criterion_id]
    return RelevanceScores(
        scores=[
            RelevanceScore(
                criterion_id=criterion_id,
                document_id=d.id,
                score=0.9 if d.id in truth else 0.1,
                reasoning=(
                    f"Matches keywords for {criterion_id}." if d.id in truth
                    else f"No clear connection to {criterion_id}."
                ),
                # The handler recomputes recommended_for_extraction after top-K/threshold,
                # but we still emit something so the field round-trips.
                recommended_for_extraction=d.id in truth,
            )
            for d in docs
        ]
    )


class _LlmCallCounter:
    """Tracks how many times structured_model.ainvoke is called."""

    def __init__(self):
        self.calls: list[Any] = []

    def make_mock_model(self, score_fn):
        """score_fn(messages) -> RelevanceScores"""
        mock_model = MagicMock()
        mock_structured = MagicMock()

        async def _ainvoke(messages):
            self.calls.append(messages)
            return score_fn(messages)

        mock_structured.ainvoke = AsyncMock(side_effect=_ainvoke)
        mock_model.with_structured_output = MagicMock(return_value=mock_structured)
        mock_model.model_name = "claude-haiku-4-5"
        return mock_model


def _extract_criterion_id_from_messages(messages) -> str:
    """Pull the criterion_id out of the user message for routing scores."""
    user_msg = messages[-1].content
    # User template starts with "Criterion ID: <id>\n"
    first_line = user_msg.splitlines()[0]
    return first_line.split("Criterion ID:", 1)[1].strip()


# ─── Test 1: Empty documents → no LLM call ────────────────────────────────────


@pytest.mark.asyncio
async def test_empty_documents_returns_empty_and_no_llm_call():
    counter = _LlmCallCounter()
    mock_model = counter.make_mock_model(lambda _msgs: RelevanceScores(scores=[]))

    request = TriageRequest(
        criteria=SYN_CRITERIA,
        documents=[],
    )

    with patch("services.ai.penguin_client.get_model", return_value=mock_model):
        response = await score_relevance(request, db_pool=None)

    assert response.scores == []
    assert response.cached is False
    assert counter.calls == [], "No LLM call must be made when documents is empty"


@pytest.mark.asyncio
async def test_empty_criteria_returns_empty_and_no_llm_call():
    counter = _LlmCallCounter()
    mock_model = counter.make_mock_model(lambda _msgs: RelevanceScores(scores=[]))

    request = TriageRequest(criteria=[], documents=SYN_DOCS)

    with patch("services.ai.penguin_client.get_model", return_value=mock_model):
        response = await score_relevance(request, db_pool=None)

    assert response.scores == []
    assert counter.calls == []


# ─── Test 2: One document → still triaged ─────────────────────────────────────


@pytest.mark.asyncio
async def test_single_document_still_triaged_no_short_circuit():
    """Even with a single doc we still make exactly one Haiku call per criterion."""
    counter = _LlmCallCounter()
    single_doc = [SYN_DOCS[0]]  # The neuro progress note.

    def score_fn(messages):
        cid = _extract_criterion_id_from_messages(messages)
        return _truth_based_llm_scores(cid, single_doc)

    mock_model = counter.make_mock_model(score_fn)

    request = TriageRequest(criteria=SYN_CRITERIA, documents=single_doc)

    with patch("services.ai.penguin_client.get_model", return_value=mock_model):
        response = await score_relevance(request, db_pool=None)

    # 3 criteria → 3 calls, even though only 1 doc.
    assert len(counter.calls) == 3, "Single document must still flow through triage"
    assert len(response.scores) == 3  # 3 criteria * 1 doc.


# ─── Test 3: Relevant docs rank above irrelevant ──────────────────────────────


@pytest.mark.asyncio
async def test_relevant_docs_ranked_above_irrelevant():
    """For each criterion the LLM-relevant docs get the higher recommendation."""
    counter = _LlmCallCounter()

    def score_fn(messages):
        cid = _extract_criterion_id_from_messages(messages)
        return _truth_based_llm_scores(cid, SYN_DOCS)

    mock_model = counter.make_mock_model(score_fn)

    request = TriageRequest(criteria=SYN_CRITERIA, documents=SYN_DOCS)

    with patch("services.ai.penguin_client.get_model", return_value=mock_model):
        response = await score_relevance(request, db_pool=None)

    # Sanity: we have all (criterion, doc) combos.
    assert len(response.scores) == 3 * 10

    by_criterion: dict[str, list[RelevanceScore]] = {}
    for s in response.scores:
        by_criterion.setdefault(s.criterion_id, []).append(s)

    for criterion_id, expected_relevant in SYN_TRUTH.items():
        scores = by_criterion[criterion_id]
        for s in scores:
            if s.document_id in expected_relevant:
                assert s.score >= 0.5, (
                    f"Relevant doc {s.document_id} for {criterion_id} "
                    f"unexpectedly scored low: {s.score}"
                )
                assert s.recommended_for_extraction, (
                    f"Relevant doc {s.document_id} for {criterion_id} "
                    "should be recommended for extraction"
                )
            else:
                # Irrelevant doc — score must be lower than every relevant doc.
                rel_scores = [r.score for r in scores if r.document_id in expected_relevant]
                if rel_scores:
                    assert s.score < min(rel_scores), (
                        f"Irrelevant doc {s.document_id} outranks a relevant one"
                    )


# ─── Test 4: Exactly N_criteria Haiku calls ───────────────────────────────────


@pytest.mark.asyncio
async def test_cost_exactly_n_criteria_llm_calls():
    """At 10 docs × 3 criteria, we expect EXACTLY 3 Haiku calls, not 30."""
    counter = _LlmCallCounter()

    def score_fn(messages):
        cid = _extract_criterion_id_from_messages(messages)
        return _truth_based_llm_scores(cid, SYN_DOCS)

    mock_model = counter.make_mock_model(score_fn)

    request = TriageRequest(criteria=SYN_CRITERIA, documents=SYN_DOCS)

    with patch("services.ai.penguin_client.get_model", return_value=mock_model):
        await score_relevance(request, db_pool=None)

    assert len(counter.calls) == len(SYN_CRITERIA), (
        f"Expected exactly {len(SYN_CRITERIA)} LLM calls (one per criterion), "
        f"got {len(counter.calls)} — this looks like per-(criterion, doc) batching!"
    )


# ─── Test 5: Cache hit on repeat ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_cache_hit_on_repeat_invocation_no_llm_call():
    """Second triage with same input → served from ai_call_cache; no LLM call."""
    counter = _LlmCallCounter()

    def score_fn(messages):
        cid = _extract_criterion_id_from_messages(messages)
        return _truth_based_llm_scores(cid, SYN_DOCS)

    mock_model = counter.make_mock_model(score_fn)

    # Fake ai_call_cache backed by an in-memory dict.
    cache_store: dict[tuple, dict] = {}

    async def fake_get_cached(_pool, *, task, prompt_version, model, input_hash):
        return cache_store.get((task, prompt_version, model, input_hash))

    async def fake_set_cached(_pool, *, task, prompt_version, model, input_hash, response, traced_to=None):
        cache_store[(task, prompt_version, model, input_hash)] = response

    fake_pool = MagicMock()

    request = TriageRequest(criteria=SYN_CRITERIA, documents=SYN_DOCS)

    with patch("services.ai.penguin_client.get_model", return_value=mock_model), patch(
        "services.ai.document_triage.get_cached", new=fake_get_cached
    ), patch("services.ai.document_triage.set_cached", new=fake_set_cached):

        # First pass: 3 LLM calls (one per criterion), cache populated.
        first = await score_relevance(request, db_pool=fake_pool)
        assert len(counter.calls) == 3
        assert first.cached is False

        # Second pass: 0 new LLM calls — everything served from cache.
        second = await score_relevance(request, db_pool=fake_pool)
        assert len(counter.calls) == 3, "Second call must not invoke LLM"
        assert second.cached is True

    # Scores must round-trip identically.
    first_by_pair = {(s.criterion_id, s.document_id): s.score for s in first.scores}
    second_by_pair = {(s.criterion_id, s.document_id): s.score for s in second.scores}
    assert first_by_pair == second_by_pair


# ─── Test 6: Cache hit with shuffled doc order ────────────────────────────────


@pytest.mark.asyncio
async def test_cache_hit_with_docs_in_different_order():
    """Canonical sort by fhir_id means input order doesn't matter for cache key."""
    counter = _LlmCallCounter()

    def score_fn(messages):
        cid = _extract_criterion_id_from_messages(messages)
        return _truth_based_llm_scores(cid, SYN_DOCS)

    mock_model = counter.make_mock_model(score_fn)

    cache_store: dict[tuple, dict] = {}

    async def fake_get_cached(_pool, *, task, prompt_version, model, input_hash):
        return cache_store.get((task, prompt_version, model, input_hash))

    async def fake_set_cached(_pool, *, task, prompt_version, model, input_hash, response, traced_to=None):
        cache_store[(task, prompt_version, model, input_hash)] = response

    fake_pool = MagicMock()

    request_normal = TriageRequest(criteria=SYN_CRITERIA, documents=SYN_DOCS)
    # Reverse order: caller can hand us docs in any order.
    request_shuffled = TriageRequest(criteria=SYN_CRITERIA, documents=list(reversed(SYN_DOCS)))

    with patch("services.ai.penguin_client.get_model", return_value=mock_model), patch(
        "services.ai.document_triage.get_cached", new=fake_get_cached
    ), patch("services.ai.document_triage.set_cached", new=fake_set_cached):

        await score_relevance(request_normal, db_pool=fake_pool)
        assert len(counter.calls) == 3

        shuffled = await score_relevance(request_shuffled, db_pool=fake_pool)
        assert len(counter.calls) == 3, (
            "Shuffled doc order must serve from cache — canonical sort must run"
        )
        assert shuffled.cached is True


# ─── Test 7: Sparse snippet → inclusion-bias overrides ────────────────────────


@pytest.mark.asyncio
async def test_sparse_snippet_forces_recommended_true():
    """When the snippet is shorter than SPARSE_SNIPPET_THRESHOLD chars, default to include."""
    counter = _LlmCallCounter()

    sparse_docs = [
        DocMeta(
            id="doc-sparse",
            fhir_id="fhir-sparse-001",
            doc_type="Note",
            author_role="Clinician",
            authored_at="2026-01-01",
            snippet="OCR fail.",  # under threshold.
        ),
        DocMeta(
            id="doc-rich",
            fhir_id="fhir-sparse-002",
            doc_type="Note",
            author_role="Neurologist",
            authored_at="2026-01-02",
            snippet="Detailed neurology note documenting cranial nerve exam and motor strength assessment.",
        ),
    ]

    # LLM scores sparse doc low; we want the handler's inclusion bias to override.
    def score_fn(_messages):
        return RelevanceScores(
            scores=[
                RelevanceScore(
                    criterion_id="crit-neuro-exam",
                    document_id="doc-sparse",
                    score=0.05,
                    reasoning="Snippet too short to evaluate.",
                    recommended_for_extraction=False,
                ),
                RelevanceScore(
                    criterion_id="crit-neuro-exam",
                    document_id="doc-rich",
                    score=0.95,
                    reasoning="Documents the criterion directly.",
                    recommended_for_extraction=True,
                ),
            ]
        )

    mock_model = counter.make_mock_model(score_fn)

    assert len(sparse_docs[0].snippet) < SPARSE_SNIPPET_THRESHOLD

    request = TriageRequest(
        criteria=[CRITERION_NEURO_EXAM],
        documents=sparse_docs,
    )

    with patch("services.ai.penguin_client.get_model", return_value=mock_model):
        response = await score_relevance(request, db_pool=None)

    sparse_score = next(s for s in response.scores if s.document_id == "doc-sparse")
    rich_score = next(s for s in response.scores if s.document_id == "doc-rich")
    assert sparse_score.recommended_for_extraction is True, (
        "Sparse snippet must default to recommended_for_extraction=True regardless of LLM score"
    )
    assert rich_score.recommended_for_extraction is True


# ─── Test 8: Threshold / top-K filter — precision/recall baseline ─────────────


@pytest.mark.asyncio
async def test_threshold_and_topk_precision_recall_report(capsys):
    """Vary threshold; print (precision, recall) for the synthetic dataset.

    This is a baseline for future threshold tuning.  We DON'T assert a
    specific number — we report so the eval suite can carry the threshold.
    """

    def score_fn(messages):
        cid = _extract_criterion_id_from_messages(messages)
        return _truth_based_llm_scores(cid, SYN_DOCS)

    counter = _LlmCallCounter()
    mock_model = counter.make_mock_model(score_fn)

    print("\n--- threshold sweep (top_k=5) ---")
    for threshold in (0.2, 0.3, 0.4, 0.5, 0.7):
        with patch("services.ai.penguin_client.get_model", return_value=mock_model):
            response = await score_relevance(
                TriageRequest(
                    criteria=SYN_CRITERIA,
                    documents=SYN_DOCS,
                    top_k=5,
                    threshold=threshold,
                ),
                db_pool=None,
            )

        # Compute precision + recall against SYN_TRUTH.
        true_positives = 0
        false_positives = 0
        false_negatives = 0
        for s in response.scores:
            is_relevant = s.document_id in SYN_TRUTH[s.criterion_id]
            if s.recommended_for_extraction and is_relevant:
                true_positives += 1
            elif s.recommended_for_extraction and not is_relevant:
                false_positives += 1
            elif not s.recommended_for_extraction and is_relevant:
                false_negatives += 1

        precision = (
            true_positives / (true_positives + false_positives)
            if (true_positives + false_positives) > 0
            else 0.0
        )
        recall = (
            true_positives / (true_positives + false_negatives)
            if (true_positives + false_negatives) > 0
            else 0.0
        )
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0
        print(
            f"threshold={threshold:.2f}  P={precision:.2f}  R={recall:.2f}  F1={f1:.2f}  "
            f"TP={true_positives} FP={false_positives} FN={false_negatives}"
        )

    out = capsys.readouterr().out
    assert "threshold sweep" in out


# ─── Test 9: Cost telemetry log ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_cost_telemetry_extraction_reduction(capsys):
    """Log cost-reduction telemetry for the synthetic fixture.

    extraction would have processed X docs without triage; processed Y
    docs with triage; cost reduced by Z%.
    """

    def score_fn(messages):
        cid = _extract_criterion_id_from_messages(messages)
        return _truth_based_llm_scores(cid, SYN_DOCS)

    counter = _LlmCallCounter()
    mock_model = counter.make_mock_model(score_fn)

    with patch("services.ai.penguin_client.get_model", return_value=mock_model):
        response = await score_relevance(
            TriageRequest(
                criteria=SYN_CRITERIA,
                documents=SYN_DOCS,
                top_k=5,
                threshold=0.4,
            ),
            db_pool=None,
        )

    n_criteria = len(SYN_CRITERIA)
    n_docs = len(SYN_DOCS)
    without_triage_pairs = n_criteria * n_docs
    with_triage_pairs = sum(1 for s in response.scores if s.recommended_for_extraction)
    pct_reduction = (
        (without_triage_pairs - with_triage_pairs) / without_triage_pairs * 100.0
        if without_triage_pairs > 0
        else 0.0
    )
    print(
        f"\nextraction would have processed {without_triage_pairs} docs without triage; "
        f"processed {with_triage_pairs} docs with triage; "
        f"cost reduced by {pct_reduction:.1f}%"
    )

    out = capsys.readouterr().out
    assert "cost reduced by" in out
    # Synthetic dataset: triage should eliminate at least half of the work.
    assert pct_reduction > 30.0, "Triage should meaningfully reduce extraction load"


# ─── Test 10: Route auth ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_route_requires_bearer_token(client):
    """POST /triage-documents without auth → 401."""
    resp = await client.post(
        "/triage-documents",
        json={"criteria": [], "documents": []},
    )
    assert resp.status_code == 401


# ─── Test 11: LLM failure → inclusion bias fallback ───────────────────────────


@pytest.mark.asyncio
async def test_llm_failure_includes_all_docs_for_that_criterion():
    """When the structured-output LLM call raises, every doc for that criterion is included."""

    def score_fn(messages):
        cid = _extract_criterion_id_from_messages(messages)
        if cid == "crit-pt-trial":
            raise RuntimeError("simulated transient LLM failure")
        return _truth_based_llm_scores(cid, SYN_DOCS)

    counter = _LlmCallCounter()
    mock_model = counter.make_mock_model(score_fn)

    with patch("services.ai.penguin_client.get_model", return_value=mock_model):
        response = await score_relevance(
            TriageRequest(criteria=SYN_CRITERIA, documents=SYN_DOCS),
            db_pool=None,
        )

    # Every doc for crit-pt-trial should be flagged recommended_for_extraction=True.
    pt_scores = [s for s in response.scores if s.criterion_id == "crit-pt-trial"]
    assert len(pt_scores) == len(SYN_DOCS)
    for s in pt_scores:
        assert s.recommended_for_extraction is True, (
            "On LLM failure, inclusion bias must default to include every doc"
        )


# ─── Test 12: model_dump round-trips through cache ────────────────────────────


@pytest.mark.asyncio
async def test_cache_round_trip_preserves_scores():
    """Manually pre-populate the cache and verify decoding produces equivalent scores."""

    pre_cached_response = {
        "scores": [
            {
                "criterion_id": "crit-migraine",
                "document_id": "doc-neuro-progress",
                "score": 0.97,
                "reasoning": "Pre-cached value.",
                "recommended_for_extraction": True,
            },
            {
                "criterion_id": "crit-migraine",
                "document_id": "doc-dental",
                "score": 0.05,
                "reasoning": "Pre-cached: not relevant.",
                "recommended_for_extraction": False,
            },
        ]
    }

    async def fake_get_cached(_pool, *, task, prompt_version, model, input_hash):
        return pre_cached_response

    async def fake_set_cached(*args, **kwargs):
        pass  # Not expected to be called.

    counter = _LlmCallCounter()
    mock_model = counter.make_mock_model(lambda _msgs: RelevanceScores(scores=[]))

    fake_pool = MagicMock()

    with patch("services.ai.penguin_client.get_model", return_value=mock_model), patch(
        "services.ai.document_triage.get_cached", new=fake_get_cached
    ), patch("services.ai.document_triage.set_cached", new=fake_set_cached):
        response = await score_relevance(
            TriageRequest(
                criteria=[CRITERION_MIGRAINE],
                documents=[SYN_DOCS[0], SYN_DOCS[5]],  # neuro-progress + dental
            ),
            db_pool=fake_pool,
        )

    assert counter.calls == [], "Pre-cached entry must short-circuit the LLM"
    by_doc = {s.document_id: s for s in response.scores}
    assert by_doc["doc-neuro-progress"].score == pytest.approx(0.97)
    assert by_doc["doc-dental"].score == pytest.approx(0.05)
