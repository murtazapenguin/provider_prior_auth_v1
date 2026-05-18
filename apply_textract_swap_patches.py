#!/usr/bin/env python3
"""
Swap Azure Document Intelligence → AWS Textract across the planning docs.

Run from the repo root (/Users/murtaza/provider_pa_hackathon):
    python3 apply_textract_swap_patches.py

Operational implications:
  - One cloud (AWS) for Bedrock LLM + Textract OCR. Simpler.
  - Need an S3 bucket for Textract staging. Set S3_OCR_STAGING_BUCKET in
    services/ai/.env. The bucket should be in the same region as Bedrock.
  - Textract returns normalized 0-1 coordinates natively → no PyMuPDF
    page-dimension normalization step needed (one less failure mode).

Files modified:
  - CLAUDE.md                    (Tech stack + "Resolved" point 6)
  - AI_INTEGRATION.md            (SDK setup auth + OCR pipeline references)
  - POLICIES.md                  (Pipeline 2 step 1)
  - ARCHITECTURE.md              (Deployment env vars)
  - HACKATHON_SCOPE.md           (clarify which OCR provider we use)
  - tasks/phase-0-foundation.md  (.env.example block)
  - tasks/phase-3-ai.md          (cover-letter ticket OCR reference)
  - tasks/STATUS.md              (env-var checklist + new bullet)

Each modified file is backed up to <file>.bak.<timestamp> first. Idempotent —
safe to re-run; substitutions that already landed are reported as skipped.
"""

import datetime
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
TS = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")


# ---------------------------------------------------------------------------
# Patch payloads
# ---------------------------------------------------------------------------

# --- CLAUDE.md ---------------------------------------------------------------

CLAUDE_TECH_STACK_OLD = '''- **OCR:** Azure Document Intelligence (`AZURE_OCR_ENDPOINT` + `AZURE_OCR_SECRET_KEY`). Textract is supported by the SDK but unused — Azure avoids the S3-staging hop.'''
CLAUDE_TECH_STACK_NEW = '''- **OCR:** AWS Textract via `penguin.ocr.providers.aws.AWSTextractProvider`. Requires an S3 staging bucket (`S3_OCR_STAGING_BUCKET` env var) — Textract's async API uploads PDFs there before processing. Single-cloud setup with Bedrock keeps creds/permissions simple. Coordinates come back already normalized 0-1 (no inches→fraction conversion needed, unlike Azure).'''

CLAUDE_RESOLVED_OLD = '''6. **PDF ingestion → built-in OCR.** `penguin.ocr.providers.aws.AWSTextractProvider` and `AzureOCRProvider` both return a normalized `OCRResult` with `lines: List[OCRLine]`, each carrying `content`, `page_number`, `line_number`, `bounding_box`, and `confidence`. **This replaces `pdfplumber` in our policy ingestion pipeline** — bounding boxes for free, ideal for citation-back-to-PDF source.'''
CLAUDE_RESOLVED_NEW = '''6. **PDF ingestion → built-in OCR via AWS Textract.** `penguin.ocr.providers.aws.AWSTextractProvider(s3_bucket=settings.s3_ocr_staging_bucket)` returns a normalized `OCRResult` with `lines: List[OCRLine]`, each carrying `content`, `page_number`, `line_number`, `bounding_box` (already 0-1 normalized), and `confidence`. **This replaces `pdfplumber` in our policy ingestion pipeline** — bounding boxes for free, ideal for citation-back-to-PDF source. Textract requires the user to own an S3 bucket for staging; PDFs auto-upload there before processing.'''


# --- AI_INTEGRATION.md -------------------------------------------------------

AI_AUTH_OLD = '''**Auth:** provider-native. **Locked: AWS Bedrock for LLM, Azure Document Intelligence for OCR.** Required env vars in `services/ai/.env`:
- `AWS_REGION=us-east-1` (or wherever the inference profile is provisioned)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (or `AWS_PROFILE` if using `~/.aws/credentials`)
- `AZURE_OCR_ENDPOINT=https://<your-resource>.cognitiveservices.azure.com/`
- `AZURE_OCR_SECRET_KEY=<your-key>`

Production swap: instance role on the AI service host instead of static AWS keys; Azure key rotates via secret manager.'''
AI_AUTH_NEW = '''**Auth:** provider-native. **Locked: AWS Bedrock for LLM, AWS Textract for OCR (single-cloud).** Required env vars in `services/ai/.env`:
- `AWS_REGION=us-east-1` (or wherever the Bedrock inference profile is provisioned)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (or `AWS_PROFILE` if using `~/.aws/credentials`)
- `S3_OCR_STAGING_BUCKET=<your-bucket-name>` — the bucket Textract uses to stage PDFs during async processing. Same region as Bedrock recommended. Apply a 7-day lifecycle rule so staged PDFs auto-delete.

The AWS credentials need IAM perms for: `bedrock:InvokeModel*` (LLM), `textract:StartDocumentAnalysis` + `textract:GetDocumentAnalysis` (OCR), and `s3:PutObject` + `s3:GetObject` + `s3:DeleteObject` on the staging bucket.

Production swap: instance role on the AI service host instead of static keys; bucket policy locked to the role.'''

AI_OCR_PIPELINE_OLD = '''1. **OCR via Penguin.** `AzureOCRProvider().process_file(pdf_path)` returns an `OCRResult` with `lines: List[OCRLine]` and a `full_text` string in `"content || line_number"` format. Each line has `page_number`, `line_number`, `bounding_box` (4 points in inches — we normalize to 0–1 in step 2), and `confidence`. Azure is the chosen provider; Textract is supported by the SDK but we don't use it (avoids the S3-staging hop).'''
AI_OCR_PIPELINE_NEW = '''1. **OCR via Penguin.** `AWSTextractProvider(s3_bucket=settings.s3_ocr_staging_bucket).process_file(pdf_path)` returns an `OCRResult` with `lines: List[OCRLine]` and a `full_text` string in `"content || line_number"` format. Each line has `page_number`, `line_number`, `bounding_box` (4 points already normalized 0–1), and `confidence`. Textract auto-uploads the PDF to the staging bucket, kicks off async processing, polls until complete, then returns the normalized result. Single-cloud setup with Bedrock — no Azure resource needed.'''

AI_OCR_PIPELINE_STEP2_OLD = '''2. **Page dimensions.** Pre-compute `{page_number: (width_inches, height_inches)}` via PyMuPDF (`fitz`). Required because Azure OCR returns coordinates in inches, not normalized 0-1; we normalize using actual page dimensions before storing bboxes (Textract returns normalized already, but we normalize uniformly).'''
AI_OCR_PIPELINE_STEP2_NEW = '''2. **Page dimensions.** Textract returns coordinates already normalized 0-1, so no per-page width/height pre-computation is needed for OCR. PyMuPDF (`fitz`) is still used for **PDF generation** in the submission packet (Task 5) and for **page-image rasterization** for the PDFViewer (Phase 4).'''


# --- POLICIES.md -------------------------------------------------------------

POLICIES_OCR_OLD = '''1. **PDF → OCR.** From the FastAPI sidecar, `AzureOCRProvider().process_file(pdf_path)` — Azure is our committed provider (Textract is supported by the SDK but unused; avoids the S3-staging hop). Returns an `OCRResult` with `lines: List[OCRLine]` (each carrying `content`, `page_number`, `line_number`, `bounding_box`, `confidence`) and a `full_text` formatted as `"content || line_number"` per line. Bounding boxes are pixel-accurate citation handles for free.'''
POLICIES_OCR_NEW = '''1. **PDF → OCR.** From the FastAPI sidecar, `AWSTextractProvider(s3_bucket=settings.s3_ocr_staging_bucket).process_file(pdf_path)` — AWS Textract is our committed provider (single-cloud with Bedrock). The provider auto-uploads the PDF to the staging bucket, runs async OCR, and returns an `OCRResult` with `lines: List[OCRLine]` (each carrying `content`, `page_number`, `line_number`, `bounding_box` already normalized 0-1, `confidence`) and a `full_text` formatted as `"content || line_number"` per line. Bounding boxes are pixel-accurate citation handles for free, no per-page normalization step needed.'''

POLICIES_PAGE_DIM_OLD = '''2. **Page dimensions.** Pre-compute page widths/heights with PyMuPDF (`fitz`) — Azure returns inches, we normalize to 0-1 using actual dimensions before storage.'''
POLICIES_PAGE_DIM_NEW = '''2. **Page dimensions** (skipped for OCR). Textract returns already-normalized 0-1 coordinates, so this step is a no-op for the OCR path. PyMuPDF is still used downstream for the submission packet (Task 5) and for page-image rasterization in the PDFViewer.'''


# --- ARCHITECTURE.md ---------------------------------------------------------

ARCH_ENV_OLD = '''- `AZURE_OCR_ENDPOINT`, `AZURE_OCR_SECRET_KEY` — only if we use Azure OCR instead of Textract (see `POLICIES.md`).'''
ARCH_ENV_NEW = '''- `S3_OCR_STAGING_BUCKET` — name of an S3 bucket Textract uses to stage PDFs during async processing. User-owned, same region as Bedrock recommended. Apply a 7-day lifecycle rule.'''


# --- HACKATHON_SCOPE.md ------------------------------------------------------

# The earlier "AzureOCR avoids S3-staging hop" framing was reversed. Update the
# resolved-risk row accordingly. Anchor on the existing row text.
SCOPE_PDF_RISK_OLD = '''| ~~Penguin SDK doesn't support PDF ingestion natively~~ — resolved | The SDK ships `penguin.ocr` (AWS Textract / Azure DI) returning normalized line-level text + bboxes. We use it directly. |'''
SCOPE_PDF_RISK_NEW = '''| ~~Penguin SDK doesn't support PDF ingestion natively~~ — resolved | The SDK ships `penguin.ocr.providers.aws.AWSTextractProvider` returning normalized line-level text + bboxes (0-1 normalized natively). We use it directly with an S3 staging bucket (`S3_OCR_STAGING_BUCKET`). Single-cloud setup with Bedrock. |'''


# --- tasks/phase-0-foundation.md ---------------------------------------------

PHASE0_ENV_OLD = '''  - `services/ai/.env.example` (committed decisions: Bedrock for LLM, Azure for OCR):
    - `AI_SERVICE_TOKEN=dev-token-change-me`
    - `AWS_REGION=us-east-1`
    - `AWS_ACCESS_KEY_ID=` (commented; user fills in)
    - `AWS_SECRET_ACCESS_KEY=` (commented; user fills in)
    - `AZURE_OCR_ENDPOINT=` (commented; user fills in)
    - `AZURE_OCR_SECRET_KEY=` (commented; user fills in)
    - `LANGFUSE_PUBLIC_KEY=` / `LANGFUSE_SECRET_KEY=` / `LANGFUSE_HOST=` (all commented — tracing off by default)
    - `PENGUIN_LLM_PROVIDER=bedrock`
    - `PENGUIN_LLM_MODEL=claude-sonnet-4-5`
    - `LOG_LEVEL=INFO`
    - `DEBUG=true`'''
PHASE0_ENV_NEW = '''  - `services/ai/.env.example` (committed decisions: Bedrock for LLM, AWS Textract for OCR — single-cloud):
    - `AI_SERVICE_TOKEN=dev-token-change-me`
    - `AWS_REGION=us-east-1`
    - `AWS_ACCESS_KEY_ID=` (commented; user fills in)
    - `AWS_SECRET_ACCESS_KEY=` (commented; user fills in)
    - `S3_OCR_STAGING_BUCKET=` (commented; user fills in — bucket name they own; same region as Bedrock; 7-day lifecycle rule recommended)
    - `LANGFUSE_PUBLIC_KEY=` / `LANGFUSE_SECRET_KEY=` / `LANGFUSE_HOST=` (all commented — tracing off by default)
    - `PENGUIN_LLM_PROVIDER=bedrock`
    - `PENGUIN_LLM_MODEL=claude-sonnet-4-5`
    - `LOG_LEVEL=INFO`
    - `DEBUG=true`'''


# --- tasks/phase-3-ai.md (cover-letter ticket) -------------------------------
# The phase-3-cover-letter ticket may not mention Azure directly (LLM-only),
# but the policy-ingestion ticket might. Search for both.

PHASE3_OCR_OLD_A = '''`services/ai/policy_ingestion.py` uses `AzureOCRProvider` (or `AWSTextractProvider` if Azure not configured)'''
PHASE3_OCR_NEW_A = '''`services/ai/policy_ingestion.py` uses `AWSTextractProvider(s3_bucket=settings.s3_ocr_staging_bucket)`'''


# --- tasks/STATUS.md ---------------------------------------------------------

STATUS_LLM_OCR_OLD = '''- OCR provider: **Azure Document Intelligence**'''
STATUS_LLM_OCR_NEW = '''- OCR provider: **AWS Textract** (single-cloud with Bedrock; needs an S3 staging bucket — set `S3_OCR_STAGING_BUCKET`)'''

STATUS_ENV_CHECKLIST_OLD = '''**User env-var checklist before Phase 0 starts:** copy `services/ai/.env.example` → `services/ai/.env` and fill in `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (or set `AWS_PROFILE`), `AWS_REGION`, `AZURE_OCR_ENDPOINT`, `AZURE_OCR_SECRET_KEY`. Same for the root `.env.local` for Next.js (`AI_SERVICE_URL=http://localhost:8000`, `AI_SERVICE_TOKEN=dev-token-change-me`, `DATABASE_URL=postgresql://pa_app:pa_app_dev@localhost:5432/pa_app?schema=public`).'''
STATUS_ENV_CHECKLIST_NEW = '''**User env-var checklist before Phase 3 starts:** copy `services/ai/.env.example` → `services/ai/.env` and fill in `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (or set `AWS_PROFILE`), `AWS_REGION`, `S3_OCR_STAGING_BUCKET` (a bucket the user owns; same region as Bedrock; recommend 7-day lifecycle rule). Same for the root `.env.local` for Next.js (`AI_SERVICE_URL=http://localhost:8000`, `AI_SERVICE_TOKEN=dev-token-change-me`, `DATABASE_URL=postgresql://pa_app:pa_app_dev@localhost:5432/pa_app?schema=public`). IAM perms required: `bedrock:InvokeModel*`, `textract:StartDocumentAnalysis`, `textract:GetDocumentAnalysis`, plus `s3:PutObject`/`s3:GetObject`/`s3:DeleteObject` on the staging bucket.'''

STATUS_NEW_BULLET = '''- Mid-stream change (after Phase 2): OCR provider switched from Azure Document Intelligence to AWS Textract for a single-cloud setup with Bedrock. Adds an `S3_OCR_STAGING_BUCKET` env var; drops the Azure ones. Coordinate normalization step removed (Textract returns 0-1 natively, vs Azure's inches). Updated CLAUDE.md, AI_INTEGRATION.md, POLICIES.md, ARCHITECTURE.md, tasks/phase-0-foundation.md, tasks/phase-3-ai.md, tasks/STATUS.md, HACKATHON_SCOPE.md.'''

STATUS_INSERT_AFTER = '''- Mid-stream addition (between Phase 2 and Phase 3): submission-packet generation is in scope.'''


# ---------------------------------------------------------------------------

def patch_file(rel_path, substitutions):
    """substitutions: list of (old, new) — replaces first occurrence each."""
    full = REPO_ROOT / rel_path
    if not full.exists():
        return False, [f"  ❌ File not found: {full}"]

    text = full.read_text(encoding="utf-8")
    original = text
    log = []
    failures = 0

    for old, new in substitutions:
        if new in text:
            log.append(f"  ⏭  already applied")
            continue
        if old not in text:
            log.append(f"  ❌ anchor not found: {old[:80]!r}...")
            failures += 1
            continue
        text = text.replace(old, new, 1)
        log.append(f"  ✅ substituted")

    if text == original:
        return failures == 0, log + ["  (no changes; all already applied)"]

    backup = full.with_suffix(full.suffix + f".bak.{TS}")
    backup.write_text(original, encoding="utf-8")
    full.write_text(text, encoding="utf-8")
    return failures == 0, log + [f"  💾 backup: {backup.name}"]


def insert_status_bullet():
    """STATUS.md gets a new bullet inserted after a specific line."""
    full = REPO_ROOT / "tasks/STATUS.md"
    if not full.exists():
        return False, [f"  ❌ File not found: {full}"]
    text = full.read_text(encoding="utf-8")
    if "OCR provider switched from Azure Document Intelligence to AWS Textract" in text:
        return True, ["  ⏭  already applied"]
    if STATUS_INSERT_AFTER not in text:
        return False, [f"  ❌ insert anchor not found"]
    idx = text.find(STATUS_INSERT_AFTER)
    eol = text.find("\n", idx)
    new_text = text[:eol+1] + STATUS_NEW_BULLET + "\n" + text[eol+1:]
    backup = full.with_suffix(full.suffix + f".bak.{TS}")
    backup.write_text(text, encoding="utf-8")
    full.write_text(new_text, encoding="utf-8")
    return True, [f"  💾 backup: {backup.name}", f"  ✅ inserted Textract-swap bullet"]


PATCHES = [
    ("CLAUDE.md", "CLAUDE.md", [
        (CLAUDE_TECH_STACK_OLD, CLAUDE_TECH_STACK_NEW),
        (CLAUDE_RESOLVED_OLD, CLAUDE_RESOLVED_NEW),
    ]),
    ("AI_INTEGRATION.md", "AI_INTEGRATION.md", [
        (AI_AUTH_OLD, AI_AUTH_NEW),
        (AI_OCR_PIPELINE_OLD, AI_OCR_PIPELINE_NEW),
        (AI_OCR_PIPELINE_STEP2_OLD, AI_OCR_PIPELINE_STEP2_NEW),
    ]),
    ("POLICIES.md", "POLICIES.md", [
        (POLICIES_OCR_OLD, POLICIES_OCR_NEW),
        (POLICIES_PAGE_DIM_OLD, POLICIES_PAGE_DIM_NEW),
    ]),
    ("ARCHITECTURE.md", "ARCHITECTURE.md", [
        (ARCH_ENV_OLD, ARCH_ENV_NEW),
    ]),
    ("HACKATHON_SCOPE.md", "HACKATHON_SCOPE.md", [
        (SCOPE_PDF_RISK_OLD, SCOPE_PDF_RISK_NEW),
    ]),
    ("tasks/phase-0-foundation.md", "tasks/phase-0-foundation.md", [
        (PHASE0_ENV_OLD, PHASE0_ENV_NEW),
    ]),
    ("tasks/phase-3-ai.md", "tasks/phase-3-ai.md", [
        (PHASE3_OCR_OLD_A, PHASE3_OCR_NEW_A),
    ]),
    ("tasks/STATUS.md (env checklist + provider line)", "tasks/STATUS.md", [
        (STATUS_LLM_OCR_OLD, STATUS_LLM_OCR_NEW),
        (STATUS_ENV_CHECKLIST_OLD, STATUS_ENV_CHECKLIST_NEW),
    ]),
]


def main():
    print(f"Applying Azure → AWS Textract swap in: {REPO_ROOT}")
    print(f"Backup suffix: .bak.{TS}\n")

    if not (REPO_ROOT / "CLAUDE.md").exists():
        print("ERROR: CLAUDE.md not found at script directory.")
        print("Run this script from the repo root (provider_pa_hackathon/).")
        sys.exit(1)

    failures = 0
    for label, relpath, subs in PATCHES:
        print("─" * 70)
        print(f"Patching: {label}")
        print("─" * 70)
        ok, log = patch_file(relpath, subs)
        for line in log:
            print(line)
        if not ok:
            failures += 1
        print()

    # Special: insert STATUS.md bullet
    print("─" * 70)
    print("Insert: tasks/STATUS.md mid-stream-change bullet")
    print("─" * 70)
    ok, log = insert_status_bullet()
    for line in log:
        print(line)
    if not ok:
        failures += 1
    print()

    print("=" * 70)
    if failures == 0:
        print(f"DONE. Azure → Textract swap applied successfully.")
        print(f"Backups in *.bak.{TS} files (delete after you verify).")
        print()
        print("Pre-Phase-3 checklist (you):")
        print("  1. Create an S3 bucket in your AWS account, same region as Bedrock.")
        print("     Recommended: 7-day lifecycle rule for object expiration.")
        print("  2. Add to services/ai/.env: S3_OCR_STAGING_BUCKET=<your-bucket-name>")
        print("  3. Confirm IAM perms: bedrock:InvokeModel*, textract:StartDocumentAnalysis,")
        print("     textract:GetDocumentAnalysis, s3:PutObject/GetObject/DeleteObject")
        print("     (last three scoped to the staging bucket).")
    else:
        print(f"FAILED on {failures} patch group(s). Check ❌ markers above.")
    print("=" * 70)
    sys.exit(0 if failures == 0 else 1)


if __name__ == "__main__":
    main()
