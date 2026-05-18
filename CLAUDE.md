# CLAUDE.md

This file is the project memory for any Claude session (Cowork, Claude Code, or otherwise) working on this codebase. Read it first.

## What this project is

A provider-side prior authorization (PA) workflow app, built during a hackathon. Pulls clinical context from EHR / scribe notes, identifies procedure/Rx codes, checks against payer policies, extracts evidence with citations, walks the provider through review, and submits to a simulated payer. Standalone Next.js web app for the demo, designed to be plug-and-play into real EHRs and payer systems later.

Read `README.md` for the long version.

## Doc map (read in this order)

1. `README.md` — vision, scope, demo scenarios summary
2. `HACKATHON_SCOPE.md` — what's in / out, mocks vs real, MVP, risks
3. `WORKFLOW.md` — end-to-end flow + full state machine (Mermaid diagrams)
4. `ARCHITECTURE.md` — tech stack, module map, complete data model, API surface
5. `POLICIES.md` — policy data model, ingestion pipelines, matching engine
6. `AI_INTEGRATION.md` — Penguin SDK boundary, prompts per AI task, demo determinism
7. `DEMO_SCENARIOS.md` — three scripted scenarios with seed data and expected outcomes
8. `ORCHESTRATION.md` — how to split build work across subagents, phase-by-phase
9. `ARTIFACTS_MAP.md` — what we adopt from `penguinai-claude-artifacts-main/`, what we don't, why
10. `tasks/` — discrete build tickets (paint-by-numbers implementation)

If any doc disagrees with another, **`HACKATHON_SCOPE.md` and `ARCHITECTURE.md` are authoritative.** Update the others to match, don't introduce a third interpretation.

## Vendor artifacts directory

`penguinai-claude-artifacts-main/` is a Penguin-supplied starter kit. **Do not edit files inside it.** Adopt the parts called out in `ARTIFACTS_MAP.md`; treat everything else as reference. Concretely:
- The SDK wheel at `penguinai-claude-artifacts-main/packages/penguin_ai_sdk-0.2.0-py3-none-any.whl` is our `services/ai/` dependency.
- The PDFViewer at `penguinai-claude-artifacts-main/data-labelling-library/` is copied into `frontend/lib/pdf-viewer/` in Phase 4.
- The FastAPI scaffolding patterns from `penguinai-claude-artifacts-main/platform-backend-kit/app/` (middleware, error handlers, exceptions, audit, health module, settings, logging) are ported into `services/ai/`. See `ARTIFACTS_MAP.md` for the file-by-file list.
- Contracts under `penguinai-claude-artifacts-main/.claude/contracts/` (bbox-format, evidence-citation, pdfviewer-data, extraction-result, auth-response, error-response, pagination) are **canonical** — our request/response and citation shapes must match them on both sides of the wire.

## Real data files (root of repo)

The user dropped real reference data and policy documents at the repo root. **Do not edit these.** Phase 1 ingestion reads from them.

- `CMS/` — five CSVs (`lcd_policies.csv`, `ncd_policies.csv`, `articles.csv`, `coverage_code_mappings.csv`, `policy_contractor_mappings.csv`). The schemas are real. The HTML in indication / coverage_guidelines columns is stripped before AI ingestion. The `coverage_code_mappings` table is the join key — given a CPT/HCPCS code, find every policy that covers it.
- `UHC/medical-policies/` (661 PDFs) and `UHC/clinical-guidelines/` (44 PDFs). The Botox demo policy is `UHC/medical-policies/botulinum-toxins-a-and-b-cs.pdf`. PDF policy ingestion runs through `penguin.ocr` against any of them.
- `CPT Codes/cpt-codes.csv` — only 21 codes (small sample). Demo procedure descriptions are also available via `coverage_code_mappings.csv`.
- `ICD-10 – Full Code Set/icd10_codes.csv` — 98,187 codes, full set. The ancillary files (`icd10_index`, `icd10_drug`, `icd10_neoplasm`, `icd10_tabular_rules`, `icd10_conversion`) sit alongside but are not on the demo critical path.

See `ARTIFACTS_MAP.md` for full schemas and the demo-procedure → policy mapping.

## Tech stack (committed)

- **Frontend + provider API:** Next.js (App Router) + TypeScript + Tailwind
- **Database:** Postgres + Prisma. Local dev via `docker-compose up -d` (Postgres 16-alpine). Production swap to Vercel Postgres or Supabase later.
- **AI:** Penguin AI SDK (Python only) running as a FastAPI sidecar at `services/ai/`. Next.js calls it over HTTP via `lib/ai/penguinClient.ts`.
- **LLM:** AWS Bedrock — `claude-sonnet-4-5` (resolves to inference profile `us.anthropic.claude-sonnet-4-5-20250929-v1:0`) for derivation/extraction/ingestion. `claude-haiku-4-5` for guards and the criteria-split task.
- **OCR:** AWS Textract via `penguin.ocr.providers.aws.AWSTextractProvider`. Requires an S3 staging bucket (`S3_OCR_STAGING_BUCKET` env var) — Textract's async API uploads PDFs there before processing. Single-cloud setup with Bedrock keeps creds/permissions simple. Coordinates come back already normalized 0-1 (no inches→fraction conversion needed, unlike Azure).
- **Hosting:** local for hackathon dev → Vercel (Next.js) + Railway/Render/Fly (FastAPI) + Vercel Postgres or Supabase (DB) for the post-hackathon move.
- **Background:** Vercel Cron drives the payer simulator and 60-day expiration sweep (in production); local dev uses a `node scripts/cron-tick.ts` polling loop or manual hits to `/api/cron/sweep`.
- **FHIR adapter mode:** `FHIR_MODE=mock` is the **development default**, set explicitly in `.env.local` / `.env.example` (Phase 6). When the env var is UNSET, `lib/fhir/index.ts` resolves to `real` — a deliberate production-safety mechanism so a misconfigured deploy fails loudly against fixture data rather than silently serving stale mocks. Dev workflows always populate `.env.local`; only the real-Epic verification work (`phase-6-epic-verification`) flips it to `real`.

## Status model (vocabulary lock)

These are the only valid PA status names. Do not invent new ones. Do not rename them.

Status values in code are **snake_case** strings. The UI display layer converts them to
PascalCase-with-spaces strings for rendering. The table below lists both forms.

| Code value (DB + TS) | UI display string |
|---|---|
| `draft` | Draft |
| `pending_submission` | Pending Submission |
| `ready_for_submission` | Ready for Submission |
| `voided` | Voided |
| `cancelled` | Cancelled |
| `expired` | Expired |
| `pending` | Pending |
| `in_progress` | In Review |
| `rfi` | RFI |
| `approved` | Approved |
| `denied` | Denied |
| `partial_approval` | Partial Approval |
| `partial_denial` | Partial Denial |
| `withdrawn` | Withdrawn |

`cancelled` can be reached pre- or post-submission (patient declined). `expired` is pre-submission only (60-day timer on `pending_submission`). Payer-side approval expirations are tracked in `payerExpiresAt` but do **not** drive a state transition in our system — we display them; the payer owns them.

Full transition table is in `WORKFLOW.md`. The state machine lives in `lib/statusMachine/transitions.ts`. All status changes route through it. Don't write `pa.status = 'foo'` anywhere else.

## Conventions

### Code organization
- Domain modules under `lib/<domain>/` — see `ARCHITECTURE.md` for the full map.
- Penguin SDK is **only** imported from `lib/ai/`. Anything else importing it is a bug.
- API routes are thin wrappers — they parse input, call into `lib/`, persist via Prisma, return JSON.
- React Server Components by default. Client components only when interactivity requires it (forms, file upload, real-time tracker).

### Data model
- Source of truth is `prisma/schema.prisma`.
- Never add a field without updating `ARCHITECTURE.md` in the same change.
- Migrations are committed; never edit historical migrations.

### AI calls
- Always strict structured outputs validated with zod (or pydantic on the Python side). Wrap lists in a container Pydantic model (`with_structured_output` accepts a single class only).
- Always per-criterion (not all-criteria-at-once) for evidence extraction.
- Always validate that cited excerpts are substrings of the cited source — invalid citations downgrade the result to `needs_info`. Use `penguin.output_guard.hallucination.FaithfulnessDetector` for this.
- Always cache AI responses keyed by (task, prompt version, input hash). Demo determinism depends on this.
- Always use **line-number-based bbox retrieval** (`get_bounding_boxes_by_line`, `find_line_as_bbox`, `ocr_result_to_bbox_format`) for mapping LLM citations to PDF coordinates. Text fuzzy-matching is forbidden. The LLM cites OCR line numbers from the `full_text` `"content || line_number"` format; we look up the bbox by line.
- Always use **Bedrock inference profile IDs** (e.g. `us.anthropic.claude-sonnet-4-5-20250929-v1:0`), not raw model IDs. Raw IDs require provisioned throughput and fail with `ValidationException`.
- Citation/evidence shape is locked by the Penguin canonical contracts (`evidence-citation` + `bbox-format` in `penguinai-claude-artifacts-main/.claude/contracts/`). The shape is identical end-to-end (AI → DB → API → UI) — zero-transform rule.

### Forbidden libraries (FastAPI sidecar)
Inside `services/ai/`, every AI / OCR / embedding operation goes through `penguin.*`. Direct calls to the underlying providers are forbidden:

| Forbidden | Use instead |
|---|---|
| `pytesseract` | `penguin.ocr` |
| `openai` | `penguin.core.create_model` |
| `anthropic` | `penguin.core.create_model` |
| `google.generativeai` | `penguin.core.create_model` |
| `boto3` for Bedrock invocation | `penguin.core.create_model` |
| `azure.ai.formrecognizer` | `penguin.ocr.AWSTextractProvider` |
| `langchain.*` direct import | `penguin.core` re-exports only |

`boto3` for S3 is fine. `boto3` for Bedrock is not — go through Penguin.

### Audit
- Every status change writes a `PaEvent` row.
- Every AI evaluation writes a `CriterionResult` (and `Citation` rows).
- Every upload writes an `Attachment` row plus an audit event.
- The audit log is append-only. Don't update or delete events.

### Adapters (the "plug-and-play" promise)
- EHR ingestion is behind `lib/ehr/EhrAdapter`. The mock impl reads JSON fixtures. Real impls go in the same directory with the same interface.
- Payer submission is behind `lib/payer/PayerAdapter`. The mock impl posts to the in-process simulator. Real impls (X12 278, FHIR Da Vinci PAS) go in the same directory with the same interface.
- **If you find yourself adding payer- or EHR-specific logic outside these adapters, stop and refactor.** That's the design.

### Naming
- States: PascalCase with spaces in UI ("Ready for Submission"), snake_case in code (`ready_for_submission`).
- Codes: always store as strings (CPT/HCPCS/ICD-10 have leading zeros, dashes, modifiers).
- IDs: cuid; foreign keys named `<entity>Id`.

## Build commands (planned)

```bash
pnpm install
pnpm db:push           # apply Prisma schema
pnpm db:seed           # load reference data + policies + demo patients
pnpm dev               # start Next.js dev server
pnpm test              # run vitest suite
pnpm policies:ingest   # CLI for adding new policies post-launch
```

### Repo utilities (Phase 6)

```bash
# Regenerate DocumentReference + Binary FHIR fixtures (4 demo patients × 2 docs each)
# from the seeded ClinicalNote SOAP text. Idempotent; safe to re-run after a fresh seed.
# Writes prisma/fixtures/fhir/documentReference/<patient-id>.json and 8 binaries under
# prisma/fixtures/fhir/binary/. Used by the mock FHIR adapter (FHIR_MODE=mock).
python scripts/generate-docref-fixtures.py

# Docs hygiene (Phase 6 docs-writer gate 14)
pnpm tsx scripts/check-doc-links.ts        # walk markdown links, exit 1 on broken relative refs
pnpm tsx scripts/check-doc-coherence.ts    # tripwire for snake_case tokens that look like status codes but aren't in the canonical 14
```

### Wrong-sidecar pitfall (Session 8 finding — process improvement)

When the FastAPI sidecar is started from a sibling directory, `uvicorn main:app` silently serves a stale instance — same port, same name, **wrong code**. Session 8 hit this with a stale process at `/Users/murtaza/Documents/provider_pa_hackathon/` (the pre-rename project path) serving an older sidecar that lacked T4's `/ingest-documents` route. Smoke passed because the try/catch in `triggerIngestForPa()` swallowed the 404; the actual T10 wiring was never exercised.

**Always:**
1. `cd /Users/murtaza/Documents/provider_pa` first.
2. `services/ai/.venv/bin/python -m uvicorn services.ai.main:app --port 8000` (module-qualified entry point — `main:app` from inside `services/ai/` works but is harder to verify).
3. Verify the running process with `ps aux | grep uvicorn` — the `cwd` (visible via `lsof -p <pid> | grep cwd` on macOS) MUST be the canonical project path.
4. After starting, hit `curl http://localhost:8000/openapi.json | jq '.paths | keys'` and grep for the routes the current session depends on (`/ingest-documents`, `/triage-documents`, `/generate-submission-packet`). A stale sidecar will be missing whatever ships in the current session's tickets.

If two project checkouts coexist on the same machine, kill stragglers with `pkill -f provider_pa_hackathon` (or whichever the wrong path is) before starting the canonical one.

## Hard rules (do not violate)

- Never auto-mutate PA status without a `PaEvent` row recording the transition, actor, and rationale.
- Never log PHI or full prompts at info/debug level.
- Never paraphrase a citation excerpt — citations must be verbatim substrings of the source.
- Never bypass the state machine (no `pa.status = 'foo'` outside `lib/statusMachine`).
- Never edit `components/ui/` from feature work — that's the Penguin design system primitives.
- Never invent a status name not on the list above.
- Never modify the Prisma schema without updating `ARCHITECTURE.md`.

## Soft rules (defaults)

- Prefer Server Components. Reach for `'use client'` only when needed.
- Prefer narrow interfaces over generic helpers. The state machine has its own types; don't widen them to `any`.
- Prefer hand-curated demo policies over relying on AI ingestion for the demo critical path. Save AI-driven policy ingestion for non-demo policies if time allows.
- Prefer parallel subagent work for independent modules (see `ORCHESTRATION.md`); inline work for everything else.

## Resolved (Penguin SDK questions, answered from https://ai-docs.penguinai.co/)

1. **Penguin AI SDK language → Python only.** Confirmed at the docs landing page (`from penguin.core import create_model`). **We commit to Path B: Next.js + FastAPI sidecar.** All SDK calls live in the FastAPI service; Next.js calls it over HTTP. See `ARCHITECTURE.md` for the deployment shape and `AI_INTEGRATION.md` for the boundary.
2. **SDK auth + setup.** Install from the bundled wheel: `pip install "./penguinai-claude-artifacts-main/packages/penguin_ai_sdk-0.2.0-py3-none-any.whl[cpu]"` (after `pip install torch --index-url https://download.pytorch.org/whl/cpu` on Mac/laptops). Auth is **provider-native**: AWS credentials (Bedrock) or Google credentials (Gemini). For Bedrock, **always use the inference profile ID** (`us.anthropic.claude-sonnet-4-5-20250929-v1:0`) not the raw model ID. Client init: `create_model(provider="bedrock", model="claude-sonnet-4-5")` resolves the friendly name to the profile ID automatically.
3. **Structured outputs → native, Pydantic.** `model.with_structured_output(SomeBaseModel)` returns a wrapped model whose `.invoke()` returns a typed Pydantic instance. **Limitation:** accepts a single Pydantic class only — wrap lists in a container model (`class Items(BaseModel): items: list[Item]`). On the TS side we re-validate with zod after the FastAPI hop.
4. **Long context → 200K default, 1M optional.** Claude on Bedrock = 200K tokens by default, 1M with `long_context=True`. Gemini = 1M native. Demo chart corpora are well under 200K, so no chunking is needed; the 1M switch is available if a chart ever exceeds it.
5. **Recommended models for our tasks.** Default to **Claude Sonnet 4.5** on Bedrock for code derivation and evidence extraction (quality + 200K context). Default to **Claude Haiku 4.5** for guardrails and the criteria-split task (cheaper, fast — and matches the SDK's own default for `CompositeInputGuard`).
6. **PDF ingestion → built-in OCR via AWS Textract.** `penguin.ocr.providers.aws.AWSTextractProvider(s3_bucket=settings.s3_ocr_staging_bucket)` returns a normalized `OCRResult` with `lines: List[OCRLine]`, each carrying `content`, `page_number`, `line_number`, `bounding_box` (already 0-1 normalized), and `confidence`. **This replaces `pdfplumber` in our policy ingestion pipeline** — bounding boxes for free, ideal for citation-back-to-PDF source. Textract requires the user to own an S3 bucket for staging; PDFs auto-upload there before processing.
7. **Tool calling → yes.** `model.bind_tools([fn])` plus the `@tool` decorator. Not on the demo critical path, but available if we want the criteria-split task to look up reference codes.
8. **Streaming → yes.** `model.stream(...)`. Nice-to-have for code-derivation UX; not a must.
9. **Citation validation is built in.** `penguin.output_guard.hallucination.FaithfulnessDetector` answers exactly the question we'd planned to hand-roll: "Are cited sentences actually in the source documents?" Pure Python, fast. **We use this in `services/ai/evidence_extraction.py` for citation-substring validation** — see `AI_INTEGRATION.md`.
10. **Observability → auto-traced via Langfuse.** Wrap each PA's AI work in `PenguinTracer.session(session_id=pa.id, user_id=provider.id)`. If Langfuse env vars aren't set, it's a no-op. We don't ship Langfuse for the demo, but trace IDs are recorded on each `PaEvent` so we can flip it on later.
11. **Prompt management → built in.** `penguin.prompts.register_prompt("pa_workflow", "evidence_extraction_v1", content=...)` stores prompts in a Merkle tree; `sync_to_langfuse()` pushes them. The prompt version is also part of the AI cache key per `AI_INTEGRATION.md`.
12. **Error model.** `create_model` ships with `max_retries=3` and `request_timeout=900` by default. SDK transparently retries transient failures. We surface a non-retryable error as `needs_info` per `AI_INTEGRATION.md`.

## Open questions (still pending)

1. **Penguin design tokens.** Partial — the artifacts kit gives us the brand color `#fc459d` and the glass-effect CSS pattern. Phase 0 uses these. Full token set (typography scale, semantic palette, component-level tokens) still pending; Phase 4 / Phase 5 swap in any additional tokens when delivered.
2. **Full CPT code set.** The user-supplied `CPT Codes/cpt-codes.csv` has only 21 codes (mostly E&M). For the demo we use the 70450 / 73721 / J0585 entries from `CMS/coverage_code_mappings.csv`. If we want full CPT typeahead in Phase 4 code review, we either query a richer source via `penguin.data_assets.load_asset()` or accept the limited set.

The previously-blocking CMS-schema and UHC-PDF questions are **resolved** — see "Real data files" section above.

When any remaining question resolves, update this section and the affected planning doc in the same change.

## What's mocked

(Quick reference — full list in `HACKATHON_SCOPE.md`.)

| Mocked | Real impl path |
|---|---|
| EHR ingestion | SMART on FHIR / Epic / Cerner |
| Eligibility check | 270/271 EDI or FHIR Coverage |
| Payer submission | X12 278 / FHIR Da Vinci PAS |
| Payer adjudication | timer-driven simulator |
| Provider auth | hardcoded session cookie |
| PHI redaction | not applicable (synthetic data) |

## How to make changes safely

1. Read the doc that owns the area you're changing (e.g., status changes → `WORKFLOW.md`; data model → `ARCHITECTURE.md`).
2. If your change crosses doc boundaries, update every affected doc in the same commit.
3. Run the demo scenarios end-to-end before declaring done. Each scenario tests a different surface (`DEMO_SCENARIOS.md`).
4. If a demo scenario regresses, fix it before merging.
5. Never silently update `STATUS.md` (in `tasks/`) — the orchestrator updates it at phase boundaries.

## Project ethos

We're building this as if it'll be plugged into a real provider's workflow next month. That means:
- The architecture is real (adapters, audit log, state machine).
- The AI is real (citations, confidence, validation, override).
- The data shape is real (HIPAA-aware, even if synthetic data only).

The mocks are scaffolding, not commitments. When swapping in real implementations later, no domain code should change.

If you find yourself making a shortcut that compromises the above, stop and ask the orchestrator (or the user) before proceeding.
