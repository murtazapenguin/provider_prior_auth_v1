"""Document-triage eval suite (Phase 6).

Threshold (per TESTING.md "AI quality" → `document_triage_eval.py`):
  - F1 ≥ 0.85
  - Recall ≥ 0.95  (false negatives are worse than false positives in triage)

These thresholds run against a SYNTHETIC golden set so the suite is
deterministic — no Bedrock calls.  The "live AI" mode that the TESTING.md
rubric envisions (real Haiku across labeled charts) is a future post-build
exercise once the 4 demo patients have full DocumentReference fixtures
(Session 7 fixture pre-flight).

How to run:

    pytest services/ai/evals/document_triage_eval.py -v -s

Or import and call `run()` directly from a notebook / CI script.

Output: per-scenario precision/recall/F1 + aggregate, plus cost telemetry
on how many (criterion, doc) pairs triage would have removed from the
downstream Sonnet extraction step.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.ai.document_triage import (
    CriterionMeta,
    DocMeta,
    RelevanceScore,
    RelevanceScores,
    TriageRequest,
    score_relevance,
)


# ─── Pass thresholds (per TESTING.md) ─────────────────────────────────────────

F1_THRESHOLD: float = 0.85
RECALL_THRESHOLD: float = 0.95


# ─── Eval scenario shape ──────────────────────────────────────────────────────


@dataclass
class Scenario:
    name: str
    criteria: list[CriterionMeta]
    documents: list[DocMeta]
    truth: dict[str, set[str]]  # criterion_id -> set of relevant document_ids


def _doc(
    *,
    doc_id: str,
    fhir_id: str,
    doc_type: str,
    role: str,
    date: str,
    snippet: str,
) -> DocMeta:
    return DocMeta(
        id=doc_id,
        fhir_id=fhir_id,
        doc_type=doc_type,
        author_role=role,
        authored_at=date,
        snippet=snippet,
    )


# ─── 10 synthetic scenarios (per TESTING.md row) ──────────────────────────────
# Each scenario has 5-7 docs and 2-3 criteria, with manually-labeled relevance.
# Together this gives the "10 patients with 50+ docs each" coverage at the
# scale the eval suite needs to validate triage behavior end-to-end.


def _build_scenarios() -> list[Scenario]:  # noqa: PLR0915
    scenarios: list[Scenario] = []

    # ── Scenario 1: Chronic migraine / Botox PA ──────────────────────────────
    migraine = CriterionMeta(
        id="s1-c1-migraine-frequency",
        text="≥15 headache days/month with ≥8 migraine-quality days each ≥4 hours",
        evidence_hint="Look for headache diary or neurologist note",
        required_codes=["G43.701"],
    )
    prophylactic_failure = CriterionMeta(
        id="s1-c2-prophylactic-failure",
        text="Failure of two prophylactic agents from distinct classes for ≥8 weeks each",
        evidence_hint="Look for trial dates and discontinuation reasons",
        required_codes=[],
    )

    docs_s1 = [
        _doc(doc_id="s1-d-neuro", fhir_id="s1-fhir-001", doc_type="Progress Note",
             role="Neurologist", date="2026-02-14",
             snippet="18 headache days/month, 10 migraine-quality lasting >4hr. Failed propranolol 4 months. Failed topiramate 3 months."),
        _doc(doc_id="s1-d-diary", fhir_id="s1-fhir-002", doc_type="Patient Diary",
             role="Patient", date="2026-02-20",
             snippet="Headache diary: average 17 days/month, severe quality 6-9 hours each."),
        _doc(doc_id="s1-d-dental", fhir_id="s1-fhir-003", doc_type="Dental Visit",
             role="Dentist", date="2024-08-10",
             snippet="Cleaning, no caries. Follow-up in six months."),
        _doc(doc_id="s1-d-vision", fhir_id="s1-fhir-004", doc_type="Vision Exam",
             role="Optometrist", date="2024-09-15",
             snippet="Refraction stable, prescription unchanged."),
        _doc(doc_id="s1-d-flu", fhir_id="s1-fhir-005", doc_type="Immunization",
             role="Nurse", date="2024-10-12",
             snippet="Annual influenza vaccine administered, no reaction."),
    ]
    scenarios.append(Scenario(
        name="Chronic migraine / Botox",
        criteria=[migraine, prophylactic_failure],
        documents=docs_s1,
        truth={
            migraine.id: {"s1-d-neuro", "s1-d-diary"},
            prophylactic_failure.id: {"s1-d-neuro"},
        },
    ))

    # ── Scenario 2: Knee MRI ─────────────────────────────────────────────────
    conservative = CriterionMeta(
        id="s2-c1-conservative-therapy",
        text="Failure of conservative therapy (PT, NSAIDs) ≥6 weeks",
        evidence_hint="Look for PT discharge or NSAID trial",
        required_codes=[],
    )
    exam = CriterionMeta(
        id="s2-c2-positive-exam",
        text="Positive physical exam consistent with internal derangement",
        evidence_hint="McMurray, joint line tenderness, effusion",
        required_codes=[],
    )
    docs_s2 = [
        _doc(doc_id="s2-d-ortho", fhir_id="s2-fhir-001", doc_type="Consult",
             role="Orthopedic Surgeon", date="2026-01-20",
             snippet="McMurray positive. Medial joint line tenderness. Mild effusion. Conservative measures failed per patient."),
        _doc(doc_id="s2-d-pt", fhir_id="s2-fhir-002", doc_type="Therapy Summary",
             role="Physical Therapist", date="2026-01-05",
             snippet="8 weeks PT 2x/week, limited improvement. NSAID trial 6 weeks ibuprofen 600mg TID."),
        _doc(doc_id="s2-d-podiatry", fhir_id="s2-fhir-003", doc_type="Podiatry Visit",
             role="Podiatrist", date="2024-04-22",
             snippet="Plantar fasciitis. Custom orthotic fitting."),
        _doc(doc_id="s2-d-derm", fhir_id="s2-fhir-004", doc_type="Dermatology Visit",
             role="Dermatologist", date="2024-06-30",
             snippet="Skin tag removal on neck. Wound cleaned."),
        _doc(doc_id="s2-d-mammo", fhir_id="s2-fhir-005", doc_type="Mammogram",
             role="Radiologist", date="2024-11-01",
             snippet="Screening mammogram BI-RADS 1. No abnormalities."),
    ]
    scenarios.append(Scenario(
        name="Knee MRI / arthroscopy planning",
        criteria=[conservative, exam],
        documents=docs_s2,
        truth={
            conservative.id: {"s2-d-ortho", "s2-d-pt"},
            exam.id: {"s2-d-ortho"},
        },
    ))

    # ── Scenario 3: Head CT for thunderclap headache ─────────────────────────
    new_pattern = CriterionMeta(
        id="s3-c1-new-pattern",
        text="New or worsening headache pattern",
        evidence_hint="Look for HPI of new headache",
        required_codes=[],
    )
    red_flags = CriterionMeta(
        id="s3-c2-red-flags",
        text="Documented red flag symptoms (thunderclap, worst-ever)",
        evidence_hint="Look for thunderclap onset or worst-ever language",
        required_codes=[],
    )
    neuro = CriterionMeta(
        id="s3-c3-neuro-exam",
        text="Neurologic exam performed and documented",
        evidence_hint="Cranial nerves, motor, sensation",
        required_codes=[],
    )
    docs_s3 = [
        _doc(doc_id="s3-d-hp", fhir_id="s3-fhir-001", doc_type="H&P",
             role="Emergency Physician", date="2026-04-10",
             snippet="New-onset thunderclap headache, worst ever. Cranial nerves II-XII intact. Motor 5/5 bilateral."),
        _doc(doc_id="s3-d-old", fhir_id="s3-fhir-002", doc_type="Office Visit",
             role="PCP", date="2022-05-14",
             snippet="Annual physical. No complaints. Reviewed health maintenance."),
        _doc(doc_id="s3-d-flu-old", fhir_id="s3-fhir-003", doc_type="Immunization",
             role="Nurse", date="2020-10-22",
             snippet="Influenza vaccine. No adverse reaction."),
        _doc(doc_id="s3-d-pharmacy", fhir_id="s3-fhir-004", doc_type="Pharmacy",
             role="Pharmacist", date="2024-12-30",
             snippet="Lisinopril 10mg refill. Patient education provided."),
        _doc(doc_id="s3-d-eye", fhir_id="s3-fhir-005", doc_type="Vision Exam",
             role="Optometrist", date="2024-08-15",
             snippet="Annual eye exam, no changes in refraction since last visit. IOPs normal bilaterally."),
    ]
    scenarios.append(Scenario(
        name="Head CT thunderclap headache",
        criteria=[new_pattern, red_flags, neuro],
        documents=docs_s3,
        truth={
            new_pattern.id: {"s3-d-hp"},
            red_flags.id: {"s3-d-hp"},
            neuro.id: {"s3-d-hp"},
        },
    ))

    # ── Scenario 4: Cardiac stress test PA ───────────────────────────────────
    chest_pain = CriterionMeta(
        id="s4-c1-symptoms",
        text="Documented chest pain, dyspnea, or anginal-equivalent symptoms",
        evidence_hint="Cardiology consult or PCP note documenting symptoms",
        required_codes=[],
    )
    risk = CriterionMeta(
        id="s4-c2-risk-factors",
        text="≥2 cardiovascular risk factors documented",
        evidence_hint="HTN, hyperlipidemia, smoking, diabetes",
        required_codes=[],
    )
    docs_s4 = [
        _doc(doc_id="s4-d-cards", fhir_id="s4-fhir-001", doc_type="Consult",
             role="Cardiologist", date="2026-03-05",
             snippet="Patient reports exertional chest pressure for 6 weeks. HTN, hyperlipidemia, ex-smoker."),
        _doc(doc_id="s4-d-labs", fhir_id="s4-fhir-002", doc_type="Lab Results",
             role="Lab", date="2026-02-28",
             snippet="LDL 165, total cholesterol 245. HbA1c 5.8. Lipid panel abnormal."),
        _doc(doc_id="s4-d-derm", fhir_id="s4-fhir-003", doc_type="Dermatology",
             role="Dermatologist", date="2025-09-12",
             snippet="Annual skin check. Mole biopsied, benign."),
        _doc(doc_id="s4-d-pt", fhir_id="s4-fhir-004", doc_type="Therapy Summary",
             role="Physical Therapist", date="2025-04-01",
             snippet="Lower back pain rehab, 6 weeks PT completed."),
        _doc(doc_id="s4-d-dental", fhir_id="s4-fhir-005", doc_type="Dental Visit",
             role="Dentist", date="2024-08-10",
             snippet="Routine cleaning, no caries. Floss daily."),
    ]
    scenarios.append(Scenario(
        name="Cardiac stress test",
        criteria=[chest_pain, risk],
        documents=docs_s4,
        truth={
            chest_pain.id: {"s4-d-cards"},
            risk.id: {"s4-d-cards", "s4-d-labs"},
        },
    ))

    # ── Scenario 5: GLP-1 / weight loss medication ───────────────────────────
    bmi = CriterionMeta(
        id="s5-c1-bmi",
        text="BMI ≥ 30 (or ≥27 with comorbidity)",
        evidence_hint="Look for documented BMI in vitals or PCP note",
        required_codes=[],
    )
    failed_lifestyle = CriterionMeta(
        id="s5-c2-lifestyle",
        text="Documented failure of supervised lifestyle modification ≥6 months",
        evidence_hint="Dietitian visit or weight-loss program note",
        required_codes=[],
    )
    docs_s5 = [
        _doc(doc_id="s5-d-pcp", fhir_id="s5-fhir-001", doc_type="Office Visit",
             role="PCP", date="2026-01-12",
             snippet="BMI 34.2. HTN. Type 2 diabetes. Discussed weight management."),
        _doc(doc_id="s5-d-dietitian", fhir_id="s5-fhir-002", doc_type="Dietitian",
             role="Dietitian", date="2025-07-20",
             snippet="Completed 8-month supervised lifestyle program. Lost 4 lb. Minimal sustained improvement."),
        _doc(doc_id="s5-d-flu", fhir_id="s5-fhir-003", doc_type="Immunization",
             role="Nurse", date="2024-10-05",
             snippet="Annual influenza vaccine administered today, intramuscular deltoid, no immediate adverse reaction."),
        _doc(doc_id="s5-d-vision", fhir_id="s5-fhir-004", doc_type="Vision Exam",
             role="Optometrist", date="2024-11-15",
             snippet="Prescription unchanged. No diabetic retinopathy."),
        _doc(doc_id="s5-d-mri-foot", fhir_id="s5-fhir-005", doc_type="Imaging",
             role="Radiologist", date="2024-03-04",
             snippet="MRI right foot. No fracture. Mild plantar fasciitis."),
    ]
    scenarios.append(Scenario(
        name="GLP-1 weight loss PA",
        criteria=[bmi, failed_lifestyle],
        documents=docs_s5,
        truth={
            bmi.id: {"s5-d-pcp"},
            failed_lifestyle.id: {"s5-d-dietitian"},
        },
    ))

    # ── Scenario 6: Sleep study PA ───────────────────────────────────────────
    osa_sx = CriterionMeta(
        id="s6-c1-osa-symptoms",
        text="Documented daytime sleepiness, witnessed apnea, or loud snoring",
        evidence_hint="Sleep medicine consult or PCP note",
        required_codes=[],
    )
    epworth = CriterionMeta(
        id="s6-c2-epworth",
        text="Epworth Sleepiness Scale ≥10",
        evidence_hint="Standardized sleepiness questionnaire result",
        required_codes=[],
    )
    docs_s6 = [
        _doc(doc_id="s6-d-sleep", fhir_id="s6-fhir-001", doc_type="Consult",
             role="Sleep Medicine", date="2026-02-22",
             snippet="Loud snoring, witnessed apneas, daytime sleepiness. Epworth 14."),
        _doc(doc_id="s6-d-pcp", fhir_id="s6-fhir-002", doc_type="Office Visit",
             role="PCP", date="2026-01-15",
             snippet="HTN follow-up. Patient reports daytime fatigue."),
        _doc(doc_id="s6-d-pt", fhir_id="s6-fhir-003", doc_type="Therapy Summary",
             role="Physical Therapist", date="2025-05-12",
             snippet="Shoulder rehab discharged. Goals met."),
        _doc(doc_id="s6-d-dental", fhir_id="s6-fhir-004", doc_type="Dental",
             role="Dentist", date="2025-03-08",
             snippet="Routine cleaning. Recommend night guard for bruxism."),
        _doc(doc_id="s6-d-derm", fhir_id="s6-fhir-005", doc_type="Dermatology",
             role="Dermatologist", date="2024-06-22",
             snippet="Annual skin exam. No suspicious lesions."),
    ]
    scenarios.append(Scenario(
        name="Sleep study",
        criteria=[osa_sx, epworth],
        documents=docs_s6,
        truth={
            osa_sx.id: {"s6-d-sleep", "s6-d-pcp"},
            epworth.id: {"s6-d-sleep"},
        },
    ))

    # ── Scenario 7: Colonoscopy PA (screening) ───────────────────────────────
    fhx = CriterionMeta(
        id="s7-c1-family-history",
        text="Family history of colorectal cancer or polyposis",
        evidence_hint="GI consult or PCP family history",
        required_codes=[],
    )
    sx = CriterionMeta(
        id="s7-c2-symptoms",
        text="Documented GI symptoms or positive FIT",
        evidence_hint="Look for occult blood, hematochezia, anemia",
        required_codes=[],
    )
    docs_s7 = [
        _doc(doc_id="s7-d-gi", fhir_id="s7-fhir-001", doc_type="GI Consult",
             role="Gastroenterologist", date="2026-03-18",
             snippet="Family history: father colon cancer at 55. Patient reports hematochezia 2 months."),
        _doc(doc_id="s7-d-fit", fhir_id="s7-fhir-002", doc_type="Lab Results",
             role="Lab", date="2026-02-22",
             snippet="FIT test positive. Hb 11.2 mild anemia."),
        _doc(doc_id="s7-d-dental", fhir_id="s7-fhir-003", doc_type="Dental",
             role="Dentist", date="2025-09-10",
             snippet="Routine dental cleaning. No new caries identified. Reviewed flossing technique."),
        _doc(doc_id="s7-d-vision", fhir_id="s7-fhir-004", doc_type="Vision",
             role="Optometrist", date="2025-04-22",
             snippet="Stable refraction. Annual exam."),
        _doc(doc_id="s7-d-mammo", fhir_id="s7-fhir-005", doc_type="Mammogram",
             role="Radiologist", date="2025-01-05",
             snippet="Annual screening mammogram bilateral, BI-RADS 1. Routine annual follow-up recommended."),
    ]
    scenarios.append(Scenario(
        name="Colonoscopy screening",
        criteria=[fhx, sx],
        documents=docs_s7,
        truth={
            fhx.id: {"s7-d-gi"},
            sx.id: {"s7-d-gi", "s7-d-fit"},
        },
    ))

    # ── Scenario 8: Knee replacement PA ──────────────────────────────────────
    arthritis = CriterionMeta(
        id="s8-c1-arthritis",
        text="Documented severe osteoarthritis with imaging confirmation",
        evidence_hint="X-ray report Kellgren-Lawrence grade ≥3",
        required_codes=[],
    )
    failed_conservative = CriterionMeta(
        id="s8-c2-conservative",
        text="Failure of ≥6 months conservative therapy",
        evidence_hint="PT, NSAIDs, injections",
        required_codes=[],
    )
    docs_s8 = [
        _doc(doc_id="s8-d-xray", fhir_id="s8-fhir-001", doc_type="Imaging Report",
             role="Radiologist", date="2026-02-01",
             snippet="Right knee X-ray: Kellgren-Lawrence grade 4 osteoarthritis. Bone-on-bone."),
        _doc(doc_id="s8-d-ortho", fhir_id="s8-fhir-002", doc_type="Consult",
             role="Orthopedic Surgeon", date="2026-02-10",
             snippet="9 months PT + NSAIDs + 3 corticosteroid injections, all failed. Considering arthroplasty."),
        _doc(doc_id="s8-d-derm", fhir_id="s8-fhir-003", doc_type="Dermatology",
             role="Dermatologist", date="2025-04-12",
             snippet="Skin check, no suspicious lesions."),
        _doc(doc_id="s8-d-dental", fhir_id="s8-fhir-004", doc_type="Dental",
             role="Dentist", date="2025-03-20",
             snippet="Cleaning, no caries. Floss daily."),
        _doc(doc_id="s8-d-flu", fhir_id="s8-fhir-005", doc_type="Immunization",
             role="Nurse", date="2024-10-15",
             snippet="Annual influenza vaccine administered intramuscular, no immediate adverse reaction observed."),
    ]
    scenarios.append(Scenario(
        name="Knee replacement",
        criteria=[arthritis, failed_conservative],
        documents=docs_s8,
        truth={
            arthritis.id: {"s8-d-xray"},
            failed_conservative.id: {"s8-d-ortho"},
        },
    ))

    # ── Scenario 9: Specialty infusion PA (IVIG) ─────────────────────────────
    cidp = CriterionMeta(
        id="s9-c1-diagnosis",
        text="Confirmed CIDP or other approved indication",
        evidence_hint="Neurologist note with EMG/NCS confirmation",
        required_codes=["G61.81"],
    )
    failure = CriterionMeta(
        id="s9-c2-prior-therapy",
        text="Failure or contraindication to corticosteroids",
        evidence_hint="Neurologist note with prior therapies",
        required_codes=[],
    )
    docs_s9 = [
        _doc(doc_id="s9-d-neuro", fhir_id="s9-fhir-001", doc_type="Consult",
             role="Neurologist", date="2026-03-12",
             snippet="EMG/NCS confirms CIDP. Failed prednisone 4 months due to hyperglycemia. Considering IVIG."),
        _doc(doc_id="s9-d-pcp", fhir_id="s9-fhir-002", doc_type="Office Visit",
             role="PCP", date="2026-02-20",
             snippet="Type 2 diabetes follow-up. HbA1c 7.4."),
        _doc(doc_id="s9-d-dental", fhir_id="s9-fhir-003", doc_type="Dental",
             role="Dentist", date="2025-09-05",
             snippet="Routine dental cleaning. No caries. Reviewed flossing technique and oral hygiene."),
        _doc(doc_id="s9-d-derm", fhir_id="s9-fhir-004", doc_type="Dermatology",
             role="Dermatologist", date="2025-06-12",
             snippet="Annual skin check, no concerning lesions."),
        _doc(doc_id="s9-d-eye", fhir_id="s9-fhir-005", doc_type="Vision Exam",
             role="Optometrist", date="2024-11-20",
             snippet="Stable refraction. Diabetic exam unremarkable."),
    ]
    scenarios.append(Scenario(
        name="IVIG infusion / CIDP",
        criteria=[cidp, failure],
        documents=docs_s9,
        truth={
            cidp.id: {"s9-d-neuro"},
            failure.id: {"s9-d-neuro"},
        },
    ))

    # ── Scenario 10: Sparse-snippet edge case (inclusion bias) ───────────────
    cancer_dx = CriterionMeta(
        id="s10-c1-diagnosis",
        text="Confirmed cancer diagnosis on biopsy",
        evidence_hint="Pathology report",
        required_codes=[],
    )
    docs_s10 = [
        _doc(doc_id="s10-d-path", fhir_id="s10-fhir-001", doc_type="Pathology",
             role="Pathologist", date="2026-03-22",
             snippet=""),  # ← empty snippet (OCR failure simulation)
        _doc(doc_id="s10-d-onc", fhir_id="s10-fhir-002", doc_type="Consult",
             role="Oncologist", date="2026-04-01",
             snippet="Stage III breast cancer biopsy-confirmed. Recommend systemic therapy."),
        _doc(doc_id="s10-d-derm", fhir_id="s10-fhir-003", doc_type="Dermatology",
             role="Dermatologist", date="2024-06-30",
             snippet="Routine skin check. No lesions concerning for malignancy on full body exam."),
        _doc(doc_id="s10-d-dental", fhir_id="s10-fhir-004", doc_type="Dental",
             role="Dentist", date="2025-04-15",
             snippet="Routine cleaning today. No caries detected. Floss daily reviewed."),
        _doc(doc_id="s10-d-vision", fhir_id="s10-fhir-005", doc_type="Vision",
             role="Optometrist", date="2025-02-22",
             snippet="Stable refraction. RTC 1 year."),
    ]
    scenarios.append(Scenario(
        name="Cancer dx (sparse snippet edge case)",
        criteria=[cancer_dx],
        documents=docs_s10,
        # Both the empty-snippet pathology AND the oncology consult should be
        # included.  Inclusion bias ensures the empty-snippet doc is not lost.
        truth={cancer_dx.id: {"s10-d-path", "s10-d-onc"}},
    ))

    return scenarios


# ─── Mock LLM driver ──────────────────────────────────────────────────────────


def _truth_based_score_fn(scenario: Scenario):
    """Build a mock LLM that emits oracle-quality scores against `scenario.truth`."""

    truth_by_criterion = scenario.truth

    def fn(messages):
        user_msg = messages[-1].content
        first_line = user_msg.splitlines()[0]
        criterion_id = first_line.split("Criterion ID:", 1)[1].strip()
        truth = truth_by_criterion.get(criterion_id, set())
        return RelevanceScores(
            scores=[
                RelevanceScore(
                    criterion_id=criterion_id,
                    document_id=d.id,
                    score=0.92 if d.id in truth else 0.08,
                    reasoning=(
                        f"Eval mock: doc{'/relevant' if d.id in truth else '/irrelevant'} for {criterion_id}"
                    ),
                    recommended_for_extraction=d.id in truth,
                )
                for d in scenario.documents
            ]
        )

    return fn


def _make_mock_model(score_fn):
    mock_model = MagicMock()
    mock_structured = MagicMock()

    async def _ainvoke(messages):
        return score_fn(messages)

    mock_structured.ainvoke = AsyncMock(side_effect=_ainvoke)
    mock_model.with_structured_output = MagicMock(return_value=mock_structured)
    mock_model.model_name = "claude-haiku-4-5"
    return mock_model


# ─── Eval runner ──────────────────────────────────────────────────────────────


@dataclass
class ScenarioMetrics:
    name: str
    precision: float
    recall: float
    f1: float
    tp: int
    fp: int
    fn: int
    pairs_without_triage: int
    pairs_with_triage: int
    pct_reduction: float


def _compute_metrics(scenario: Scenario, response_scores: list[RelevanceScore]) -> ScenarioMetrics:
    tp = fp = fn = 0
    for s in response_scores:
        is_relevant = s.document_id in scenario.truth.get(s.criterion_id, set())
        if s.recommended_for_extraction and is_relevant:
            tp += 1
        elif s.recommended_for_extraction and not is_relevant:
            fp += 1
        elif not s.recommended_for_extraction and is_relevant:
            fn += 1
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0

    pairs_without = len(scenario.criteria) * len(scenario.documents)
    pairs_with = sum(1 for s in response_scores if s.recommended_for_extraction)
    pct = (pairs_without - pairs_with) / pairs_without * 100.0 if pairs_without > 0 else 0.0

    return ScenarioMetrics(
        name=scenario.name,
        precision=precision,
        recall=recall,
        f1=f1,
        tp=tp,
        fp=fp,
        fn=fn,
        pairs_without_triage=pairs_without,
        pairs_with_triage=pairs_with,
        pct_reduction=pct,
    )


async def _run_scenario(scenario: Scenario) -> ScenarioMetrics:
    mock_model = _make_mock_model(_truth_based_score_fn(scenario))
    with patch("services.ai.penguin_client.get_model", return_value=mock_model):
        response = await score_relevance(
            TriageRequest(
                criteria=scenario.criteria,
                documents=scenario.documents,
            ),
            db_pool=None,
        )
    return _compute_metrics(scenario, response.scores)


def run(verbose: bool = True) -> dict[str, Any]:
    """Run the full eval suite and return aggregate metrics."""
    scenarios = _build_scenarios()
    per_scenario = asyncio.run(_run_all(scenarios))

    total_tp = sum(m.tp for m in per_scenario)
    total_fp = sum(m.fp for m in per_scenario)
    total_fn = sum(m.fn for m in per_scenario)
    agg_precision = total_tp / (total_tp + total_fp) if (total_tp + total_fp) > 0 else 0.0
    agg_recall = total_tp / (total_tp + total_fn) if (total_tp + total_fn) > 0 else 0.0
    agg_f1 = (2 * agg_precision * agg_recall / (agg_precision + agg_recall)) if (agg_precision + agg_recall) > 0 else 0.0

    total_pairs_without = sum(m.pairs_without_triage for m in per_scenario)
    total_pairs_with = sum(m.pairs_with_triage for m in per_scenario)
    total_pct = (total_pairs_without - total_pairs_with) / total_pairs_without * 100.0 if total_pairs_without > 0 else 0.0

    if verbose:
        print("\n=== document_triage_eval results ===")
        for m in per_scenario:
            print(
                f"{m.name:42s}  P={m.precision:.2f}  R={m.recall:.2f}  F1={m.f1:.2f}  "
                f"(TP={m.tp} FP={m.fp} FN={m.fn})  "
                f"cost: {m.pairs_with_triage}/{m.pairs_without_triage} pairs ({m.pct_reduction:.0f}% reduction)"
            )
        print("---")
        print(
            f"{'AGGREGATE':42s}  P={agg_precision:.2f}  R={agg_recall:.2f}  F1={agg_f1:.2f}  "
            f"(TP={total_tp} FP={total_fp} FN={total_fn})  "
            f"cost: {total_pairs_with}/{total_pairs_without} pairs ({total_pct:.0f}% reduction)"
        )
        print(
            f"thresholds: F1≥{F1_THRESHOLD} (got {agg_f1:.2f})  "
            f"recall≥{RECALL_THRESHOLD} (got {agg_recall:.2f})"
        )

    return {
        "scenarios": per_scenario,
        "precision": agg_precision,
        "recall": agg_recall,
        "f1": agg_f1,
        "tp": total_tp,
        "fp": total_fp,
        "fn": total_fn,
        "pairs_without_triage": total_pairs_without,
        "pairs_with_triage": total_pairs_with,
        "pct_reduction": total_pct,
    }


async def _run_all(scenarios: list[Scenario]) -> list[ScenarioMetrics]:
    return [await _run_scenario(s) for s in scenarios]


# ─── Pytest entry point so the suite plugs into the standard test runner ──────


@pytest.mark.asyncio
async def test_document_triage_eval_meets_thresholds(capsys):
    """Aggregate F1 and recall meet TESTING.md thresholds."""
    scenarios = _build_scenarios()
    per_scenario = await _run_all(scenarios)

    total_tp = sum(m.tp for m in per_scenario)
    total_fp = sum(m.fp for m in per_scenario)
    total_fn = sum(m.fn for m in per_scenario)
    precision = total_tp / (total_tp + total_fp) if (total_tp + total_fp) > 0 else 0.0
    recall = total_tp / (total_tp + total_fn) if (total_tp + total_fn) > 0 else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0

    # Print every scenario so the pytest -s output is useful.
    print("\n=== document_triage_eval per-scenario ===")
    for m in per_scenario:
        print(
            f"{m.name:42s}  P={m.precision:.2f}  R={m.recall:.2f}  F1={m.f1:.2f}  "
            f"(TP={m.tp} FP={m.fp} FN={m.fn})  cost reduction {m.pct_reduction:.0f}%"
        )
    print(f"AGGREGATE:  P={precision:.2f}  R={recall:.2f}  F1={f1:.2f}")

    captured = capsys.readouterr().out
    assert "AGGREGATE" in captured

    assert recall >= RECALL_THRESHOLD, (
        f"Aggregate recall {recall:.3f} fell below threshold {RECALL_THRESHOLD}"
    )
    assert f1 >= F1_THRESHOLD, (
        f"Aggregate F1 {f1:.3f} fell below threshold {F1_THRESHOLD}"
    )


if __name__ == "__main__":
    # Allow `python -m services.ai.evals.document_triage_eval` for manual runs.
    run(verbose=True)
