"""Task — Scheduled rescrape orchestrator for AI-ingested payer policies.

Thin orchestrator that wraps `services.ai.policy_ingestion.ingest_policy` and
persists the resulting `Policy` + `PolicyCriterion` rows at
`publishStatus='draft'`. A human (the Clinical Informaticist persona) reviews
draft policies before publishing them via the api-engineer's
`/admin/policies/[id]/publish` route (Phase 6 pair work).

HARD RULES (CLAUDE.md "Forbidden libraries"):
- No direct openai / anthropic / boto3-Bedrock / pytesseract imports — all
  AI / OCR goes through `services.ai.policy_ingestion`.
- No `prisma.policy.create()` from Python: the SQL INSERTs below use asyncpg
  the same way `services/ai/cache.py` does for `AiCallCache`.

SCOPE NOTE — Phase 6:
Vercel-Cron wiring (actually scheduling daily / weekly rescrapes) is
explicitly out of scope this phase. This module ships:
  1. `rescrape_payer_policies(...)` — importable callable.
  2. A `python -m services.ai.policy_rescrape <payer_id> <pdf_path>...` CLI
     entry point so an admin can trigger manually.

Real-cron handling lands in Phase 8 / closeout — see
`tasks/phase-6-foundation.md` "What this phase deliberately does NOT include".

USAGE:

    # Import path
    from services.ai.policy_rescrape import rescrape_payer_policies
    new_policy_ids = await rescrape_payer_policies(
        payer_id="payer-uhc",
        pdf_paths=["/abs/path/to/some-policy.pdf"],
        db_pool=app.state.db_pool,
    )

    # CLI path (uses DATABASE_URL from services/ai/.env)
    python -m services.ai.policy_rescrape payer-uhc /abs/path/to/some-policy.pdf
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, Sequence

from services.ai.policy_ingestion import ingest_policy

logger = logging.getLogger(__name__)


# ─── Metadata derivation ──────────────────────────────────────────────────────


def _derive_policy_metadata(pdf_path: str) -> dict[str, str]:
    """Derive Policy.title + Policy.externalId from a PDF file path.

    The LLM extraction in `policy_ingestion.py` returns only `criteria[]` —
    it does not surface policy-level metadata (title, external id, effective
    dates). For Phase 6 we synthesise these from the filename. A Clinical
    Informaticist edits them in the admin UI before publishing.

    Filename → title mapping:
        "botulinum-toxins-a-and-b-cs.pdf"
        → title: "Botulinum Toxins A And B Cs"
        → externalId: "botulinum-toxins-a-and-b-cs"
    """
    name = Path(pdf_path).stem  # strips ".pdf" and any directory
    title = re.sub(r"[-_]+", " ", name).strip().title()
    return {"title": title or "Untitled Policy", "external_id": name}


# ─── Persistence helpers (raw SQL — see cache.py for the pattern) ─────────────


def _now_utc() -> datetime:
    return datetime.now(tz=timezone.utc)


def _new_id() -> str:
    """Generate a Policy / PolicyCriterion id.

    Prisma's `@default(cuid())` is bypassed when Python writes the row, so we
    generate an id here. Prisma accepts any string id; using a UUID hex keeps
    things short and collision-resistant. The hand-curated policies use cuid
    ids (e.g. "policy-uhc-botox-chronic-migraine"); the AI-ingested ids look
    like 32-char hex.
    """
    return uuid.uuid4().hex


async def _persist_policy(
    *,
    pool: Any,
    policy_id: str,
    payer_id: str,
    policy_type: str,
    title: str,
    external_id: str,
    source_url: Optional[str],
    effective_from: datetime,
    criteria: list[dict[str, Any]],
    applicable_codes: list[dict[str, Any]] | None = None,
) -> None:
    """Insert a new Policy + its PolicyCriterion + PolicyCode rows at publishStatus='draft'.

    Phase 7 (policy_ingestion_v2): the LLM now extracts a policy-level
    `applicable_codes` list. Each entry becomes one PolicyCode row. Without
    these rows, the code-based lookup in `lib/policies/lookup.ts` cannot
    reach this policy — so an empty `applicable_codes` list is a signal
    the policy is unreachable and warrants admin attention.
    """
    if pool is None:
        raise RuntimeError(
            "rescrape_payer_policies requires a database pool; "
            "passing db_pool=None will skip persistence which defeats the purpose."
        )

    # Insert the Policy row.
    await pool.execute(
        '''
        INSERT INTO "Policy" (
            id, "payerId", "policyType", "externalId", title,
            "effectiveFrom", "effectiveTo", "sourceUrl",
            "pageImages",
            "publishStatus", "publishedAt", "publishedBy", "policyVersion"
        )
        VALUES (
            $1, $2, $3, $4, $5,
            $6, NULL, $7,
            NULL,
            'draft', NULL, NULL, NULL
        )
        ''',
        policy_id,
        payer_id,
        policy_type,
        external_id,
        title,
        effective_from,
        source_url,
    )

    # Insert each PolicyCriterion row.
    for criterion in criteria:
        criterion_id = _new_id()
        source_line_numbers = criterion.get("source_line_numbers") or []
        source_bboxes = criterion.get("source_bboxes") or []
        await pool.execute(
            '''
            INSERT INTO "PolicyCriterion" (
                id, "policyId", ordinal, text, "evidenceHint", "uploadHint",
                "requiredCodes", "group", "groupOperator",
                "sourceBboxes", "sourceLineNumbers"
            )
            VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9,
                $10::jsonb, $11
            )
            ''',
            criterion_id,
            policy_id,
            int(criterion.get("ordinal", 0)),
            str(criterion.get("text", "")),
            criterion.get("evidence_hint"),
            criterion.get("upload_hint"),
            list(criterion.get("required_codes") or []),
            criterion.get("group"),
            criterion.get("group_operator"),
            json.dumps(source_bboxes) if source_bboxes else None,
            list(source_line_numbers),
        )

    # Insert each PolicyCode row (Phase 7, policy_ingestion_v2).
    # A policy with zero codes is unreachable from lib/policies/lookup.ts; we
    # still persist the Policy row so a human can add codes via the admin UI
    # or by editing the markdown frontmatter, but we log a warning.
    codes = applicable_codes or []
    if not codes:
        logger.warning(
            "Policy %s persisted with ZERO applicable codes — it will be "
            "unreachable from PA code lookups until codes are added.",
            policy_id,
        )
    for code in codes:
        code_id = _new_id()
        await pool.execute(
            '''
            INSERT INTO "PolicyCode" (
                id, "policyId", "codeType", code, modifier, "posCodes"
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            ''',
            code_id,
            policy_id,
            str(code.get("code_type", "")).upper(),
            str(code.get("code", "")).upper(),
            code.get("modifier"),
            list(code.get("pos_codes") or []),
        )


# ─── Public callable ──────────────────────────────────────────────────────────


async def rescrape_payer_policies(
    payer_id: str,
    pdf_paths: Sequence[str],
    *,
    db_pool: Any,
    default_policy_type: str = "MedicalPolicy",
    default_source_url_prefix: Optional[str] = None,
    markdown_output_dir: Optional[str] = None,
    upload_to_s3: bool = True,
    s3_key_prefix: str = "policies/uhc/",
) -> list[str]:
    """Re-ingest each PDF and either persist as a draft Policy or emit markdown.

    Args:
        payer_id: FK into the `Payer` table. Must already exist (DB-direct mode).
        pdf_paths: Absolute paths to PDF files on disk. Each becomes one new
            `Policy` row (DB mode) OR one new `.md` file (markdown mode).
        db_pool: asyncpg pool. Always required — `ingest_policy` reads/writes
            the `AiCallCache` regardless of whether we persist Policy rows.
        default_policy_type: One of "MedicalPolicy" | "NCD" | "LCD". Stamped
            on every new Policy. Defaults to "MedicalPolicy" because that
            covers the UHC-style PDFs this pipeline handles.
        default_source_url_prefix: Optional prefix prepended to the basename
            when populating `Policy.sourceUrl`. None → the absolute path is
            stored verbatim.
        markdown_output_dir: Phase 7 onboarding path. When set, the
            orchestrator writes one `<external_id>.md` file per PDF under
            this directory and SKIPS the Policy / PolicyCriterion / PolicyCode
            inserts. A human reviews the markdown, then `prisma/seed/uhcPolicies.ts`
            handles the DB writes. When unset (default), the original
            DB-direct behavior is preserved.

    Returns:
        List of new policy ids — one per pdf_path that successfully ingested.
        In markdown mode, these are the ids written to the .md frontmatter
        (kebab-case `policy-uhc-{external-id}`). In DB mode, they are the
        uuid-hex ids inserted into Postgres. Failures are logged and skipped
        (other pdfs in the list still proceed).

    Side effects:
        DB mode (markdown_output_dir is None):
        - Writes one `Policy` row per pdf at `publishStatus='draft'`.
        - Writes one `PolicyCriterion` row per extracted criterion.
        - Writes one `PolicyCode` row per extracted applicable_code (v2+).
        - Caches the LLM response in `AiCallCache`.
        Markdown mode (markdown_output_dir set):
        - Writes one .md file per pdf to `{markdown_output_dir}/{external_id}.md`.
        - Caches the LLM response in `AiCallCache` (same as DB mode).
        - NO Postgres writes for Policy/PolicyCriterion/PolicyCode.
    """
    if not pdf_paths:
        return []

    # Fail loudly if the caller forgot the pool — db_pool=None means we'd
    # silently skip persistence, which defeats the purpose of the orchestrator.
    # Even markdown mode needs the pool for the AI cache layer.
    if db_pool is None:
        raise RuntimeError(
            "rescrape_payer_policies requires a database pool; "
            "passing db_pool=None would skip the AI cache."
        )

    # Resolve + create the markdown output directory up front so we fail fast
    # if it's misconfigured.
    s3_client = None
    s3_bucket = None
    if markdown_output_dir is not None:
        markdown_output_dir = os.path.abspath(markdown_output_dir)
        os.makedirs(markdown_output_dir, exist_ok=True)
        # Lazy import so DB-mode callers don't pay for it.
        from services.ai.policy_to_markdown import (  # noqa: PLC0415
            derive_policy_id,
            policy_to_markdown,
        )

        # Resolve S3 client when S3 mirror is enabled (the default unless
        # caller passes upload_to_s3=False).
        if upload_to_s3:
            from services.ai.config import get_settings  # noqa: PLC0415
            settings = get_settings()
            s3_bucket = settings.s3_ocr_staging_bucket
            if not s3_bucket:
                raise RuntimeError(
                    "upload_to_s3=True requires S3_OCR_STAGING_BUCKET env var. "
                    "Set it in services/ai/.env or pass upload_to_s3=False for local-only runs."
                )
            import boto3  # noqa: PLC0415  (boto3 for S3 is allowed per CLAUDE.md)
            s3_client = boto3.client(
                "s3",
                region_name=settings.aws_region,
                aws_access_key_id=settings.aws_access_key_id or None,
                aws_secret_access_key=settings.aws_secret_access_key or None,
                aws_session_token=settings.aws_session_token or None,
            )

    new_policy_ids: list[str] = []
    effective_from = _now_utc()

    for pdf_path in pdf_paths:
        if not os.path.isabs(pdf_path):
            logger.warning(
                "Skipping non-absolute pdf_path=%s (rescrape expects absolute paths)",
                pdf_path,
            )
            continue
        if not os.path.exists(pdf_path):
            logger.warning("Skipping missing pdf_path=%s", pdf_path)
            continue

        meta = _derive_policy_metadata(pdf_path)
        policy_id = _new_id()
        source_url = (
            f"{default_source_url_prefix.rstrip('/')}/{Path(pdf_path).name}"
            if default_source_url_prefix
            else pdf_path
        )

        # ── AI extraction (delegated to Phase 3 module) ──────────────────────
        try:
            ingestion_result = await ingest_policy(
                pdf_path=pdf_path,
                policy_id=policy_id,
                db_pool=db_pool,
            )
        except Exception:
            logger.exception(
                "ingest_policy failed for pdf=%s payer=%s — skipping",
                pdf_path,
                payer_id,
            )
            continue

        criteria = ingestion_result.get("criteria") or []
        applicable_codes = ingestion_result.get("applicable_codes") or []
        if not criteria:
            logger.warning(
                "No criteria extracted for pdf=%s — Policy row will be written "
                "with zero criteria so reviewers can re-trigger ingestion.",
                pdf_path,
            )

        # ── Persistence ──────────────────────────────────────────────────────
        if markdown_output_dir is not None:
            # Markdown mode (Phase 7 onboarding): emit one .md file per policy.
            md_policy_id = derive_policy_id(meta["external_id"], payer="uhc")
            md_path = os.path.join(markdown_output_dir, f"{meta['external_id']}.md")
            try:
                md_content = policy_to_markdown(
                    ingestion_result=ingestion_result,
                    pdf_path=pdf_path,
                    payer_id=payer_id,
                    policy_type=default_policy_type,
                    effective_from=effective_from.date().isoformat(),
                    title=meta["title"],
                )
                with open(md_path, "w", encoding="utf-8") as fh:
                    fh.write(md_content)
            except Exception:
                logger.exception(
                    "Markdown write failed for pdf=%s path=%s — skipping",
                    pdf_path,
                    md_path,
                )
                continue

            # Upload to S3 (canonical store). Local file is the dev/PR mirror.
            # Failure here is logged but doesn't block — the local file already
            # landed, and a manual `aws s3 sync` can push it later.
            if s3_client is not None and s3_bucket:
                s3_key = f"{s3_key_prefix.rstrip('/')}/{meta['external_id']}.md"
                try:
                    s3_client.put_object(
                        Bucket=s3_bucket,
                        Key=s3_key,
                        Body=md_content.encode("utf-8"),
                        ContentType="text/markdown; charset=utf-8",
                        Metadata={
                            "external-id": meta["external_id"],
                            "policy-version": "ai-ingested-v1",
                            "payer-id": payer_id,
                        },
                    )
                    logger.info(
                        "Uploaded to s3://%s/%s",
                        s3_bucket,
                        s3_key,
                    )
                except Exception:
                    logger.exception(
                        "S3 upload failed for pdf=%s key=%s — local file kept; "
                        "use scripts/policies/push-to-s3.sh later",
                        pdf_path,
                        s3_key,
                    )

            new_policy_ids.append(md_policy_id)
            logger.info(
                "Wrote markdown pdf=%s → %s (%d criteria + %d codes)",
                pdf_path,
                md_path,
                len(criteria),
                len(applicable_codes),
            )
            continue

        # DB-direct mode (Phase 6 path).
        try:
            await _persist_policy(
                pool=db_pool,
                policy_id=policy_id,
                payer_id=payer_id,
                policy_type=default_policy_type,
                title=meta["title"],
                external_id=meta["external_id"],
                source_url=source_url,
                effective_from=effective_from,
                criteria=criteria,
                applicable_codes=applicable_codes,
            )
        except Exception:
            logger.exception(
                "Persistence failed for policy_id=%s pdf=%s — skipping",
                policy_id,
                pdf_path,
            )
            continue

        new_policy_ids.append(policy_id)
        logger.info(
            "Rescraped pdf=%s as policy_id=%s with %d criteria + %d codes (publishStatus=draft)",
            pdf_path,
            policy_id,
            len(criteria),
            len(applicable_codes),
        )

    return new_policy_ids


# ─── CLI entry point ──────────────────────────────────────────────────────────


async def _cli_main(argv: Sequence[str]) -> int:
    """Manual rescrape trigger.

    Usage:
      DB-direct:
        python -m services.ai.policy_rescrape <payer_id> <pdf_path> [pdf_path ...]
      Markdown mode (Phase 7 onboarding):
        python -m services.ai.policy_rescrape \
            --markdown-output-dir policies/uhc/ \
            <payer_id> <pdf_path> [pdf_path ...]
    """
    import argparse  # noqa: PLC0415

    parser = argparse.ArgumentParser(
        prog="policy_rescrape",
        description="Re-ingest payer policy PDFs as Postgres rows or markdown files.",
    )
    parser.add_argument("payer_id", help="FK into the Payer table, e.g. payer-uhc")
    parser.add_argument("pdf_paths", nargs="+", help="Absolute or relative paths to PDF files")
    parser.add_argument(
        "--markdown-output-dir",
        default=None,
        help=(
            "If set, write one .md file per policy to this directory instead of "
            "inserting Policy/PolicyCriterion/PolicyCode rows. Used for Phase 7 "
            "human-review-then-seed onboarding."
        ),
    )
    parser.add_argument(
        "--policy-type",
        default="MedicalPolicy",
        choices=["MedicalPolicy", "NCD", "LCD"],
    )
    parser.add_argument(
        "--no-s3",
        action="store_true",
        help=(
            "Skip the S3 upload step. Local markdown files still get written. "
            "Use this for offline dev or when S3 creds are unavailable."
        ),
    )
    args = parser.parse_args(list(argv))

    pdf_paths = [str(Path(p).resolve()) for p in args.pdf_paths]

    import asyncpg  # noqa: PLC0415

    from services.ai.config import get_settings  # noqa: PLC0415

    settings = get_settings()
    if not settings.database_url:
        print("DATABASE_URL is not configured in services/ai/.env — cannot rescrape.")
        return 1

    pool = await asyncpg.create_pool(settings.database_url)
    try:
        new_ids = await rescrape_payer_policies(
            payer_id=args.payer_id,
            pdf_paths=pdf_paths,
            db_pool=pool,
            default_policy_type=args.policy_type,
            markdown_output_dir=args.markdown_output_dir,
            upload_to_s3=not args.no_s3,
        )
    finally:
        await pool.close()

    if args.markdown_output_dir:
        print(f"Wrote {len(new_ids)} markdown file(s) for payer={args.payer_id} to {args.markdown_output_dir}:")
    else:
        print(f"Created {len(new_ids)} draft Policy row(s) for payer={args.payer_id}:")
    for pid in new_ids:
        print(f"  - {pid}")
    return 0


if __name__ == "__main__":
    import sys

    raise SystemExit(asyncio.run(_cli_main(sys.argv[1:])))
