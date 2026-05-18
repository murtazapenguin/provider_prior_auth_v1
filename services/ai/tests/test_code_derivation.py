"""Tests for Task 1 — code derivation.

Run: pytest services/ai/tests/test_code_derivation.py -v

Tests cover:
- 401 without a valid Bearer token
- Head CT encounter → CPT 70450 + ICD-10 R51.9 (or G43.909)
- Knee MRI encounter → CPT 73721 + ICD-10 M23.231
- Botox encounter → HCPCS J0585 + ICD-10 G43.701
- Second call with identical input returns cached=true
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ─── Demo encounter fixtures (derived from prisma/fixtures/encounters/) ───────

HEAD_CT_NOTES = [
    {
        "id": "note-head-ct-hp",
        "note_type": "H&P",
        "author_role": "PCP",
        "text": (
            "HISTORY & PHYSICAL\n\nChief Complaint: New-onset severe headache for 3 days.\n\n"
            "The onset was thunderclap in quality — maximal intensity within seconds of onset. "
            "No prior history of similar headache episodes. Photophobia and mild phonophobia present. "
            "Red flags documented: thunderclap onset, new worst-ever headache pattern, photophobia.\n\n"
            "NEUROLOGICAL EXAMINATION: Cranial nerves II-XII intact. Motor 5/5 strength bilaterally. "
            "Reflexes 2+ throughout. Plantar reflexes downgoing bilaterally. Gait normal.\n\n"
            "ASSESSMENT: New-onset severe headache with thunderclap quality and red flag features. "
            "Differential: subarachnoid hemorrhage must rule out emergently.\n\n"
            "PLAN: Order CT scan of the head/brain without contrast (CPT 70450). "
            "ICD-10 codes: R51.9 (Headache, unspecified) — primary working diagnosis pending imaging."
        ),
    }
]

KNEE_MRI_NOTES = [
    {
        "id": "note-knee-mri-ortho-consult",
        "note_type": "Consult",
        "author_role": "Orthopedic Surgeon",
        "text": (
            "ORTHOPEDIC CONSULTATION NOTE\n\n"
            "Chief Complaint: Right knee pain for 4 months, worsening, not responding to treatment.\n\n"
            "McMurray Test: Positive — pain and click with valgus stress and external tibial rotation "
            "(suggestive of medial meniscal pathology). Apley's Compression Test: Positive.\n\n"
            "ASSESSMENT: Suspected medial meniscal tear, right knee. Conservative measures have failed "
            "per patient report. Diagnosis: M23.231 — Derangement of anterior horn of medial meniscus "
            "due to old tear or injury, right knee.\n\n"
            "PLAN: Order MRI right knee without contrast (CPT 73721). Imaging will directly change "
            "clinical management.\n\n"
            "ICD-10 codes: M23.231 (Derangement of anterior horn of medial meniscus due to old tear "
            "or injury, right knee) — primary working diagnosis"
        ),
    }
]

BOTOX_NOTES = [
    {
        "id": "note-botox-neuro-progress",
        "note_type": "Progress",
        "author_role": "Neurologist",
        "text": (
            "NEUROLOGY PROGRESS NOTE\n\n"
            "Chronic migraine without aura, intractable — ICD-10: G43.701. "
            "Patient meets diagnostic criteria for chronic migraine (≥15 headache days/month with ≥8 "
            "migraine-quality days/month, each lasting ≥4 hours). "
            "Failure of adequate trials: Propranolol (4 months, beta blocker class) and Topiramate "
            "(3 months, antiepileptic class).\n\n"
            "PLAN: Initiate onabotulinumtoxinA (Botox) per PREEMPT: 155 units across 31 injection "
            "sites across 7 head and neck muscles every 12 weeks. "
            "Order: HCPCS J0585 — OnabotulinumtoxinA, per unit (155 units total).\n\n"
            "ICD-10 codes: G43.701 — Chronic migraine without aura, intractable, without status "
            "migrainosus (primary)"
        ),
    }
]


# ─── LLM mock factories ───────────────────────────────────────────────────────

def _make_head_ct_result():
    """Simulate LLM structured output for Head CT."""
    from services.ai.code_derivation import DerivedCodes, DiagnosisCode, ProcedureCode

    return DerivedCodes(
        procedures=[
            ProcedureCode(
                code_type="CPT",
                code="70450",
                description="CT scan of head/brain without contrast",
                confidence=0.97,
                rationale="Plan section orders 'CT scan of the head/brain without contrast (CPT 70450)' for evaluation of thunderclap headache.",
            )
        ],
        diagnoses=[
            DiagnosisCode(
                code_type="ICD10",
                code="R51.9",
                description="Headache, unspecified",
                confidence=0.92,
                rationale="ICD-10 codes line in plan section: 'R51.9 (Headache, unspecified) — primary working diagnosis pending imaging'.",
                is_primary=True,
            )
        ],
    )


def _make_knee_mri_result():
    from services.ai.code_derivation import DerivedCodes, DiagnosisCode, ProcedureCode

    return DerivedCodes(
        procedures=[
            ProcedureCode(
                code_type="CPT",
                code="73721",
                description="MRI right knee without contrast",
                confidence=0.96,
                rationale="Plan section orders 'MRI right knee without contrast (CPT 73721)' to evaluate suspected medial meniscal tear.",
            )
        ],
        diagnoses=[
            DiagnosisCode(
                code_type="ICD10",
                code="M23.231",
                description="Derangement of anterior horn of medial meniscus due to old tear or injury, right knee",
                confidence=0.94,
                rationale="Assessment and ICD-10 section document 'M23.231 — Derangement of anterior horn of medial meniscus due to old tear or injury, right knee'.",
                is_primary=True,
            )
        ],
    )


def _make_botox_result():
    from services.ai.code_derivation import DerivedCodes, DiagnosisCode, ProcedureCode

    return DerivedCodes(
        procedures=[
            ProcedureCode(
                code_type="HCPCS",
                code="J0585",
                description="OnabotulinumtoxinA, per unit (155 units per PREEMPT protocol)",
                confidence=0.98,
                rationale="Plan orders 'HCPCS J0585 — OnabotulinumtoxinA, per unit (155 units total)' per PREEMPT chronic migraine protocol.",
            )
        ],
        diagnoses=[
            DiagnosisCode(
                code_type="ICD10",
                code="G43.701",
                description="Chronic migraine without aura, intractable, without status migrainosus",
                confidence=0.99,
                rationale="Assessment documents 'Chronic migraine without aura, intractable — ICD-10: G43.701' with full ICHD-3 criteria met.",
                is_primary=True,
            )
        ],
    )


# ─── Helper: build structured model mock ─────────────────────────────────────

def _make_structured_mock(result_factory):
    """Return a mock for model.with_structured_output(...).ainvoke(...)."""
    structured = MagicMock()
    structured.ainvoke = AsyncMock(return_value=result_factory())
    model_mock = MagicMock()
    model_mock.with_structured_output = MagicMock(return_value=structured)
    return model_mock


# ─── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture
def no_db_pool():
    """Simulates the app running without a DB connection (cache disabled)."""
    return None


@pytest.fixture
def db_pool_miss():
    """DB pool where every cache lookup returns None (cache miss)."""
    pool = AsyncMock()
    pool.fetchrow = AsyncMock(return_value=None)
    pool.execute = AsyncMock(return_value=None)
    return pool


def _make_db_pool_hit(payload: dict[str, Any]):
    """DB pool pre-loaded with a cached response."""
    import asyncpg

    pool = AsyncMock(spec=asyncpg.Pool)
    row = MagicMock()
    row.__getitem__ = lambda self, key: json.dumps(payload) if key == "response_json" else None
    pool.fetchrow = AsyncMock(return_value=row)
    pool.execute = AsyncMock(return_value=None)
    return pool


# ─── Auth guard test ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_derive_codes_requires_token(client):
    """Requests without a valid Bearer token must be rejected with 401."""
    resp = await client.post(
        "/derive-codes",
        json={
            "encounter_id": "enc-001",
            "notes": [{"id": "n1", "note_type": "H&P", "author_role": "PCP", "text": "headache"}],
        },
        # deliberately no Authorization header
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_derive_codes_wrong_token(client):
    resp = await client.post(
        "/derive-codes",
        json={
            "encounter_id": "enc-001",
            "notes": [{"id": "n1", "note_type": "H&P", "author_role": "PCP", "text": "headache"}],
        },
        headers={"Authorization": "Bearer wrong-token"},
    )
    assert resp.status_code == 401


# ─── Scenario 1: Head CT ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_head_ct_returns_cpt_70450(client):
    """Head CT encounter → CPT 70450 + ICD-10 R51.9 as primary."""
    model_mock = _make_structured_mock(_make_head_ct_result)

    with patch("services.ai.code_derivation.get_model", return_value=model_mock), \
         patch("services.ai.code_derivation.get_cached", new_callable=AsyncMock, return_value=None), \
         patch("services.ai.code_derivation.set_cached", new_callable=AsyncMock):

        resp = await client.post(
            "/derive-codes",
            json={
                "encounter_id": "encounter-head-ct",
                "notes": HEAD_CT_NOTES,
                "indication": "New-onset thunderclap headache, CT head ordered to rule out SAH",
            },
            headers={"Authorization": "Bearer test-token"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()

    procedure_codes = [p["code"] for p in data["procedures"]]
    assert "70450" in procedure_codes, f"Expected CPT 70450 in procedures, got {procedure_codes}"

    procedure_types = [p["code_type"] for p in data["procedures"] if p["code"] == "70450"]
    assert procedure_types[0] in ("CPT", "HCPCS")

    primary_dx = [d for d in data["diagnoses"] if d.get("is_primary")]
    assert len(primary_dx) == 1, "Exactly one primary diagnosis required"
    assert primary_dx[0]["code"] in ("R51.9", "G43.909"), (
        f"Expected primary ICD-10 R51.9 or G43.909, got {primary_dx[0]['code']}"
    )

    assert data["cached"] is False
    assert data["prompt_version"] == "code_derivation_v1"


# ─── Scenario 2: Knee MRI ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_knee_mri_returns_cpt_73721(client):
    """Knee MRI encounter → CPT 73721 + ICD-10 M23.231."""
    model_mock = _make_structured_mock(_make_knee_mri_result)

    with patch("services.ai.code_derivation.get_model", return_value=model_mock), \
         patch("services.ai.code_derivation.get_cached", new_callable=AsyncMock, return_value=None), \
         patch("services.ai.code_derivation.set_cached", new_callable=AsyncMock):

        resp = await client.post(
            "/derive-codes",
            json={
                "encounter_id": "encounter-knee-mri",
                "notes": KNEE_MRI_NOTES,
            },
            headers={"Authorization": "Bearer test-token"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()

    procedure_codes = [p["code"] for p in data["procedures"]]
    assert "73721" in procedure_codes, f"Expected CPT 73721 in procedures, got {procedure_codes}"

    dx_codes = [d["code"] for d in data["diagnoses"]]
    assert "M23.231" in dx_codes, f"Expected ICD-10 M23.231 in diagnoses, got {dx_codes}"


# ─── Scenario 3: Botox ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_botox_returns_j0585(client):
    """Botox encounter → HCPCS J0585 + ICD-10 G43.701."""
    model_mock = _make_structured_mock(_make_botox_result)

    with patch("services.ai.code_derivation.get_model", return_value=model_mock), \
         patch("services.ai.code_derivation.get_cached", new_callable=AsyncMock, return_value=None), \
         patch("services.ai.code_derivation.set_cached", new_callable=AsyncMock):

        resp = await client.post(
            "/derive-codes",
            json={
                "encounter_id": "encounter-botox",
                "notes": BOTOX_NOTES,
                "indication": "Chronic migraine prophylaxis per PREEMPT protocol",
            },
            headers={"Authorization": "Bearer test-token"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()

    procedure_codes = [p["code"] for p in data["procedures"]]
    assert "J0585" in procedure_codes, f"Expected HCPCS J0585 in procedures, got {procedure_codes}"

    hcpcs_entry = next(p for p in data["procedures"] if p["code"] == "J0585")
    assert hcpcs_entry["code_type"] in ("HCPCS", "J")

    dx_codes = [d["code"] for d in data["diagnoses"]]
    g43_codes = [c for c in dx_codes if c.startswith("G43.7")]
    assert g43_codes, f"Expected ICD-10 G43.7xx for chronic migraine, got {dx_codes}"


# ─── Cache hit test ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_second_call_returns_cached(app, client):
    """Two consecutive identical requests — second must return cached=true.

    We inject a non-None sentinel pool onto app.state so the handler's
    `if db_pool is not None` guard activates, then we patch get_cached to
    return a pre-built cached payload.
    """
    sentinel_pool = AsyncMock()
    app.state.db_pool = sentinel_pool  # activate cache path in the handler

    cached_payload = {
        "procedures": [
            {
                "code_type": "CPT",
                "code": "70450",
                "modifier": None,
                "description": "CT head without contrast",
                "confidence": 0.97,
                "rationale": "Cached rationale.",
            }
        ],
        "diagnoses": [
            {
                "code_type": "ICD10",
                "code": "R51.9",
                "description": "Headache, unspecified",
                "confidence": 0.92,
                "rationale": "Cached rationale.",
                "is_primary": True,
            }
        ],
        "trace_id": None,
    }

    with patch(
        "services.ai.code_derivation.get_cached",
        new_callable=AsyncMock,
        return_value=cached_payload,
    ), patch("services.ai.code_derivation.set_cached", new_callable=AsyncMock):

        resp = await client.post(
            "/derive-codes",
            json={
                "encounter_id": "encounter-head-ct",
                "notes": HEAD_CT_NOTES,
                "indication": "thunderclap headache",
            },
            headers={"Authorization": "Bearer test-token"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["cached"] is True
    assert data["procedures"][0]["code"] == "70450"
    assert data["diagnoses"][0]["code"] == "R51.9"
    assert data["prompt_version"] == "code_derivation_v1"


# ─── Cache miss → LLM call → second request hits cache ───────────────────────

@pytest.mark.asyncio
async def test_cache_miss_then_hit_cycle(app, client):
    """First call: cache miss → LLM call → writes cache.
    Second call: reads from cache → cached=true.

    A sentinel pool is injected onto app.state so the cache code path runs.
    """
    sentinel_pool = AsyncMock()
    app.state.db_pool = sentinel_pool  # activate cache path in the handler

    stored: dict = {}

    async def fake_get_cached(pool, task, version, model, input_hash):
        return stored.get(input_hash)

    async def fake_set_cached(pool, task, version, model, input_hash, response, traced_to=None):
        stored[input_hash] = response

    model_mock = _make_structured_mock(_make_head_ct_result)

    body = {
        "encounter_id": "encounter-head-ct",
        "notes": HEAD_CT_NOTES,
        "indication": "thunderclap headache unique for cache test",
    }

    with patch("services.ai.code_derivation.get_model", return_value=model_mock), \
         patch("services.ai.code_derivation.get_cached", side_effect=fake_get_cached), \
         patch("services.ai.code_derivation.set_cached", side_effect=fake_set_cached):

        resp1 = await client.post(
            "/derive-codes",
            json=body,
            headers={"Authorization": "Bearer test-token"},
        )
        resp2 = await client.post(
            "/derive-codes",
            json=body,
            headers={"Authorization": "Bearer test-token"},
        )

    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert resp1.json()["cached"] is False, "First call must be a cache miss"
    assert resp2.json()["cached"] is True, "Second call with identical input must be a cache hit"
    # LLM should have been called exactly once (second call was served from cache)
    assert model_mock.with_structured_output.call_count == 1


# ─── Empty notes → empty procedures ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_empty_notes_returns_empty_procedures(client):
    """If the model cannot derive any procedure, it should return empty procedures."""
    from services.ai.code_derivation import DerivedCodes

    empty_result = DerivedCodes(procedures=[], diagnoses=[])
    model_mock = _make_structured_mock(lambda: empty_result)

    with patch("services.ai.code_derivation.get_model", return_value=model_mock), \
         patch("services.ai.code_derivation.get_cached", new_callable=AsyncMock, return_value=None), \
         patch("services.ai.code_derivation.set_cached", new_callable=AsyncMock):

        resp = await client.post(
            "/derive-codes",
            json={
                "encounter_id": "enc-empty",
                "notes": [
                    {
                        "id": "n-empty",
                        "note_type": "Progress",
                        "author_role": "PCP",
                        "text": "Patient seen for routine follow-up. No new complaints.",
                    }
                ],
            },
            headers={"Authorization": "Bearer test-token"},
        )

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["procedures"] == []
