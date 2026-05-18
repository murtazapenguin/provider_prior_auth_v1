# Penguin Artifacts → Our Project Map

The user dropped the `penguinai-claude-artifacts-main/` kit into the repo. The kit assumes **FastAPI + MongoDB + React/Vite**; we're **Next.js + Postgres/Prisma**. Adopt where they overlap with our committed shape (the FastAPI sidecar, the SDK, the citation rendering surface). Skip where they don't.

This file records the call for each artifact so future sessions don't re-debate it.

## Adopt directly (no adaptation)

| Artifact | Where it goes | Why |
|---|---|---|
| `packages/penguin_ai_sdk-0.2.0-py3-none-any.whl` | `services/ai/pyproject.toml` dependency | Concrete install path resolves an open question. Exact spec: `penguin-ai-sdk @ file:../../penguinai-claude-artifacts-main/packages/penguin_ai_sdk-0.2.0-py3-none-any.whl[cpu]`. |
| `.claude/contracts/bbox-format.md` | New `lib/contracts/` doc + matches Prisma `Citation.bboxes` Json | The PDFViewer expects this exact 8-point normalized format. We adopt it as our canonical bbox shape end-to-end. |
| `.claude/contracts/evidence-citation.md` | Drives `Citation` table redesign | Replaces our bespoke `excerpt + offsets` shape with `supporting_texts[] + reasoning + confidence + bboxes[] + line_numbers[]`. |
| `.claude/contracts/extraction-result.md` | Drives the `derive_codes` and `extract_evidence_criterion` response shapes | Locks the AI service response so the TS adapter validates one canonical format. |
| `data-labelling-library/` (the React PDFViewer) | Copied to `frontend/lib/pdf-viewer/` in Phase 4 | Used on the PA detail screen to render policy PDFs with bbox highlights when a citation is clicked. Saves us from rebuilding a PDF viewer with bbox overlays. |
| Line-number-based bbox retrieval pattern (`get_bounding_boxes_by_line`, `find_line_as_bbox`, `ocr_result_to_bbox_format`, `strip_page_dimensions`) | `services/ai/evidence_extraction.py` and `services/ai/policy_ingestion.py` | This is the v0.2.0 recommended path. Replaces text-fuzzy-matching for citations. Hugely simplifies our citation validator. |
| `with_structured_output(ContainerModel)` pattern | All four AI tasks | Single Pydantic class per call; lists wrapped in a container model. We were already planning this; the kit confirms. |
| Bedrock inference profile IDs (e.g. `us.anthropic.claude-sonnet-4-5-20250929-v1:0`) | Model config in `services/ai/penguin_client.py` | Bedrock on-demand needs the inference profile ID, not the raw model ID. We'd hit `ValidationException` otherwise. |
| Penguin branding color `#fc459d` and glass-effect CSS | Phase 0 design tokens (`tailwind.config.ts` `primary`) | Closes part of the "design tokens deferred" open question — gives the demo a Penguin feel without waiting for the full token set. |

## Adopt directly — orchestration patterns into `ORCHESTRATION.md`

> **Position update:** the earlier doc said "agent definitions are useful reference reading; we don't run them directly." Half-true. We don't run the kit's Claude Code subagent files in their literal form (different agent runtime), but the *patterns* in `.claude/orchestrator/` and `.claude/agents/` are exactly the production polish our 6-phase pipeline was missing. We adopt them.

| Path in kit | Adoption | Where it lands |
|---|---|---|
| `.claude/orchestrator/spawning.md` (verify→resume loop, plan-mode protocol, automatic phase progression, parallel phases) | Adopt the patterns | `ORCHESTRATION.md` "Plan mode protocol" + "Integration gates" + "Failure routing" sections |
| `.claude/agents/integration-tester.md` (cross-phase contract validation, structured failure output, failure routing table) | Adopt as a virtual agent role we spawn after every phase boundary | `ORCHESTRATION.md` integration-tester role; per-phase exit checklists in `tasks/phase-*.md` reference it |
| `.claude/agents/quality-tester.md` (Playwright MCP browser testing, test-matrix-from-Phase-0 pattern) | Adopt as a virtual agent role for Phase 5 | `ORCHESTRATION.md` quality-tester role; `tasks/phase-5-polish.md` rehearsal ticket calls it |
| `.claude/agents/ai-integrator.md` (full agent definition with production rules, forbidden-imports list, line-number bbox pattern, definition-of-done) | **Required reading** for our Phase 3 subagents | Our Phase 3 ticket prompts cite it as required reading |
| `.claude/agents/api-builder.md` (FastAPI route shape, OpenAPI auto-gen, contract-first patterns) | Required reading for Phase 2 ticket prompts | Phase 2 cites it for shape only — implementation is Next.js + Prisma, not FastAPI + Mongo |
| `.claude/agents/ui-builder.md` (screen inventory, button inventory, PDFViewer integration, glass-effect CSS) | Required reading for Phase 4 ticket prompts | Phase 4 cites it for the React/PDFViewer patterns; scaffold differs (Next.js vs Vite) |
| `.claude/orchestrator/templates.md` (data model + workflow state machine + processing status templates) | Reference reading | Their templates are MongoDB-flavored; our equivalents already exist in `WORKFLOW.md` + `ARCHITECTURE.md`. Cited for shape comparison only. |
| `.claude/orchestrator/completion.md` (post-phase wrap-up format) | Adopt for Phase 5 | `tasks/phase-5-polish.md` rehearsal ticket uses the completion-report format |

What this gets us:
- **Plan mode protocol** — every subagent enters plan mode, produces a task backlog, gets orchestrator approval before writing code. Caught design drift before it became code.
- **Verify→Resume feedback loop** — orchestrator's quick checks first; integration-tester next; failures route to the responsible agent for resume (max 3 retries). Replaces our previous ad-hoc "orchestrator runs the smoke script" pattern.
- **Definition-of-done checklists** — every Phase ticket already had an exit checklist; the kit's agent definitions show how to express per-agent DoD too. The Phase 3 evidence-extraction ticket already adopted this; the others can follow.

## Adopt with adaptation

| Artifact | Adaptation | Why |
|---|---|---|
| `storage-format` zero-transform rule | Postgres `Citation.bboxes` is `Json` (was: structured columns); API returns the JSON as-is; UI passes to PDFViewer with no transformation. | Their rule is MongoDB-flavored; ours is Postgres-flavored, but the same principle applies: the canonical bbox shape stays identical from AI → DB → API → UI. |
| `platform-backend-kit/utils/line_number_bbox_utils.py` | Port the relevant helpers (`create_evidence_citation_from_line_numbers`) into `services/ai/utils/bbox.py`. | We can't pull the whole kit (FastAPI patterns mismatch), but this utility is pure-Python and directly useful. |
| `PenguinTracer.session()` setup | Tracing is off by default for the demo (no Langfuse env vars). When env vars present, `services/ai/penguin_client.py` wraps each request in a session. | Matches `AI_INTEGRATION.md` already; the kit confirms the env-var auto-detection behavior. |
| "FORBIDDEN LIBRARIES" hard rule from `ai-engineering-guide/SKILL.md` | Promote to a `CLAUDE.md` hard rule for the FastAPI sidecar. | `pytesseract`, `openai`, `anthropic`, raw `boto3` for Bedrock, `langchain` direct — all forbidden inside `services/ai/`. We use Penguin only. Prevents subagent drift. |
| Subagent skill references (`frontend-guide`, `backend-guide`, `ai-engineering-guide`) | Cited from our Phase 2/3/4 subagent prompts as recommended reading. | Their prompts are richer than ours for narrow tasks; subagents can pull from them. |

## Adopt directly — `platform-backend-kit` patterns into `services/ai/`

> **Position update:** the earlier doc said "ignore the backend kit." That was too coarse. The kit IS a FastAPI app and our `services/ai/` IS a FastAPI app — the overlap is the entire shape of the service. We adopt the kit's *patterns* into our sidecar; we don't adopt MongoDB or multi-tenant, but the polish around them is real and free.

The kit's storage layer is MongoDB and ours is Postgres-on-the-Next.js-side, so the two services don't share a DB layer. Everything else is portable. From `penguinai-claude-artifacts-main/platform-backend-kit/app/`:

| Path in kit | Adoption | Where it lands |
|---|---|---|
| `main.py` (`create_app()` factory + lifespan) | Direct port (minus the modules we don't use) | `services/ai/main.py` |
| `config.py` (pydantic-settings + `get_settings()` cached) | Direct port | `services/ai/config.py` |
| `logging_config.py` (loguru + `request_id_ctx` / `trace_id_ctx` ContextVars) | Direct port | `services/ai/logging_config.py` |
| `middleware/request_id.py` (uuid4 if absent, propagate to ContextVar, `X-Request-ID` response header) | Direct port | `services/ai/middleware/request_id.py` |
| `middleware/logging.py` (structured loguru log per request with method/path/status/duration_ms) | Direct port | `services/ai/middleware/logging.py` |
| `middleware/security.py` (security response headers) | Direct port | `services/ai/middleware/security.py` |
| `common/exceptions.py` (`AppException`, `NotFoundException`, `BadRequestException`, etc.) | Direct port | `services/ai/common/exceptions.py` |
| `common/error_handlers.py` (canonical `{error: {code, message, details?}}` shape; loguru-traced 500s) | Direct port | `services/ai/common/error_handlers.py` |
| `common/audit.py` (`audit_log()` helper emitting structured events via loguru `bind`) | Adapt — same call signature, but write to our Postgres `PaEvent` table instead of relying on a downstream log forwarder | `services/ai/common/audit.py` |
| `modules/health/routes.py` (`/health` liveness + `/readiness` with provider checks) | Adapt — drop Mongo/Redis checks, add `is_tracing_enabled()` + Bedrock reachability ping | `services/ai/modules/health/routes.py` |
| `tests/conftest.py` + `tests/test_*` layout | Direct port of the test scaffold | `services/ai/tests/` |
| `utils/evidence_bbox_utils.py` (line-number → canonical bbox helpers) | Direct port — already called out elsewhere in this map | `services/ai/utils/bbox.py` |

**Aggregated `services/ai/` shape after the port:**
```
services/ai/
  main.py                      # create_app() + lifespan, module registration
  config.py                    # Settings via pydantic-settings + lru_cache
  logging_config.py            # loguru + ContextVars (request_id, trace_id, span_id)
  penguin_client.py            # get_model(role) — only file that imports penguin.*
  cache.py                     # ai_call_cache Postgres helper (asyncpg)
  middleware/
    __init__.py
    request_id.py              # ported from kit
    logging.py                 # ported from kit
    security.py                # ported from kit
  common/
    __init__.py
    exceptions.py              # ported from kit
    error_handlers.py          # ported from kit
    audit.py                   # ported (rewired to PaEvent)
    schemas.py                 # canonical request/response Pydantic models
  modules/
    health/
      __init__.py
      routes.py                # adapted from kit
    derive_codes/
      __init__.py
      schemas.py
      routes.py
      service.py
    extract_evidence/
      ...
    ingest_policy/
      ...
  utils/
    bbox.py                    # ported from kit (line-number → canonical bbox)
  prompts/
    code_derivation_v1.py
    evidence_extraction_v1.py
    policy_ingestion_v1.py
    criteria_split_v1.py
  tests/
    conftest.py
    test_health.py
    test_derive_codes.py
    test_extract_evidence.py
```

**Same direction on the Next.js side — adopt response-shape contracts even with mock auth:**

| Kit contract | Adoption |
|---|---|
| `contracts/auth-response.md` | `/api/auth/session` returns `{access_token, token_type: "bearer", user: {id, name, npi, specialty, ...}}` even though the token is a hardcoded dev value. |
| `contracts/error-response.md` | Every Next.js error response uses `{error: {code, message, details?}}` matching the FastAPI service's shape. Single error-response helper in `lib/api/error.ts`. |
| `contracts/pagination.md` | `/api/queue` returns `{items, total, page, page_size}` (not `{data, meta}` or `{rows, count}`). |

## Out-of-scope kit pieces (still skipping)

| Artifact | Why we're not adopting |
|---|---|
| `platform-backend-kit/app/database.py` (Motor / MongoDB) | We're Postgres on Prisma. The AI sidecar reads/writes only `ai_call_cache` (asyncpg, not Motor). |
| `platform-backend-kit/app/redis.py` + `middleware/rate_limit.py` | Redis is overkill for the demo. Could revisit Phase 5+ if rate-limiting matters in production. |
| `platform-backend-kit/app/tenant.py` + `middleware/tenant.py` | Single-tenant per `HACKATHON_SCOPE.md`. |
| `platform-backend-kit/app/modules/auth/` (JWT, SAML, Microsoft providers) | Hardcoded session per `HACKATHON_SCOPE.md`. We adopt the response-shape contracts (above) but not the implementation. |
| `platform-backend-kit/app/modules/storage/` (S3 + presigned URLs) | Local file storage for the demo. Phase 4 page-image generation can reuse the patterns when we get to it. |
| `platform-backend-kit/app/modules/tasks/` + `celery_app.py` | Vercel Cron handles our two background needs (simulator tick + 60-day sweep). |
| `Standard_UI_Template/` (React + Vite + Tailwind v4) | Our UI is Next.js (App Router) with Tailwind v3. We borrow brand color and glass-effect CSS only — the rest of the template's structure conflicts with the App Router. |
| `pattern: jwt-auth.md` | Hardcoded session cookie. |
| `pattern: multi-tenant-design.md` | Single-org. |
| `pattern: s3-integration.md` | Local file storage. |
| `capability: rbac.md` | Single hardcoded provider. |
| `capability: async-processing.md` (Celery) | Vercel Cron. |
| `capability: realtime-status.md` (websockets) | Polling on the tracker is good enough for the demo. Could revisit Phase 5+. |
| `.claude/orchestrator/requirements.md` (Phase 0 capability questionnaire) | Our requirements are locked in `HACKATHON_SCOPE.md` + `DEMO_SCENARIOS.md`. Skipping the questionnaire itself; the rest of the orchestrator playbook is adopted (see "Orchestration patterns" section above). |

## Real data files dropped at repo root (`UHC/`, `CMS/`, `CPT Codes/`, `ICD-10 – Full Code Set/`)

The user added the actual policy and reference-code data alongside the artifacts kit. Closes the CMS-schema and UHC-PDF open questions.

### `CMS/` — five CSVs (real, large)

| File | Rows | Schema (key fields) | Purpose |
|---|---:|---|---|
| `lcd_policies.csv` | 199,868 | `lcd_id, lcd_version, title, indication (HTML), diagnoses_support (HTML), coding_guidelines (HTML), doc_reqs (HTML), summary_of_evidence, ...` | Local Coverage Determinations — the policies themselves |
| `ncd_policies.csv` | 12,414 | `NCD_id, NCD_vrsn_num, indctn_lmtn (HTML), itm_srvc_desc, NCD_efctv_dt, ncd_keyword, benefit_category_codes/descriptions, ...` | National Coverage Determinations |
| `articles.csv` | 114,735 | `article_id, article_version, title, indication (HTML), other_comments (HTML), keywords, status, ...` | Billing/coding articles. Many of the policy criteria for CPT/HCPCS codes live in articles, not the LCD itself. |
| `coverage_code_mappings.csv` | 555,082 | `policy_type, policy_id, mapping_type (cpt/hcpcs/icd10), code_value, description, ...` | The crucial reverse lookup — given a code, find every NCD/LCD/article that covers it. |
| `policy_contractor_mappings.csv` | 47,010 | `policy_type, policy_id, contractor_id, contractor_name, state_id, state_name, ...` | Which MAC contractor administers a policy in which state. |

**Key insight for Phase 2 policy lookup:** the join is `coverage_code_mappings` (filter by `code_value=70450, mapping_type=cpt`) → policy_id list → join to `lcd_policies` / `ncd_policies` / `articles` for the indication text. Index `coverage_code_mappings` on `(mapping_type, code_value)` after import.

**HTML in the indication / coverage_guidelines / doc_reqs columns:** strip with BeautifulSoup before AI ingestion (these aren't OCR — they're structured-ish HTML).

**Coverage of demo procedures (verified in `coverage_code_mappings.csv`):**
- **CPT 70450** (Head CT) — covered by 7 article policies: `53252, 56612, 56848, 57204, 57215, 57807, 58559`.
- **CPT 73721** (MRI lower extremity) — covered by `53252, 57807, 58559` plus likely others.
- **HCPCS J0585** (onabotulinumtoxinA per unit) — covered by 10 article policies: `52848, 56389, 56472, 56646, 57185, 57186, 57474, 57715, 58423, 59707`.

For the demo's hand-curated policy fixtures we'll pick the most clinically relevant article from each list (e.g. for J0585 the article whose title mentions chronic migraine). The article pre-screening can be done with the LLM if needed.

### `UHC/` — 705 PDFs (clinical-guidelines + medical-policies)

Two top-level dirs:
- `UHC/medical-policies/` — 661 PDFs of UHC medical-policy documents (the per-procedure / per-drug coverage criteria documents, like `botulinum-toxins-a-and-b-cs.pdf`).
- `UHC/clinical-guidelines/` — 44 PDFs of broader clinical guidelines (disease-specific, e.g. `asthma.pdf`, `heart-failure.pdf`).

**Coverage of demo procedures:**
- **Botox demo (J0585):** `UHC/medical-policies/botulinum-toxins-a-and-b-cs.pdf` is the commercial-supplement Botox policy (chronic migraine criteria). Use this as the source for the Botox demo policy fixture. The `-cs` suffix appears to indicate "commercial supplement"; `-iex` appears to be the individual exchange variant; the unsuffixed file is likely the master.
- **Head CT demo (CPT 70450):** no obvious single UHC PDF for general head/brain advanced imaging; the relevant UHC policy is likely `UHC/medical-policies/radiology-procedures-evicore-ohp.pdf` (eviCore is UHC's radiology benefit manager). Hand-curated for the demo regardless. Confirm at hand-curation time.
- **Knee MRI demo (CPT 73721):** the demo uses Medicare LCD coverage, not UHC, per `DEMO_SCENARIOS.md`. So this scenario uses CMS data, not UHC.

**Phase 3 policy ingestion** runs on any of these PDFs. The demo's hand-curated path is independent.

### `CPT Codes/cpt-codes.csv`

⚠️ **Caveat: only 21 codes** — this is a tiny sample, mostly E&M codes. The full AMA CPT set is ~10,000 codes.

Practical sources:
- **`coverage_code_mappings.csv`** has the codes referenced by CMS policies, with descriptions. We pull demo codes from there where possible (70450, 73721, J0585 are all confirmed to be present).
- **`penguin.data_assets.load_asset("cpt_codes")`** if a richer asset is published — see `ai-engineering-guide/usage/05-DATA-AND-COMPLIANCE.md`.
- For the demo's three procedures we only need 70450, 73721, J0585 — the user's CSV is sufficient if those three are present (they are confirmed in `coverage_code_mappings.csv`); the small CSV is fine for the demo seed.

Phase 1 reference-data ticket loads from the user's CSV first; backfills missing codes from `coverage_code_mappings.csv`. We accept the limitation rather than block on a fuller source.

### `ICD-10 – Full Code Set/` — six CSVs

| File | Rows | Purpose |
|---|---:|---|
| `icd10_codes.csv` | 98,187 | **Core lookup.** `order_number, code, billable, short_description, long_description`. This is the table we load into `CodeReference` (codeType=ICD10). |
| `icd10_index.csv` | 89,606 | Alphabetic index — `term, level, code, see_reference`. Useful for typeahead; not on demo critical path. |
| `icd10_drug.csv` | 7,431 | Table of Drugs and Chemicals — substance → poisoning/adverse-effect codes. Not on demo path. |
| `icd10_neoplasm.csv` | 1,941 | Neoplasm table by anatomy. Not on demo path. |
| `icd10_tabular_rules.csv` | 26,265 | Excludes1/Excludes2/Includes rules. Not on demo path; useful later for code validation. |
| `icd10_conversion.csv` | 5,892 | Year-over-year code conversions. Not on demo path. |

Phase 1 reference-data ticket loads `icd10_codes.csv`; the others are kept on disk for later if/when we need them.

## Decisions resolved by these artifacts

- **Open question: Penguin design tokens** → partially resolved. Primary color `#fc459d`, glass-effect pattern available. Full token set still pending; the placeholder palette in Phase 0 now uses these.
- **Open question: SDK install** → resolved. Bundled wheel at `packages/penguin_ai_sdk-0.2.0-py3-none-any.whl`. Phase 0 ticket `phase-0-fastapi` updates to install from this path.
- **Open question: CMS NCD/LCD CSV schema** → resolved. Real schemas in `CMS/`. Phase 1 `phase-1-cms-ingest` ticket updates with the actual columns.
- **Open question: UHC PDF format** → resolved. 705 PDFs in `UHC/`. Botox PDF identified for hand-curation; Phase 1 `phase-1-uhc-ingest` (deferred → now actionable) can run AI-driven ingestion against any of them.
- **Citation data model** → upgraded. We were planning `excerpt + startOffset + endOffset`; canonical contract is richer (`supporting_texts[] + bboxes[] + line_numbers[]` + reasoning + confidence). Prisma schema in `ARCHITECTURE.md` updates accordingly.
- **PDFViewer build vs buy** → buy. Drop in the data-labelling-library, save Phase 4 a week.
- **FastAPI sidecar polish** → adopt the kit's middleware/error/logging/health patterns rather than build them from scratch. Saves Phase 0 a few days and ships better defaults.
- **Backend stack** → unchanged. Next.js owns the user-facing API and the relational data via Prisma. The FastAPI sidecar owns AI work only. The kit's MongoDB/multi-tenant/JWT pieces remain out of scope; the kit's general FastAPI scaffolding pieces are now in scope.

## Files to read by phase

When subagents start work in a given phase, point them at these files (in addition to our planning docs):

| Phase | Read from artifacts |
|---|---|
| 0 | `ai-engineering-guide/SKILL.md` (Quick Start, Installation), `ai-engineering-guide/usage/00-GETTING-STARTED.md` |
| 1 | `contracts/extraction-result.md`, `contracts/evidence-citation.md`, `contracts/bbox-format.md` |
| 2 | (none required — backend is ours) |
| 3 | `ai-engineering-guide/usage/03-DOCUMENT-PROCESSING.md`, `ai-engineering-guide/PATTERNS.md`, `ai-engineering-guide/templates/{ocr_processor.py,llm_extractor.py,document_pipeline.py}` |
| 4 | `data-labelling-library/README.md`, `patterns/pdfviewer-component.md`, `contracts/pdfviewer-data.md` |
| 5 | (none required — polish is ours) |

## What's authoritative

- For SDK usage and patterns: the artifacts (`ai-engineering-guide/`).
- For our project shape (Next.js + Postgres + Path B): our planning docs.
- When they conflict on a detail (e.g. MongoDB vs Postgres storage): our docs win for storage; the kit wins for AI patterns.
