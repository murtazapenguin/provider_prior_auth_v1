"""Tests for Phase 6 — policy rescrape orchestrator.

Run: pytest services/ai/tests/test_policy_rescrape.py -v

Coverage (per orchestrator override §10):
  1. Empty pdf list → empty result, no DB writes.
  2. Single PDF → Policy row written at publishStatus='draft' with title
     derived from the filename.
  3. Single PDF → one PolicyCriterion row inserted per ingested criterion,
     with all expected columns mapped (text, evidence_hint, upload_hint,
     required_codes, group, group_operator, sourceLineNumbers, sourceBboxes).
  4. Multiple PDFs → one Policy + N criteria rows per PDF; returned id
     list is in input order.
  5. ingest_policy raises → that PDF is skipped, others still proceed.
  6. Missing PDF path → skipped (no DB writes for that one).
  7. Title derivation from a hyphenated filename.
  8. db_pool=None → raises RuntimeError before any LLM call.
  9. default_source_url_prefix joins correctly.

LLM and OCR are fully mocked. asyncpg pool is a MagicMock with
AsyncMock-typed `execute`. We never touch a real database.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.ai.policy_rescrape import (
    _derive_policy_metadata,
    rescrape_payer_policies,
)


# ─── Pool fixture ─────────────────────────────────────────────────────────────


def _make_pool() -> MagicMock:
    """Build a MagicMock asyncpg pool. `execute` is an AsyncMock so we can
    inspect every SQL call after the orchestrator runs.
    """
    pool = MagicMock()
    pool.execute = AsyncMock(return_value="INSERT 0 1")
    pool.fetchrow = AsyncMock(return_value=None)
    pool.fetch = AsyncMock(return_value=[])
    return pool


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _make_ingest_response(*texts: str) -> dict[str, Any]:
    return {
        "policy_id": "ignored-by-orchestrator",  # orchestrator generates its own
        "criteria": [
            {
                "ordinal": i + 1,
                "text": text,
                "evidence_hint": f"hint for {text[:20]}",
                "upload_hint": f"upload hint for {text[:20]}",
                "group": None,
                "group_operator": None,
                "source_line_numbers": [i + 1, i + 2],
                "source_bboxes": [
                    {"document_name": "doc.pdf", "page_number": 1, "bbox": [[0, 0, 1, 0, 1, 1, 0, 1]]},
                ],
                "required_codes": [],
            }
            for i, text in enumerate(texts)
        ],
        "model": "claude-sonnet-4-5",
        "prompt_version": "policy_ingestion_v1",
        "cached": False,
    }


def _executed_sqls(pool: MagicMock) -> list[str]:
    return [c.args[0] for c in pool.execute.call_args_list]


def _count_inserts_into(pool: MagicMock, table: str) -> int:
    needle = f'INTO "{table}"'
    return sum(1 for sql in _executed_sqls(pool) if needle in sql)


# ─── Title derivation ────────────────────────────────────────────────────────


def test_derive_policy_metadata_from_hyphenated_filename():
    meta = _derive_policy_metadata("/abs/path/botulinum-toxins-a-and-b-cs.pdf")
    assert meta["title"] == "Botulinum Toxins A And B Cs"
    assert meta["external_id"] == "botulinum-toxins-a-and-b-cs"


def test_derive_policy_metadata_from_underscore_filename():
    meta = _derive_policy_metadata("/abs/path/some_policy_name.pdf")
    assert meta["title"] == "Some Policy Name"
    assert meta["external_id"] == "some_policy_name"


def test_derive_policy_metadata_no_path():
    meta = _derive_policy_metadata("simple.pdf")
    assert meta["title"] == "Simple"
    assert meta["external_id"] == "simple"


# ─── Public API ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_rescrape_empty_pdf_list_returns_empty():
    """No pdfs → empty list returned, no DB writes."""
    pool = _make_pool()
    out = await rescrape_payer_policies(payer_id="payer-uhc", pdf_paths=[], db_pool=pool)
    assert out == []
    pool.execute.assert_not_called()


@pytest.mark.asyncio
async def test_rescrape_writes_draft_policy(tmp_path, monkeypatch):
    """Single PDF → one Policy INSERT at publishStatus='draft'."""
    pdf = tmp_path / "test-policy.pdf"
    pdf.write_bytes(b"%PDF-1.4 dummy content")
    pool = _make_pool()

    fake_ingest = AsyncMock(return_value=_make_ingest_response("Patient must have diagnosis X."))
    with patch("services.ai.policy_rescrape.ingest_policy", fake_ingest):
        new_ids = await rescrape_payer_policies(
            payer_id="payer-uhc",
            pdf_paths=[str(pdf)],
            db_pool=pool,
        )

    assert len(new_ids) == 1
    fake_ingest.assert_awaited_once()

    # Verify Policy INSERT happened with publishStatus='draft'.
    sqls = _executed_sqls(pool)
    policy_inserts = [s for s in sqls if 'INTO "Policy"' in s]
    assert len(policy_inserts) == 1
    assert "'draft'" in policy_inserts[0]
    # publishedAt + publishedBy + policyVersion all NULL on a draft.
    assert "NULL, NULL, NULL" in policy_inserts[0]


@pytest.mark.asyncio
async def test_rescrape_writes_one_criterion_row_per_extracted_criterion(tmp_path):
    """Multi-criterion ingestion → matching number of PolicyCriterion rows."""
    pdf = tmp_path / "multi-criteria.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    pool = _make_pool()

    fake_ingest = AsyncMock(
        return_value=_make_ingest_response(
            "Criterion alpha — diagnosis confirmed",
            "Criterion beta — age threshold met",
            "Criterion gamma — prior therapy failed",
        ),
    )
    with patch("services.ai.policy_rescrape.ingest_policy", fake_ingest):
        await rescrape_payer_policies(
            payer_id="payer-uhc",
            pdf_paths=[str(pdf)],
            db_pool=pool,
        )

    # 1 Policy INSERT + 3 PolicyCriterion INSERTs.
    assert _count_inserts_into(pool, "Policy") == 1
    assert _count_inserts_into(pool, "PolicyCriterion") == 3

    # Spot check: criterion args include the text and ordinal we provided.
    criterion_calls = [c for c in pool.execute.call_args_list if 'INTO "PolicyCriterion"' in c.args[0]]
    texts = [c.args[4] for c in criterion_calls]
    ordinals = [c.args[3] for c in criterion_calls]
    assert "Criterion alpha — diagnosis confirmed" in texts
    assert "Criterion gamma — prior therapy failed" in texts
    assert ordinals == [1, 2, 3]


@pytest.mark.asyncio
async def test_rescrape_persists_criterion_fields(tmp_path):
    """All criterion fields (text, hints, line numbers, bboxes) flow through."""
    pdf = tmp_path / "policy.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    pool = _make_pool()

    fake_ingest = AsyncMock(return_value=_make_ingest_response("Some criterion text"))
    with patch("services.ai.policy_rescrape.ingest_policy", fake_ingest):
        await rescrape_payer_policies(
            payer_id="payer-uhc",
            pdf_paths=[str(pdf)],
            db_pool=pool,
        )

    criterion_calls = [c for c in pool.execute.call_args_list if 'INTO "PolicyCriterion"' in c.args[0]]
    assert len(criterion_calls) == 1
    call_args = criterion_calls[0].args
    # Positional args: id, policyId, ordinal, text, evidence_hint, upload_hint,
    # required_codes, group, group_operator, source_bboxes_json, source_line_numbers
    assert call_args[3] == 1  # ordinal
    assert call_args[4] == "Some criterion text"  # text
    assert "hint for Some criterion te" in call_args[5]  # evidence_hint
    assert "upload hint" in call_args[6]  # upload_hint
    assert call_args[7] == []  # required_codes
    assert call_args[8] is None  # group
    assert call_args[9] is None  # group_operator
    assert call_args[10] is not None  # source_bboxes (json string)
    assert call_args[11] == [1, 2]  # source_line_numbers


@pytest.mark.asyncio
async def test_rescrape_multiple_pdfs_writes_one_policy_per(tmp_path):
    """N PDFs → N Policy INSERTs, in input order."""
    pdf_a = tmp_path / "alpha.pdf"
    pdf_b = tmp_path / "beta.pdf"
    pdf_a.write_bytes(b"%PDF-1.4")
    pdf_b.write_bytes(b"%PDF-1.4")
    pool = _make_pool()

    fake_ingest = AsyncMock(
        side_effect=[
            _make_ingest_response("alpha crit"),
            _make_ingest_response("beta crit one", "beta crit two"),
        ],
    )
    with patch("services.ai.policy_rescrape.ingest_policy", fake_ingest):
        new_ids = await rescrape_payer_policies(
            payer_id="payer-uhc",
            pdf_paths=[str(pdf_a), str(pdf_b)],
            db_pool=pool,
        )

    assert len(new_ids) == 2
    assert _count_inserts_into(pool, "Policy") == 2
    assert _count_inserts_into(pool, "PolicyCriterion") == 3  # 1 + 2
    assert fake_ingest.await_count == 2

    # Verify the policy ids on the row inserts match new_ids in order.
    policy_calls = [c for c in pool.execute.call_args_list if 'INTO "Policy"' in c.args[0]]
    written_policy_ids = [c.args[1] for c in policy_calls]  # id is the 1st bind param
    assert written_policy_ids == new_ids


@pytest.mark.asyncio
async def test_rescrape_skips_pdf_when_ingestion_raises(tmp_path, caplog):
    """ingest_policy raises → that PDF is skipped, other PDFs still proceed."""
    pdf_a = tmp_path / "failing.pdf"
    pdf_b = tmp_path / "succeeding.pdf"
    pdf_a.write_bytes(b"%PDF-1.4")
    pdf_b.write_bytes(b"%PDF-1.4")
    pool = _make_pool()

    fake_ingest = AsyncMock(
        side_effect=[
            RuntimeError("OCR exploded"),
            _make_ingest_response("good criterion"),
        ],
    )
    with patch("services.ai.policy_rescrape.ingest_policy", fake_ingest):
        new_ids = await rescrape_payer_policies(
            payer_id="payer-uhc",
            pdf_paths=[str(pdf_a), str(pdf_b)],
            db_pool=pool,
        )

    # Only the successful one made it through.
    assert len(new_ids) == 1
    assert _count_inserts_into(pool, "Policy") == 1
    assert _count_inserts_into(pool, "PolicyCriterion") == 1


@pytest.mark.asyncio
async def test_rescrape_skips_missing_pdf_path(tmp_path):
    """Missing PDF on disk → that path is skipped, others proceed."""
    real_pdf = tmp_path / "exists.pdf"
    real_pdf.write_bytes(b"%PDF-1.4")
    missing_pdf = tmp_path / "missing.pdf"

    pool = _make_pool()
    fake_ingest = AsyncMock(return_value=_make_ingest_response("crit"))
    with patch("services.ai.policy_rescrape.ingest_policy", fake_ingest):
        new_ids = await rescrape_payer_policies(
            payer_id="payer-uhc",
            pdf_paths=[str(missing_pdf), str(real_pdf)],
            db_pool=pool,
        )

    assert len(new_ids) == 1
    # Only the existing PDF was ingested.
    assert fake_ingest.await_count == 1


@pytest.mark.asyncio
async def test_rescrape_requires_db_pool(tmp_path):
    """db_pool=None must raise — we never want a silent no-op."""
    pdf = tmp_path / "x.pdf"
    pdf.write_bytes(b"%PDF-1.4")

    fake_ingest = AsyncMock(return_value=_make_ingest_response("crit"))
    with patch("services.ai.policy_rescrape.ingest_policy", fake_ingest):
        with pytest.raises(RuntimeError, match="database pool"):
            await rescrape_payer_policies(
                payer_id="payer-uhc",
                pdf_paths=[str(pdf)],
                db_pool=None,
            )


@pytest.mark.asyncio
async def test_rescrape_derives_title_from_pdf_filename(tmp_path):
    """The title arg on the Policy INSERT matches the filename-derived title."""
    pdf = tmp_path / "botulinum-toxins-a-and-b-cs.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    pool = _make_pool()

    fake_ingest = AsyncMock(return_value=_make_ingest_response("crit"))
    with patch("services.ai.policy_rescrape.ingest_policy", fake_ingest):
        await rescrape_payer_policies(
            payer_id="payer-uhc",
            pdf_paths=[str(pdf)],
            db_pool=pool,
        )

    policy_calls = [c for c in pool.execute.call_args_list if 'INTO "Policy"' in c.args[0]]
    assert len(policy_calls) == 1
    # bind-args by position: id, payerId, policyType, externalId, title, effectiveFrom, sourceUrl
    args = policy_calls[0].args
    assert args[2] == "payer-uhc"  # payerId
    assert args[3] == "MedicalPolicy"  # policyType default
    assert args[4] == "botulinum-toxins-a-and-b-cs"  # externalId
    assert args[5] == "Botulinum Toxins A And B Cs"  # title


@pytest.mark.asyncio
async def test_rescrape_default_source_url_prefix(tmp_path):
    """When default_source_url_prefix is set, sourceUrl is prefix + basename."""
    pdf = tmp_path / "p.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    pool = _make_pool()

    fake_ingest = AsyncMock(return_value=_make_ingest_response("crit"))
    with patch("services.ai.policy_rescrape.ingest_policy", fake_ingest):
        await rescrape_payer_policies(
            payer_id="payer-uhc",
            pdf_paths=[str(pdf)],
            db_pool=pool,
            default_source_url_prefix="UHC/medical-policies",
        )

    policy_calls = [c for c in pool.execute.call_args_list if 'INTO "Policy"' in c.args[0]]
    # sourceUrl is the 8th positional bind ($7 in the SQL, 0-indexed arg position 7).
    args = policy_calls[0].args
    assert args[7] == "UHC/medical-policies/p.pdf"


@pytest.mark.asyncio
async def test_rescrape_skips_non_absolute_path(tmp_path, caplog):
    """A relative pdf_path is skipped — we expect absolute paths only."""
    pool = _make_pool()
    fake_ingest = AsyncMock(return_value=_make_ingest_response("crit"))
    with patch("services.ai.policy_rescrape.ingest_policy", fake_ingest):
        new_ids = await rescrape_payer_policies(
            payer_id="payer-uhc",
            pdf_paths=["relative/path.pdf"],
            db_pool=pool,
        )
    assert new_ids == []
    fake_ingest.assert_not_called()


@pytest.mark.asyncio
async def test_rescrape_writes_empty_policy_when_no_criteria_extracted(tmp_path):
    """LLM returns zero criteria → Policy row still written (reviewers can re-trigger)."""
    pdf = tmp_path / "empty.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    pool = _make_pool()

    fake_ingest = AsyncMock(return_value=_make_ingest_response())  # zero criteria
    with patch("services.ai.policy_rescrape.ingest_policy", fake_ingest):
        new_ids = await rescrape_payer_policies(
            payer_id="payer-uhc",
            pdf_paths=[str(pdf)],
            db_pool=pool,
        )

    assert len(new_ids) == 1
    assert _count_inserts_into(pool, "Policy") == 1
    assert _count_inserts_into(pool, "PolicyCriterion") == 0


# ─── Phase 7 (policy_ingestion_v2): applicable_codes / PolicyCode ─────────────


@pytest.mark.asyncio
async def test_rescrape_writes_one_policycode_row_per_extracted_code(tmp_path):
    """LLM emits N applicable_codes → N PolicyCode INSERTs land."""
    pdf = tmp_path / "cardiac-stress-test.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    pool = _make_pool()

    ingest_response = _make_ingest_response("Patient must have chest pain.")
    ingest_response["applicable_codes"] = [
        {"code_type": "CPT", "code": "93016", "modifier": None, "pos_codes": []},
        {"code_type": "CPT", "code": "93017", "modifier": None, "pos_codes": ["11", "22"]},
        {"code_type": "HCPCS", "code": "J9999", "modifier": "26", "pos_codes": []},
    ]
    fake_ingest = AsyncMock(return_value=ingest_response)

    with patch("services.ai.policy_rescrape.ingest_policy", fake_ingest):
        new_ids = await rescrape_payer_policies(
            payer_id="payer-uhc",
            pdf_paths=[str(pdf)],
            db_pool=pool,
        )

    assert len(new_ids) == 1
    assert _count_inserts_into(pool, "PolicyCode") == 3

    # Inspect the PolicyCode insert call args for shape.
    code_calls = [
        c.args for c in pool.execute.call_args_list if 'INTO "PolicyCode"' in c.args[0]
    ]
    # Each call's positional args after the SQL: (id, policyId, codeType, code, modifier, posCodes)
    code_types = [c[3] for c in code_calls]
    codes = [c[4] for c in code_calls]
    modifiers = [c[5] for c in code_calls]
    pos = [c[6] for c in code_calls]
    assert code_types == ["CPT", "CPT", "HCPCS"]
    assert codes == ["93016", "93017", "J9999"]
    assert modifiers == [None, None, "26"]
    assert pos == [[], ["11", "22"], []]


@pytest.mark.asyncio
async def test_rescrape_warns_and_writes_no_codes_when_extraction_empty(tmp_path, caplog):
    """LLM emits zero codes → Policy still persists; warning logged; no PolicyCode rows."""
    pdf = tmp_path / "general-guideline.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    pool = _make_pool()

    ingest_response = _make_ingest_response("A general clinical guideline criterion.")
    ingest_response["applicable_codes"] = []  # explicitly empty
    fake_ingest = AsyncMock(return_value=ingest_response)

    with caplog.at_level("WARNING"):
        with patch("services.ai.policy_rescrape.ingest_policy", fake_ingest):
            new_ids = await rescrape_payer_policies(
                payer_id="payer-uhc",
                pdf_paths=[str(pdf)],
                db_pool=pool,
            )

    assert len(new_ids) == 1
    assert _count_inserts_into(pool, "Policy") == 1
    assert _count_inserts_into(pool, "PolicyCode") == 0
    assert any(
        "ZERO applicable codes" in record.message and "unreachable" in record.message
        for record in caplog.records
    )


@pytest.mark.asyncio
async def test_rescrape_handles_missing_applicable_codes_key_gracefully(tmp_path):
    """Back-compat: ingestion_result lacking the applicable_codes key behaves like empty list."""
    pdf = tmp_path / "back-compat.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    pool = _make_pool()

    # Use the legacy _make_ingest_response shape (no applicable_codes key).
    fake_ingest = AsyncMock(return_value=_make_ingest_response("Some criterion."))
    with patch("services.ai.policy_rescrape.ingest_policy", fake_ingest):
        new_ids = await rescrape_payer_policies(
            payer_id="payer-uhc",
            pdf_paths=[str(pdf)],
            db_pool=pool,
        )

    assert len(new_ids) == 1
    assert _count_inserts_into(pool, "PolicyCode") == 0
