"""S3 upload coverage for services.ai.policy_rescrape.

Verifies the Phase 7 S3-mirror layer:
- Successful local-write triggers an S3 put_object with the right key + body.
- S3 failure does NOT block — the local file remains, a warning logs.
- `upload_to_s3=False` skips S3 entirely (offline / no-creds path).
- Missing S3_OCR_STAGING_BUCKET env raises a clear RuntimeError.

boto3 client is mocked at `unittest.mock.patch('boto3.client')` to avoid
real S3 traffic. Run alongside the existing test_policy_rescrape.py suite.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.ai.policy_rescrape import rescrape_payer_policies


# ─── Fixtures ─────────────────────────────────────────────────────────────────


def _make_pool() -> MagicMock:
    pool = MagicMock()
    pool.execute = AsyncMock(return_value="INSERT 0 1")
    pool.fetchrow = AsyncMock(return_value=None)
    pool.fetch = AsyncMock(return_value=[])
    return pool


def _make_ingest_response_with_codes() -> dict[str, Any]:
    return {
        "policy_id": "ignored",
        "criteria": [
            {
                "ordinal": 1,
                "text": "Patient must have diagnosis X.",
                "evidence_hint": "Look for ICD code in HPI.",
                "upload_hint": "Upload H&P note.",
                "group": None,
                "group_operator": None,
                "source_line_numbers": [1],
                "source_bboxes": [],
                "required_codes": [],
            }
        ],
        "applicable_codes": [
            {"code_type": "CPT", "code": "12345", "modifier": None, "pos_codes": []},
        ],
        "model": "claude-sonnet-4-5",
        "prompt_version": "policy_ingestion_v2",
        "cached": False,
    }


# ─── Tests ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_s3_put_object_called_once_per_successful_ingest(tmp_path):
    """Each PDF that ingests cleanly triggers exactly one S3 put_object."""
    pdf = tmp_path / "test-policy.pdf"
    pdf.write_bytes(b"%PDF-1.4 dummy")
    out_dir = tmp_path / "policies-uhc"

    pool = _make_pool()
    fake_ingest = AsyncMock(return_value=_make_ingest_response_with_codes())
    fake_s3_client = MagicMock()

    with patch("services.ai.policy_rescrape.ingest_policy", fake_ingest), \
         patch("boto3.client", return_value=fake_s3_client), \
         patch("services.ai.config.get_settings") as mock_settings:
        mock_settings.return_value.s3_ocr_staging_bucket = "test-bucket"
        mock_settings.return_value.aws_region = "us-east-2"
        mock_settings.return_value.aws_access_key_id = "key"
        mock_settings.return_value.aws_secret_access_key = "secret"
        mock_settings.return_value.aws_session_token = "token"

        new_ids = await rescrape_payer_policies(
            payer_id="payer-uhc",
            pdf_paths=[str(pdf)],
            db_pool=pool,
            markdown_output_dir=str(out_dir),
        )

    assert len(new_ids) == 1
    assert fake_s3_client.put_object.call_count == 1
    call_kwargs = fake_s3_client.put_object.call_args.kwargs
    assert call_kwargs["Bucket"] == "test-bucket"
    assert call_kwargs["Key"] == "policies/uhc/test-policy.md"
    assert b"## Criterion 1" in call_kwargs["Body"]
    assert call_kwargs["ContentType"] == "text/markdown; charset=utf-8"
    assert call_kwargs["Metadata"]["external-id"] == "test-policy"


@pytest.mark.asyncio
async def test_local_file_persists_even_when_s3_upload_raises(tmp_path):
    """S3 put_object failure logs + continues; local .md file still exists."""
    pdf = tmp_path / "test-policy.pdf"
    pdf.write_bytes(b"%PDF-1.4 dummy")
    out_dir = tmp_path / "policies-uhc"

    pool = _make_pool()
    fake_ingest = AsyncMock(return_value=_make_ingest_response_with_codes())
    fake_s3_client = MagicMock()
    fake_s3_client.put_object.side_effect = RuntimeError("S3 down")

    with patch("services.ai.policy_rescrape.ingest_policy", fake_ingest), \
         patch("boto3.client", return_value=fake_s3_client), \
         patch("services.ai.config.get_settings") as mock_settings:
        mock_settings.return_value.s3_ocr_staging_bucket = "test-bucket"
        mock_settings.return_value.aws_region = "us-east-2"
        mock_settings.return_value.aws_access_key_id = "key"
        mock_settings.return_value.aws_secret_access_key = "secret"
        mock_settings.return_value.aws_session_token = "token"

        new_ids = await rescrape_payer_policies(
            payer_id="payer-uhc",
            pdf_paths=[str(pdf)],
            db_pool=pool,
            markdown_output_dir=str(out_dir),
        )

    # The policy still counts as successfully written (local file).
    assert len(new_ids) == 1
    # Local file is on disk.
    assert (out_dir / "test-policy.md").exists()


@pytest.mark.asyncio
async def test_upload_to_s3_false_skips_s3_entirely(tmp_path):
    """upload_to_s3=False produces local file only; boto3.client is never called."""
    pdf = tmp_path / "offline-policy.pdf"
    pdf.write_bytes(b"%PDF-1.4 dummy")
    out_dir = tmp_path / "policies-uhc"

    pool = _make_pool()
    fake_ingest = AsyncMock(return_value=_make_ingest_response_with_codes())

    with patch("services.ai.policy_rescrape.ingest_policy", fake_ingest), \
         patch("boto3.client") as mock_boto3:
        new_ids = await rescrape_payer_policies(
            payer_id="payer-uhc",
            pdf_paths=[str(pdf)],
            db_pool=pool,
            markdown_output_dir=str(out_dir),
            upload_to_s3=False,
        )

    assert len(new_ids) == 1
    assert (out_dir / "offline-policy.md").exists()
    mock_boto3.assert_not_called()  # S3 client never constructed


@pytest.mark.asyncio
async def test_missing_s3_bucket_env_raises_clear_error(tmp_path):
    """upload_to_s3=True + empty bucket env → RuntimeError before any ingest."""
    pdf = tmp_path / "test-policy.pdf"
    pdf.write_bytes(b"%PDF-1.4 dummy")
    out_dir = tmp_path / "policies-uhc"

    pool = _make_pool()
    fake_ingest = AsyncMock(return_value=_make_ingest_response_with_codes())

    with patch("services.ai.policy_rescrape.ingest_policy", fake_ingest), \
         patch("services.ai.config.get_settings") as mock_settings:
        mock_settings.return_value.s3_ocr_staging_bucket = ""  # not set
        mock_settings.return_value.aws_region = "us-east-2"
        mock_settings.return_value.aws_access_key_id = ""
        mock_settings.return_value.aws_secret_access_key = ""
        mock_settings.return_value.aws_session_token = ""

        with pytest.raises(RuntimeError, match="S3_OCR_STAGING_BUCKET"):
            await rescrape_payer_policies(
                payer_id="payer-uhc",
                pdf_paths=[str(pdf)],
                db_pool=pool,
                markdown_output_dir=str(out_dir),
                # upload_to_s3 defaults to True
            )

    # Bucket missing → early raise → ingest never called.
    fake_ingest.assert_not_called()


@pytest.mark.asyncio
async def test_custom_s3_key_prefix_is_used(tmp_path):
    """s3_key_prefix kwarg flows through to the S3 Key."""
    pdf = tmp_path / "custom-policy.pdf"
    pdf.write_bytes(b"%PDF-1.4 dummy")
    out_dir = tmp_path / "policies-uhc"

    pool = _make_pool()
    fake_ingest = AsyncMock(return_value=_make_ingest_response_with_codes())
    fake_s3_client = MagicMock()

    with patch("services.ai.policy_rescrape.ingest_policy", fake_ingest), \
         patch("boto3.client", return_value=fake_s3_client), \
         patch("services.ai.config.get_settings") as mock_settings:
        mock_settings.return_value.s3_ocr_staging_bucket = "test-bucket"
        mock_settings.return_value.aws_region = "us-east-2"
        mock_settings.return_value.aws_access_key_id = "k"
        mock_settings.return_value.aws_secret_access_key = "s"
        mock_settings.return_value.aws_session_token = "t"

        await rescrape_payer_policies(
            payer_id="payer-uhc",
            pdf_paths=[str(pdf)],
            db_pool=pool,
            markdown_output_dir=str(out_dir),
            s3_key_prefix="alt/path/",
        )

    call_kwargs = fake_s3_client.put_object.call_args.kwargs
    assert call_kwargs["Key"] == "alt/path/custom-policy.md"
