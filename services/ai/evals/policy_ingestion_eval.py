"""Policy-ingestion eval suite (Phase 6) — MATCHER CALIBRATION ONLY.

HONEST FRAMING:
  This suite does NOT measure Bedrock / Sonnet 4.5 extraction quality.
  `ingest_policy` itself is stubbed; `predicted_criteria` are hand-authored
  alongside `expected_criteria` to model realistic-looking LLM behavior
  (perfect matches, near-miss paraphrasing, one missed criterion in
  Scenario 2, one spurious extra in Scenario 3, etc.).

  What this eval DOES measure:
    - Whether the Jaccard-based matcher tolerates plausible LLM paraphrasing
      without falsely scoring true matches as missing.
    - Whether the match threshold (currently 0.30) is calibrated for the
      kinds of paraphrasing we expect to see.
    - A canary baseline: if a future LLM change makes the orchestration
      brittle (e.g. dropping criterion ordinals, mangling text), the eval
      structure is in place to catch it once we wire in a real Bedrock
      eval mode.

  What this eval DOES NOT measure:
    - Real LLM extraction recall/precision against UHC PDFs. That requires
      live Bedrock + clinically-labeled ground truth (Phase 7+ work; the
      Phase 6 hard scope ceiling explicitly forbids broadening the eval set
      by ingesting more real policies).
    - Bbox / source_line_numbers correctness (real OCR output is required).
    - Cache hit/miss behavior (covered by `test_policy_rescrape.py`).

  When the orchestrator reads the "F1=0.95" number in the report, it should
  read it as "the matcher behaves sensibly against realistic-looking
  outputs," not as "the LLM extracts UHC policies at 95% F1."

PROPOSED TESTING.md ROW (no row exists today for `policy_ingestion_eval.py`
in TESTING.md "AI quality / eval"):

    | `policy_ingestion_eval.py` (Phase 6, matcher-calibration only) |
    | 5 scenarios with hand-authored expected + predicted criterion sets |
    | F1 score against expected criteria (matcher-tolerance check) |
    | F1 ≥ 0.75; criterion-recall ≥ 0.80; criterion-precision ≥ 0.70 |

  These thresholds are conservative on purpose: they're matcher-tolerance
  thresholds, not LLM-quality thresholds. They should be tightened when the
  eval evolves into live-Bedrock mode (Phase 7+) and labeled ground truth
  exists.

HOW TO RUN:

    pytest services/ai/evals/policy_ingestion_eval.py -v -s
    python -m services.ai.evals.policy_ingestion_eval     # manual run

HOW TO UPGRADE TO LIVE-BEDROCK MODE (post Phase 6):
    1. Replace `_build_ingestion_mock` with a patch at
       `model.with_structured_output().ainvoke()` returning canned
       Pydantic `IngestionResult` instances (mirror
       `document_triage_eval.py`'s pattern).
    2. Build a small fake `OCRResult` per scenario so real
       `ingest_policy` runs end to end (covers bbox materialization).
    3. Add labeled ground-truth sets sourced from a clinical reviewer for
       at least 10 real UHC policies — until that exists, broadening the
       fixture set just inflates a number without grounding it.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import Any, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ─── Pass thresholds (PROPOSED — no TESTING.md row yet) ───────────────────────

F1_THRESHOLD: float = 0.75
RECALL_THRESHOLD: float = 0.80
PRECISION_THRESHOLD: float = 0.70

# Matching threshold: two criterion-text strings are considered "the same
# criterion" when their Jaccard token overlap is at or above this value. 0.30
# tolerates LLM paraphrasing while still requiring overlap on substantive
# domain terms (e.g. "headache", "migraine", "PT", "trial").
MATCH_THRESHOLD: float = 0.30

_MIN_TOKEN_LEN = 3
_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokens(text: str) -> set[str]:
    return {
        t for t in _TOKEN_RE.findall(text.lower()) if len(t) >= _MIN_TOKEN_LEN
    }


def _jaccard(a: str, b: str) -> float:
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


# ─── Eval scenario shape ──────────────────────────────────────────────────────


@dataclass
class PolicyScenario:
    """A single eval scenario: a policy's OCR-style text + expected criteria."""

    name: str
    # OCR-style "content || line_number" lines, joined by newline. Mirrors
    # the format `policy_ingestion.py` actually feeds to the LLM.
    ocr_full_text: str
    # Ordered list of expected criterion-text strings (the ground truth).
    expected_criteria: list[str]
    # The LLM's predicted criterion-text strings for this scenario.  In a
    # real-bedrock eval this would be the live model output; for the
    # deterministic suite we hand-author them to model realistic behavior
    # (some near-misses, some perfect matches, some skipped criteria).
    predicted_criteria: list[str]


# ─── Synthetic scenarios ──────────────────────────────────────────────────────


def _line(content: str, n: int) -> str:
    return f"{content} || {n}"


def _build_scenarios() -> list[PolicyScenario]:
    scenarios: list[PolicyScenario] = []

    # ── Scenario 1: simple bulleted criteria (4 criteria) ─────────────────────
    s1_ocr = "\n".join([
        _line("UHC Medical Policy — Hypothetical Procedure XYZ", 1),
        _line("Coverage Criteria", 2),
        _line("- Documented diagnosis of condition A confirmed by laboratory testing", 3),
        _line("- Age 18 years or older at the time of service", 4),
        _line("- Failure of two prior conservative therapies of at least 4 weeks each", 5),
        _line("- Procedure must be performed by a board-certified specialist", 6),
    ])
    s1_expected = [
        "Documented diagnosis of condition A confirmed by laboratory testing",
        "Age 18 years or older at the time of service",
        "Failure of two prior conservative therapies of at least 4 weeks each",
        "Procedure must be performed by a board-certified specialist",
    ]
    # Realistic LLM behavior — perfect on 3, near-miss paraphrase on the 4th.
    s1_predicted = [
        "Documented diagnosis of condition A confirmed by laboratory testing",
        "Patient must be 18 years or older at the time of service",
        "Failure of two prior conservative therapies of at least 4 weeks each",
        "Procedure performed by a board-certified specialist",
    ]
    scenarios.append(PolicyScenario(
        name="simple bulleted criteria",
        ocr_full_text=s1_ocr,
        expected_criteria=s1_expected,
        predicted_criteria=s1_predicted,
    ))

    # ── Scenario 2: grouped "ALL of the following" pattern ────────────────────
    s2_ocr = "\n".join([
        _line("Indications for Coverage", 1),
        _line("Coverage is granted when ALL of the following are met:", 2),
        _line("a) Documented clinical diagnosis from a specialist", 3),
        _line("b) Imaging confirms the diagnosis", 4),
        _line("c) Symptoms persist for at least 90 days", 5),
        _line("Renewal requires ONE of the following:", 6),
        _line("- Documented improvement in functional status", 7),
        _line("- Stable disease activity for at least 6 months", 8),
    ])
    s2_expected = [
        "Documented clinical diagnosis from a specialist",
        "Imaging confirms the diagnosis",
        "Symptoms persist for at least 90 days",
        "Documented improvement in functional status",
        "Stable disease activity for at least 6 months",
    ]
    # LLM misses one renewal criterion (the "stable disease" one).
    s2_predicted = [
        "Documented clinical diagnosis from a specialist",
        "Imaging confirms the diagnosis",
        "Symptoms persist for at least 90 days",
        "Documented improvement in functional status",
    ]
    scenarios.append(PolicyScenario(
        name="grouped ALL/ONE-of pattern",
        ocr_full_text=s2_ocr,
        expected_criteria=s2_expected,
        predicted_criteria=s2_predicted,
    ))

    # ── Scenario 3: trial-and-failure language ────────────────────────────────
    s3_ocr = "\n".join([
        _line("Coverage Criteria — Specialty Pharmacy Drug Q", 1),
        _line("Patient must have:", 2),
        _line("- A confirmed diagnosis of refractory disease X", 3),
        _line("- Failed or contraindicated to prior therapy with at least two agents from distinct classes:", 4),
        _line("  Class 1: agent A, agent B", 5),
        _line("  Class 2: agent C, agent D", 6),
        _line("  Each agent must have been trialed for a minimum of 8 weeks", 7),
        _line("- Baseline labs documented within 30 days prior to initiation", 8),
    ])
    s3_expected = [
        "A confirmed diagnosis of refractory disease X",
        "Failed or contraindicated to prior therapy with at least two agents from distinct classes",
        "Each agent must have been trialed for a minimum of 8 weeks",
        "Baseline labs documented within 30 days prior to initiation",
    ]
    # Realistic LLM: extracts all four, but compresses the trial-failure
    # phrasing slightly. Also adds one spurious extra-criteria row from a
    # nearby fragment (a precision-degrading hallucination).
    s3_predicted = [
        "Confirmed diagnosis of refractory disease X",
        "Failed or contraindicated to prior therapy with at least two agents from distinct drug classes",
        "Each agent trialed for at least 8 weeks",
        "Baseline labs documented within 30 days prior to initiation",
        "Patient must complete laboratory monitoring during treatment",
    ]
    scenarios.append(PolicyScenario(
        name="trial-and-failure pharmacy criteria",
        ocr_full_text=s3_ocr,
        expected_criteria=s3_expected,
        predicted_criteria=s3_predicted,
    ))

    # ── Scenario 4: dosing limits + administration constraints ────────────────
    s4_ocr = "\n".join([
        _line("Dosing and Administration Criteria for Drug Z", 1),
        _line("- Total dose does not exceed 200 units per session", 2),
        _line("- Sessions are spaced at intervals of no less than 12 weeks", 3),
        _line("- Administration occurs in an outpatient infusion center or comparable setting", 4),
        _line("- Sites limited to specific anatomic locations specified in the appendix", 5),
    ])
    s4_expected = [
        "Total dose does not exceed 200 units per session",
        "Sessions are spaced at intervals of no less than 12 weeks",
        "Administration occurs in an outpatient infusion center or comparable setting",
        "Sites limited to specific anatomic locations specified in the appendix",
    ]
    s4_predicted = [
        "Total dose does not exceed 200 units per session",
        "Sessions spaced at intervals of at least 12 weeks",
        "Administration in an outpatient infusion center or comparable setting",
        "Sites limited to anatomic locations specified in the appendix",
    ]
    scenarios.append(PolicyScenario(
        name="dosing limits + administration",
        ocr_full_text=s4_ocr,
        expected_criteria=s4_expected,
        predicted_criteria=s4_predicted,
    ))

    # ── Scenario 5: hand-curated UHC Botox baseline (the 1 real datapoint) ────
    # Mirrors prisma/fixtures/policies/botox.json. The expected list is the
    # exact ground-truth criteria from the hand-curated fixture; the
    # predicted list is a realistic AI-ingestion output we'd see if we ran
    # `policy_ingestion.py` against the real PDF — paraphrased slightly to
    # exercise the Jaccard matching.
    s5_ocr = "\n".join([
        _line("UHC Medical Policy — Botulinum Toxins A and B (CS)", 1),
        _line("Coverage Criteria for Chronic Migraine Prophylaxis", 2),
        _line("Diagnosis of chronic migraine defined by ALL of:", 3),
        _line("- 15 or more headache days per month", 4),
        _line("- 8 or more migraine days per month", 5),
        _line("- Each headache lasts 4 or more hours", 6),
        _line("History of failure (after a trial of at least two months),", 7),
        _line("contraindication, or intolerance to prophylactic therapy with", 8),
        _line("one agent from two of the following classes:", 9),
        _line("- Antidepressant (amitriptyline, venlafaxine)", 10),
        _line("- Antiepileptic (divalproex, topiramate)", 11),
        _line("- Beta blocker (atenolol, propranolol, nadolol, timolol, metoprolol)", 12),
        _line("Botox dose does not exceed 155 units administered intramuscularly", 13),
        _line("divided over 31 injection sites across 7 head and neck muscles", 14),
        _line("every 12 weeks", 15),
    ])
    s5_expected = [
        "Diagnosis of chronic migraine defined by ALL of: ≥15 headache days/month, ≥8 migraine days/month, headaches last ≥4 hours/day",
        "History of failure (after a trial of at least two months), contraindication, or intolerance to prophylactic therapy with one agent from two of the following classes: Antidepressant (amitriptyline, venlafaxine), Antiepileptic (divalproex, topiramate), Beta blocker (atenolol, propranolol, nadolol, timolol, metoprolol)",
        "Botox dose does not exceed 155 units administered intramuscularly divided over 31 injection sites across 7 head and neck muscles every 12 weeks",
    ]
    s5_predicted = [
        "Diagnosis of chronic migraine confirmed by all of: 15 or more headache days per month, 8 or more migraine days per month, each headache 4 or more hours",
        "Documented failure or intolerance of one prophylactic agent from at least two distinct drug classes including antidepressant, antiepileptic, or beta blocker; trial duration at least two months",
        "Botox total dose limited to 155 units intramuscularly across 31 injection sites in 7 head and neck muscles every 12 weeks",
    ]
    scenarios.append(PolicyScenario(
        name="hand-curated UHC Botox (real baseline)",
        ocr_full_text=s5_ocr,
        expected_criteria=s5_expected,
        predicted_criteria=s5_predicted,
    ))

    return scenarios


# ─── Mock harness ─────────────────────────────────────────────────────────────


def _build_ingestion_mock(scenario: PolicyScenario):
    """Build a stub `ingest_policy` that returns the scenario's predicted criteria.

    NOTE: this stub means the LLM and OCR pipelines never actually run. The
    eval is a matcher-tolerance calibration, NOT a measurement of Bedrock
    extraction quality. See module docstring for the upgrade path to a real
    eval mode.
    """

    async def fake_ingest(
        pdf_path: str,
        policy_id: str,
        db_pool: Any | None = None,
    ) -> dict[str, Any]:
        criteria_out = [
            {
                "ordinal": i + 1,
                "text": text,
                "evidence_hint": None,
                "upload_hint": None,
                "group": None,
                "group_operator": None,
                "source_line_numbers": [],
                "source_bboxes": [],
                "required_codes": [],
            }
            for i, text in enumerate(scenario.predicted_criteria)
        ]
        return {
            "policy_id": policy_id,
            "criteria": criteria_out,
            "model": "claude-sonnet-4-5",
            "prompt_version": "policy_ingestion_v1",
            "cached": False,
        }

    return fake_ingest


# ─── Metrics ──────────────────────────────────────────────────────────────────


@dataclass
class ScenarioMetrics:
    name: str
    expected_count: int
    predicted_count: int
    tp: int
    fp: int
    fn: int
    precision: float
    recall: float
    f1: float
    avg_match_similarity: float


def _compute_metrics(
    scenario: PolicyScenario,
    predicted_texts: list[str],
) -> ScenarioMetrics:
    """Greedy best-match between expected and predicted criterion texts.

    Returns precision / recall / F1 against `expected_criteria`. The match
    threshold is `MATCH_THRESHOLD` (Jaccard ≥ 0.30).
    """
    remaining = list(predicted_texts)
    matched_similarities: list[float] = []
    tp = 0
    fn = 0

    for expected in scenario.expected_criteria:
        if not remaining:
            fn += 1
            continue
        best_idx = max(
            range(len(remaining)),
            key=lambda i: _jaccard(expected, remaining[i]),
        )
        best_sim = _jaccard(expected, remaining[best_idx])
        if best_sim >= MATCH_THRESHOLD:
            tp += 1
            matched_similarities.append(best_sim)
            remaining.pop(best_idx)
        else:
            fn += 1

    fp = len(remaining)
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0
    avg_sim = sum(matched_similarities) / len(matched_similarities) if matched_similarities else 0.0

    return ScenarioMetrics(
        name=scenario.name,
        expected_count=len(scenario.expected_criteria),
        predicted_count=len(predicted_texts),
        tp=tp,
        fp=fp,
        fn=fn,
        precision=precision,
        recall=recall,
        f1=f1,
        avg_match_similarity=avg_sim,
    )


# ─── Eval driver ──────────────────────────────────────────────────────────────


async def _run_scenario(scenario: PolicyScenario) -> ScenarioMetrics:
    """Invoke the (mocked) ingestion pipeline and score the output."""

    fake_ingest = _build_ingestion_mock(scenario)

    # Patch at the policy_rescrape level — that's the surface our orchestrator
    # uses. We don't go through policy_rescrape.rescrape_payer_policies here
    # because that requires a DB pool; the eval is about extraction-quality
    # only, not persistence.
    with patch(
        "services.ai.policy_ingestion.ingest_policy",
        side_effect=fake_ingest,
    ):
        from services.ai.policy_ingestion import ingest_policy  # noqa: PLC0415

        result = await ingest_policy(
            pdf_path=f"/synthetic/{scenario.name}.pdf",
            policy_id=f"eval-{scenario.name}",
            db_pool=None,
        )

    predicted_texts = [c["text"] for c in result.get("criteria", [])]
    return _compute_metrics(scenario, predicted_texts)


async def _run_all(scenarios: list[PolicyScenario]) -> list[ScenarioMetrics]:
    return [await _run_scenario(s) for s in scenarios]


def run(verbose: bool = True) -> dict[str, Any]:
    """Run the full eval suite and return aggregate metrics."""
    scenarios = _build_scenarios()
    per_scenario = asyncio.run(_run_all(scenarios))

    total_tp = sum(m.tp for m in per_scenario)
    total_fp = sum(m.fp for m in per_scenario)
    total_fn = sum(m.fn for m in per_scenario)
    precision = total_tp / (total_tp + total_fp) if (total_tp + total_fp) > 0 else 0.0
    recall = total_tp / (total_tp + total_fn) if (total_tp + total_fn) > 0 else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0

    if verbose:
        print("\n=== policy_ingestion_eval results ===")
        for m in per_scenario:
            print(
                f"  {m.name:45s}  P={m.precision:.2f}  R={m.recall:.2f}  F1={m.f1:.2f}  "
                f"(TP={m.tp} FP={m.fp} FN={m.fn})  sim={m.avg_match_similarity:.2f}",
            )
        print("---")
        print(
            f"  {'AGGREGATE':45s}  P={precision:.2f}  R={recall:.2f}  F1={f1:.2f}  "
            f"(TP={total_tp} FP={total_fp} FN={total_fn})",
        )
        print(
            f"  thresholds (PROPOSED — no TESTING.md row yet): "
            f"F1>={F1_THRESHOLD} (got {f1:.2f})  "
            f"recall>={RECALL_THRESHOLD} (got {recall:.2f})  "
            f"precision>={PRECISION_THRESHOLD} (got {precision:.2f})",
        )

    return {
        "scenarios": per_scenario,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "tp": total_tp,
        "fp": total_fp,
        "fn": total_fn,
    }


# ─── Pytest entry point ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_policy_ingestion_eval_meets_proposed_thresholds(capsys):
    """Aggregate F1, recall, and precision meet PROPOSED thresholds."""
    scenarios = _build_scenarios()
    per_scenario = await _run_all(scenarios)

    total_tp = sum(m.tp for m in per_scenario)
    total_fp = sum(m.fp for m in per_scenario)
    total_fn = sum(m.fn for m in per_scenario)
    precision = total_tp / (total_tp + total_fp) if (total_tp + total_fp) > 0 else 0.0
    recall = total_tp / (total_tp + total_fn) if (total_tp + total_fn) > 0 else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0

    print("\n=== policy_ingestion_eval per-scenario ===")
    for m in per_scenario:
        print(
            f"  {m.name:45s}  P={m.precision:.2f}  R={m.recall:.2f}  F1={m.f1:.2f}  "
            f"(TP={m.tp} FP={m.fp} FN={m.fn})",
        )
    print(f"  AGGREGATE  P={precision:.2f}  R={recall:.2f}  F1={f1:.2f}")

    out = capsys.readouterr().out
    assert "AGGREGATE" in out

    assert recall >= RECALL_THRESHOLD, (
        f"Aggregate recall {recall:.3f} fell below PROPOSED threshold {RECALL_THRESHOLD}"
    )
    assert precision >= PRECISION_THRESHOLD, (
        f"Aggregate precision {precision:.3f} fell below PROPOSED threshold {PRECISION_THRESHOLD}"
    )
    assert f1 >= F1_THRESHOLD, (
        f"Aggregate F1 {f1:.3f} fell below PROPOSED threshold {F1_THRESHOLD}"
    )


if __name__ == "__main__":
    run(verbose=True)
