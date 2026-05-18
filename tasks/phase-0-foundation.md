# Phase 0 — Foundation

Goal: a buildable, runnable empty app. Next.js boots, Postgres + Prisma is wired, the FastAPI sidecar boots and is reachable from Next.js. No business logic.

All tickets in this phase are **inline / orchestrator** — single-threaded scaffolding work; parallelizing would just create merge conflicts.

Phase exit criteria are in `tasks/STATUS.md`.

---

## phase-0-scaffold-nextjs — Scaffold Next.js + Tailwind + TypeScript

- **Type:** inline
- **Goal:** create a fresh Next.js (App Router) + TypeScript + Tailwind project at the repo root.
- **Why it matters:** every screen, every API route, every server action lives here.
- **Owns:** `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `app/layout.tsx`, `app/page.tsx` (placeholder), `.gitignore`, `.eslintrc.cjs`, `.prettierrc`.
- **Depends on:** nothing.
- **Contract:**
  - `pnpm install` succeeds.
  - `pnpm dev` boots Next.js on `:3000` and the placeholder page renders.
  - Tailwind classes work (verify with a single `bg-pink-500` div on the placeholder).
  - TypeScript strict mode on; ESLint + Prettier configured to match the rest of the repo style.
- **Verify:** orchestrator runs `pnpm dev`, opens `localhost:3000`, sees the styled placeholder.

---

## phase-0-design-tokens — Penguin-flavored placeholder design tokens

- **Type:** inline
- **Goal:** populate `tailwind.config.ts` with a Penguin-branded palette + glass-effect utility, using the brand color the artifacts kit ships with. Full token set (if more are delivered later) swaps in at Phase 5.
- **Why it matters:** Phase 4 UI work assumes tokens are namespaced — building against `bg-primary` from day 1 means swapping tokens later is a config change, not a refactor. Using Penguin's brand color from the start makes the demo feel polished even before the full token set arrives.
- **Owns:** `tailwind.config.ts`, `app/globals.css`.
- **Depends on:** `phase-0-scaffold-nextjs`.
- **Contract:**
  - Primary brand color: `#fc459d` (from `penguinai-claude-artifacts-main/README.md` "PenguinAI Branding"). Set as `primary` in Tailwind.
  - Token names committed: `primary`, `primary-foreground`, `surface`, `surface-foreground`, `muted`, `muted-foreground`, `success`, `warning`, `danger`, `border`, `ring`.
  - Typography scale: `text-display`, `text-h1`, `text-h2`, `text-body`, `text-small`.
  - Glass-effect utility class in `globals.css`:
    ```css
    .glass-effect { background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(10px); }
    ```
  - A `components/ui/Button.tsx` placeholder uses `bg-primary` (proves wiring).
  - File header comment: `// Brand color from penguinai-claude-artifacts-main; rest of palette is placeholder. See ARTIFACTS_MAP.md.`
- **Verify:** orchestrator visually confirms the pink Button on `/` and a glass-effect card.

---

## phase-0-docker-compose — Local Postgres via docker-compose

- **Type:** inline
- **Goal:** ship a `docker-compose.yml` at the repo root so a fresh checkout can `docker compose up -d` and have a Postgres instance ready, without anyone needing to provision Vercel Postgres or Supabase first.
- **Why it matters:** Phase 0 schema work needs a DB. Without a one-command local DB, every developer / agent that picks up the project has to figure out Postgres themselves before any other work can start.
- **Owns:** `docker-compose.yml`, `.env.example` `DATABASE_URL` line.
- **Depends on:** nothing.
- **Contract:**
  - `docker-compose.yml` defines a single `postgres` service: image `postgres:16-alpine`, named volume `postgres_data`, port mapping `5432:5432`, env vars `POSTGRES_USER=pa_app`, `POSTGRES_PASSWORD=pa_app_dev`, `POSTGRES_DB=pa_app`, healthcheck on `pg_isready`.
  - `.env.example` includes `DATABASE_URL=postgresql://pa_app:pa_app_dev@localhost:5432/pa_app?schema=public`.
  - Brief README block (in `docker-compose.yml` header comment): `docker compose up -d` to start, `docker compose down` to stop, `docker compose down -v` to nuke volumes (rare — Phase 5 reset uses `pnpm db:seed --force` instead, which preserves the AI cache).
- **Verify:** `docker compose up -d`, wait 5 seconds, `pnpm prisma migrate dev` succeeds against the local DB.

---

## phase-0-prisma — Prisma + Postgres setup

- **Type:** inline
- **Goal:** install Prisma, point it at a local Postgres (or Vercel Postgres for deploy), generate the client, and run an initial empty migration.
- **Why it matters:** every backend module reads/writes via Prisma; nothing else can be built until the client is generated.
- **Owns:** `prisma/schema.prisma` (initial), `prisma/migrations/` (initial empty migration), `lib/db/client.ts` (singleton), `.env.example`.
- **Depends on:** `phase-0-scaffold-nextjs`, `phase-0-docker-compose` (for the local DB target).
- **Contract:**
  - `prisma/schema.prisma` declares only the `datasource`, `generator`, and a single `Healthcheck { id String @id @default(cuid()) ts DateTime @default(now()) }` table to validate migrations.
  - `lib/db/client.ts` exports a singleton `prisma` (handles HMR per Next.js convention).
  - `.env.example` has `DATABASE_URL=postgresql://...` placeholder.
  - `pnpm prisma migrate dev --name init` runs cleanly.
  - `pnpm db:push` and `pnpm db:seed` scripts exist in `package.json` (seed is a placeholder for now).
- **Verify:** orchestrator runs `pnpm prisma migrate dev` and confirms the `Healthcheck` table exists in the local DB (`psql -c '\dt'`).

---

## phase-0-schema — Author the full Prisma schema

- **Type:** inline
- **Goal:** author the complete Prisma schema from `ARCHITECTURE.md` (Patient, Coverage, Encounter, ClinicalNote, Provider, Payer, Policy, PolicyCode, PolicyCriterion, PriorAuth, PriorAuthCode, CriterionResult, Citation, Attachment, PaEvent, CodeReference, plus the `ai_call_cache` table from `AI_INTEGRATION.md`).
- **Why it matters:** every later phase imports from `@prisma/client`. We lock the schema once here so subagents don't fight over it.
- **Owns:** `prisma/schema.prisma`.
- **Depends on:** `phase-0-prisma`.
- **Contract:**
  - Every model from `ARCHITECTURE.md` "Data model" is present, named exactly as specified.
  - `PriorAuth.status` is `String` (not an enum) — values are validated by the state machine module in Phase 2, not the DB.
  - `@@index` on hot lookup paths: `PolicyCode([code, codeType])`, `PriorAuth([status])`, `PaEvent([priorAuthId, createdAt])`, `CodeReference([codeType, code])`.
  - `ai_call_cache` table: `id`, `task` (string), `promptVersion` (string), `model` (string — e.g. `claude-sonnet-4-5`), `inputHash` (string, sha256), `responseJson` (Json), `tracedTo` (string, nullable Langfuse trace id), `createdAt`. **Unique index on `(task, promptVersion, model, inputHash)`** — model is in the key so swapping to Sonnet 4.6 / Haiku doesn't serve stale cache.
  - **Citation table** matches the canonical `evidence-citation` contract: `supportingTexts String[]`, `reasoning String?`, `confidence Float`, `bboxes Json` (array of 8-point bbox objects), `lineNumbers Int[]`. **Do not use** the older `excerpt + startOffset + endOffset` shape — that was deprecated when we adopted the artifact contracts. See `ARTIFACTS_MAP.md`.
  - **PolicyCriterion** has `sourceBboxes Json?` and `sourceLineNumbers Int[]` for citing back to the source PDF (canonical bbox-format).
  - Migration named `0002_full_schema` runs cleanly.
- **Verify:** orchestrator runs `pnpm prisma migrate dev` and `pnpm prisma studio`; spot-checks that every table is present.
- **Hard rule:** any future change to the schema requires updating `ARCHITECTURE.md` in the same commit (per CLAUDE.md).

---

## phase-0-fastapi — FastAPI sidecar scaffold (with backend-kit ports)

- **Type:** inline
- **Goal:** create the Python AI service skeleton at `services/ai/` with a `/health` route, the Penguin client lazy-init wrapper, and the SDK installed from the bundled wheel. **Port the backend-kit's middleware / common / health patterns** while we're here so Phase 1+ subagents inherit the production-quality scaffolding instead of writing their own.
- **Why it matters:** Phase 3 builds the real AI handlers on top of this. Standing it up now (with the SDK actually installed and middleware/error/logging in place) catches any wheel/install issues immediately and gives every later FastAPI handler structured logging, request IDs, and canonical error responses for free.
- **Owns:** `services/ai/pyproject.toml`, `services/ai/main.py`, `services/ai/config.py`, `services/ai/logging_config.py`, `services/ai/penguin_client.py`, `services/ai/cache.py`, `services/ai/middleware/{__init__.py,request_id.py,logging.py,security.py}`, `services/ai/common/{__init__.py,exceptions.py,error_handlers.py,audit.py,schemas.py}`, `services/ai/modules/health/{__init__.py,routes.py}`, `services/ai/utils/bbox.py`, `services/ai/.env.example`, `services/ai/tests/{conftest.py,test_health.py}`.
- **Depends on:** nothing (parallel to Next.js scaffolding in principle, but kept inline to avoid env-file drift).
- **Contract:**
  - `services/ai/pyproject.toml` pins:
    ```toml
    [project]
    dependencies = [
      "penguin-ai-sdk[cpu] @ file:../../penguinai-claude-artifacts-main/packages/penguin_ai_sdk-0.2.0-py3-none-any.whl",
      "fastapi>=0.110",
      "uvicorn[standard]>=0.27",
      "pydantic>=2.6",
      "pymupdf>=1.24",
      "httpx>=0.27",
      "loguru>=0.7",
    ]
    ```
    Note: install `torch` first via `pip install torch --index-url https://download.pytorch.org/whl/cpu` on Mac/laptops (per `ai-engineering-guide/SKILL.md`).
  - `services/ai/main.py` follows the kit's `create_app()` factory pattern from `penguinai-claude-artifacts-main/platform-backend-kit/app/main.py`. Order of operations:
    1. `configure_logging(get_settings())` before anything logs.
    2. `lifespan` context wires up cache pool startup/shutdown.
    3. Middleware in this order (outermost first): `SecurityHeadersMiddleware`, `RequestIDMiddleware`, `LoggingMiddleware`. Skip `RateLimit/Tenant/JWTSession` (out of scope per `ARTIFACTS_MAP.md`).
    4. `register_error_handlers(app)`.
    5. Include routers: health, derive_codes, extract_evidence, ingest_policy.
  - **Backend-kit ports** (drop-in from `penguinai-claude-artifacts-main/platform-backend-kit/app/`):
    - `middleware/request_id.py` → `services/ai/middleware/request_id.py` (port verbatim — uuid4 if no `X-Request-ID` header, propagate to ContextVar, set response header).
    - `middleware/logging.py` → `services/ai/middleware/logging.py` (port verbatim — structured loguru log per request with method/path/status/duration_ms).
    - `middleware/security.py` → `services/ai/middleware/security.py` (port verbatim).
    - `common/exceptions.py` → `services/ai/common/exceptions.py` (port verbatim — `AppException`, `NotFoundException`, `BadRequestException`, etc.).
    - `common/error_handlers.py` → `services/ai/common/error_handlers.py` (port verbatim — canonical `{error: {code, message, details?}}` shape).
    - `common/audit.py` → `services/ai/common/audit.py` (adapt — keep the `audit_log()` signature; the Next.js side persists `PaEvent` rows, so on the Python side `audit_log()` just emits structured loguru events that Next.js can pick up via the response or via a follow-up writeback API call).
    - `logging_config.py` → `services/ai/logging_config.py` (port — sets up loguru with the ContextVars used by `request_id.py`).
    - `config.py` → `services/ai/config.py` (port + trim — pydantic-settings `Settings` with `get_settings()` cached; drop Mongo/Redis/SAML fields; keep AWS/Bedrock/S3 staging/Langfuse model fields).
    - `modules/health/routes.py` → `services/ai/modules/health/routes.py` (adapt — `/health` returns `{"status": "healthy"}`; `/readiness` checks `is_tracing_enabled()` + a no-op Bedrock auth ping; drop Mongo/Redis/S3 checks).
    - `tests/conftest.py` + test layout → `services/ai/tests/conftest.py` (port the fixtures pattern).
    - `utils/evidence_bbox_utils.py` (or the `line_number_bbox_utils.py` if present) → `services/ai/utils/bbox.py`. Where the SDK's built-in `OCRResult.find_line_as_bbox` / `ocr_result_to_bbox_format` cover the case, prefer those; the utility holds only what the SDK doesn't.
  - `services/ai/penguin_client.py` defines `get_model(role)` per `AI_INTEGRATION.md` with **real** `create_model` calls now that the SDK is installed (no NotImplementedError — wiring is real, the four task handlers in Phase 3 just don't exist yet).
  - `services/ai/common/schemas.py` declares request/response Pydantic models for the four AI tasks. Evidence-extraction response shape matches the canonical `evidence-citation` contract — `supporting_texts`, `reasoning`, `confidence`, `bboxes` (canonical 8-point format), `line_numbers`.
  - `services/ai/.env.example` (committed decisions: Bedrock for LLM, AWS Textract for OCR — single-cloud):
    - `AI_SERVICE_TOKEN=dev-token-change-me`
    - `AWS_REGION=us-east-1`
    - `AWS_ACCESS_KEY_ID=` (commented; user fills in)
    - `AWS_SECRET_ACCESS_KEY=` (commented; user fills in)
    - `S3_OCR_STAGING_BUCKET=` (commented; user fills in — bucket name they own; same region as Bedrock; 7-day lifecycle rule recommended)
    - `LANGFUSE_PUBLIC_KEY=` / `LANGFUSE_SECRET_KEY=` / `LANGFUSE_HOST=` (all commented — tracing off by default)
    - `PENGUIN_LLM_PROVIDER=bedrock`
    - `PENGUIN_LLM_MODEL=claude-sonnet-4-5`
    - `LOG_LEVEL=INFO`
    - `DEBUG=true`
  - `uvicorn services.ai.main:app --reload --port 8000` boots cleanly.
  - `pytest services/ai/tests` passes (health test asserts `from penguin.core import create_model` imports; readiness test asserts the route returns 200 with `tracing_enabled` flag).
  - **Hard rule (re-stated in `services/ai/main.py` header comment):** Penguin SDK imports only inside `services/ai/penguin_client.py`. Forbidden libraries from `CLAUDE.md` apply.
- **Verify:** orchestrator boots the service, hits `curl http://localhost:8000/health` (200) and `/readiness` (200), confirms request-id round-trips via the `X-Request-ID` response header, deliberately raises a `NotFoundException` from a debug route to verify the canonical error response shape.

---

## phase-0-ai-client — TS client for the FastAPI sidecar

- **Type:** inline
- **Goal:** build `lib/ai/penguinClient.ts` — the only TS file that knows the AI service URL and the bearer token.
- **Why it matters:** locks the boundary. Everything else in `lib/ai/*.ts` and beyond imports typed wrappers, not raw HTTP.
- **Owns:** `lib/ai/penguinClient.ts`, `lib/ai/index.ts` (barrel — exports nothing yet, just placeholders), `.env.example` updates.
- **Depends on:** `phase-0-fastapi`, `phase-0-scaffold-nextjs`.
- **Contract:**
  - Exports `aiFetch<T>(path: string, body: unknown): Promise<T>` that POSTs to `AI_SERVICE_URL` with the `Authorization: Bearer ${AI_SERVICE_TOKEN}` header, parses JSON, throws on non-2xx with a typed error.
  - Exports `aiHealth(): Promise<{ok: boolean; tracing_enabled: boolean}>`.
  - `.env.example` adds `AI_SERVICE_URL=http://localhost:8000` and `AI_SERVICE_TOKEN=dev-token`.
  - Throws a typed `AiUnreachableError` distinct from `AiInvalidResponseError` — Phase 3's canned-fallback layer will branch on these.
- **Verify:** orchestrator writes a one-off Next.js route handler at `/api/_debug/ai-health` that calls `aiHealth()` and returns its result; hits it from the browser with FastAPI running, confirms `{ok: true}`.

---

## phase-0-audit-statemachine-stubs — Stub modules + audit helper

- **Type:** inline
- **Goal:** create empty-but-typed stubs for `lib/statusMachine/transitions.ts`, `lib/audit/log.ts`, and the AI task modules under `lib/ai/*.ts` so that Phase 2 / 3 agents have an import surface to compile against.
- **Why it matters:** subagents in Phase 2/3 should be able to land code without needing each other's contracts to exist yet.
- **Owns:** `lib/statusMachine/transitions.ts` (stub), `lib/audit/log.ts` (stub), `lib/ai/codeDerivation.ts` (stub), `lib/ai/evidenceExtraction.ts` (stub), `lib/ai/policyIngestion.ts` (stub), `lib/ai/schemas/*.ts`.
- **Depends on:** `phase-0-schema`, `phase-0-ai-client`.
- **Contract:**
  - Each stub exports the function signatures called out in `ORCHESTRATION.md` (e.g. `transition(pa, event): {ok, ...}`) and throws `new Error("not implemented — see tasks/phase-N-*.md")`.
  - Zod schemas for all three AI task responses are real (we lock the contract here, even if the implementations are stubs).
  - `lib/audit/log.ts` exposes `recordEvent({ priorAuthId, type, fromStatus?, toStatus?, actor, metadata })` — Phase 2 uses this from day 1.
- **Verify:** `pnpm tsc --noEmit` passes with all stubs present.

---

## phase-0-vitest — Vitest + smoke test

- **Type:** inline
- **Goal:** install Vitest, configure path aliases, write one passing smoke test.
- **Why it matters:** agent-built modules in later phases ship with their own tests; we need the runner alive first.
- **Owns:** `vitest.config.ts`, `__tests__/smoke.test.ts`, `package.json` test script.
- **Depends on:** `phase-0-scaffold-nextjs`.
- **Contract:**
  - `pnpm test` runs Vitest and reports 1 passing smoke test.
  - Path alias `@/lib` works inside tests.
- **Verify:** orchestrator runs `pnpm test`.

---

## Phase 0 exit checklist

- [ ] `docker compose up -d` brings up local Postgres; `pg_isready` passes
- [ ] `pnpm dev` boots Next.js with no errors
- [ ] `uvicorn services.ai.main:app --reload --port 8000` boots cleanly
- [ ] `pnpm prisma migrate dev` runs cleanly with the full schema
- [ ] Hitting `/api/_debug/ai-health` returns `{ok: true}` with FastAPI up
- [ ] `pnpm test` reports green
- [ ] `pnpm tsc --noEmit` reports green

When all seven are checked, the orchestrator updates `tasks/STATUS.md` and Phase 1 begins.
