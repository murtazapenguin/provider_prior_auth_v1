# PenguinAI Production Playbook

Build fully deployable, production-ready full-stack AI applications. This is the coding assistant playbook for forward-deployed engineers — minimize time-to-delivery at the highest standard. Every application ships with working AI, hardened backend, integrated UI, passing tests, and Docker deployment.

---

## ABSOLUTE RULE: User Specifications Override Everything

**If the user provides specific instructions, follow them EXACTLY. No deviations.**

This applies to ALL agents (orchestrator, ui-builder, api-builder, ai-integrator, quality-tester).

### What This Means

| User Specifies | Agent MUST Do | Agent MUST NOT Do |
|----------------|---------------|-------------------|
| "Use JSON for login with `{email, password}`" | Implement JSON login with email field | Use OAuth2PasswordRequestForm or username field |
| "Read data from `data/cases/{id}/`" | Read from that exact path | Invent a different path or use S3 |
| "Use Pydantic BaseModel for requests" | Use BaseModel | Use FastAPI's Form or other patterns |
| "Status enums: pending, processing, done" | Use those exact values | Add/remove/rename statuses |
| "API returns `{items, total, page}`" | Return that exact shape | Return `{data, count, pageNum}` |

### Why This Rule Exists

Agents have learned patterns from training data (e.g., FastAPI OAuth2 examples use `OAuth2PasswordRequestForm`). These patterns may conflict with user requirements. **User requirements always win.**

### Enforcement

1. **Before implementing**, check if user specified how to do it
2. **If specified** → follow exactly, even if it differs from "best practices"
3. **If NOT specified** → use capability defaults from `.claude/capabilities/`
4. **NEVER** invent or deviate - ask if unclear

### Applies To

- Data formats (JSON vs form-urlencoded)
- Field names (email vs username)
- File paths (local data/ vs S3)
- API shapes (response structure)
- Status values (enum names)
- Content types (request/response)
- Library choices (Pydantic vs Form)
- Any other user-specified detail

**If user said it, do it. Period.**

---

## ABSOLUTE RULE: No Fallbacks for penguin-ai-sdk

**When penguin-ai-sdk is unavailable, NEVER implement a fallback. ASK THE USER.**

### What This Means

| Situation | Agent MUST Do | Agent MUST NOT Do |
|-----------|---------------|-------------------|
| `penguin-ai-sdk` import fails | Stop and ask user how to proceed | Silently switch to pytesseract |
| OCR not available | Report error, ask user | Use tesseract as fallback |
| LLM client unavailable | Report error, ask user | Switch to openai/anthropic directly |
| Any AI feature missing | Ask user for guidance | Invent alternative implementation |

### Why This Rule Exists

Fallbacks create hidden dependencies and inconsistent behavior. If the SDK is unavailable:
- The user may need to install it
- The user may want to skip AI features entirely
- The user may have a specific alternative in mind

**The user decides, not the agent.**

### Enforcement

1. **If penguin-ai-sdk unavailable** → STOP immediately
2. **Report clearly**: "penguin-ai-sdk not available. How should I proceed?"
3. **NEVER** silently use pytesseract, openai, anthropic, langchain, etc.
4. **Wait for user decision** before proceeding

---

## ABSOLUTE RULE: Use Only User-Provided Test Data

**User provides test data → Agent inserts into DB (and S3 if `file_storage`/`document_processing`) → All code/testing uses ONLY this data.**

### The Flow

```
1. User provides test data (files, records, fixtures)
2. Agent inserts into S3 and/or MongoDB
3. All development and testing uses ONLY this inserted data
4. If data unclear → ASK USER (never invent)
```

### What This Means

| Situation | Agent MUST Do | Agent MUST NOT Do |
|-----------|---------------|-------------------|
| User provides test files | Insert into S3 (if `file_storage`/`document_processing`) or DB, use those files | Use different/made-up files |
| User provides test records | Insert into MongoDB, query those | Create mock records |
| Testing workflows | Use only user-provided data IDs | Invent fake IDs |
| Data is unclear | ASK USER what data to use | Assume or fabricate |

### Why This Rule Exists

- User-provided data represents real use cases
- Mock data hides integration bugs
- Only user knows what edge cases matter

### Enforcement

1. **Before coding** — Ask user for test data if not provided
2. **Insert first** — Put user data into DB (and S3 if applicable) before any testing
3. **Reference only** — Use only IDs/paths from inserted data
4. **If unclear** — ASK USER (never invent or mock)

---

## SUBAGENT EXECUTION PROTOCOL (AUTO-APPLIES TO ALL SPAWNED AGENTS)

**When you are spawned via the Task tool for implementation work, this protocol applies automatically.**

### Mandatory Flow

```
1. ENTER PLAN MODE ← before writing ANY code
2. Read HANDOFF.md ← understand context from previous phases
3. Create ATOMIC task backlog ← small, specific, verifiable tasks
4. Get USER APPROVAL on backlog
5. EXIT PLAN MODE
6. Implement tasks one by one
7. Mark tasks complete as you go
8. Append your phase section to HANDOFF.md
```

### Why This Matters

- **No wasted work** — User approves approach before implementation
- **Verifiable progress** — Atomic tasks can be checked off
- **Cross-phase alignment** — HANDOFF.md keeps all agents in sync

### What "Atomic Tasks" Means

❌ **Too vague:** "Build the frontend"
✅ **Atomic:** "Create LoginPage.jsx with email/password form that POSTs JSON to /api/v1/auth/login"

❌ **Too vague:** "Add API endpoints"
✅ **Atomic:** "Implement GET /api/v1/cases with pagination (page, page_size query params)"

### Example Task Backlog (document processing app)

> This example shows a document processing app. Your backlog will vary based on selected capabilities.

```markdown
## ui-builder Task Backlog

### Setup
- [ ] Copy tailwind.config.js from Standard_UI_Template
- [ ] Copy PDFViewer.jsx from data-labelling-library  # if document_processing
- [ ] Create .env.development with VITE_API_BASE_URL

### Components
- [ ] Create LoginPage.jsx - email/password form, JSON POST to /api/v1/auth/login
- [ ] Create Dashboard.jsx - case list table with status filter dropdown
- [ ] Create CaseReview.jsx - split view (PDFViewer left, CriteriaTree right)  # if document_processing

### Hooks
- [ ] Create useAuth.js - login(), logout(), token storage
- [ ] Create useWebSocket.js - connect to ws://localhost:8000/ws/{user_id}  # if realtime_status

### Verification
- [ ] npm run build passes
- [ ] All buttons wired (no console.log handlers)
- [ ] All routes navigate correctly
```

### DO NOT SKIP THIS

If you start writing code without an approved backlog:
- You may build the wrong thing
- Your work may conflict with other phases
- The user will ask you to redo it

**Enter plan mode first. Always.**

### Fast Path (when HANDOFF.md Phase 0 is comprehensive)

If ALL conditions met: complete schemas (JSON+Pydantic+TS), complete API formats, screen+button inventories, user approved Phase 0 with "comprehensive" flag.

Then subagents MAY:
1. Read HANDOFF.md → derive backlog from specs
2. Show derived backlog as confirmation (not full plan mode)
3. User confirms → execute. User objects → enter full plan mode.

---

## 0. Requirements Gathering (BLOCKING - DO THIS FIRST)

**STOP. Before exploring code or spawning any agent, you MUST complete requirements gathering.**

This is NOT optional. Skipping this step causes agents to build the wrong thing.

### Orchestrator Flow

1. Requirements gathering (conversational) — ask capability questions, derive schemas
2. Write user stories with acceptance criteria
3. **Derive test matrix from user stories** — every US gets ≥1 TC (see `.claude/orchestrator/requirements.md` Section 1c)
4. User approves capabilities + contracts + schemas + test matrix
5. WRITE HANDOFF.md Phase 0 — immediately after approval (BLOCKING, includes test matrix)
6. ENTER PLAN MODE — create implementation backlog
7. Get user approval → EXIT PLAN MODE → spawn subagents

### Subagent Flow

1. ENTER PLAN MODE — before any code
2. Read HANDOFF.md — understand context from previous phases
3. Create ATOMIC task backlog → Get USER APPROVAL → EXIT PLAN MODE
4. Implement tasks one by one, append phase section to HANDOFF.md

### Detailed Steps

For the complete requirements gathering process (capability selection, schema derivation, API format derivation, data type derivation), see `.claude/orchestrator/requirements.md`.

### BLOCKING Checklist

- [ ] Read capabilities from `.claude/capabilities/`
- [ ] Asked capability questions, built mapping table
- [ ] Derived ALL domain schemas (JSON + Pydantic + TypeScript)
- [ ] Derived ALL API formats from capability files
- [ ] User approved capabilities, contracts, schemas, formats, and types
- [ ] **Test matrix derived from user stories** (every US-ID has ≥1 TC-ID)
- [ ] **HANDOFF.md Phase 0 written** with ALL approved content (including test matrix)
- [ ] Implementation plan approved (plan mode)
- [ ] Infrastructure verified (see `.claude/orchestrator/infrastructure.md`)
- [ ] **SCHEMA GATE passed** (see below)

### SCHEMA GATE (BLOCKING)

Before spawning ANY subagent, HANDOFF.md Phase 0 MUST contain concrete JSON + Pydantic + TypeScript for all required schemas. Each must have identical field names/types across all three representations.

Required schemas: `ItemListResponse` (always), `ItemDetailResponse` (always), `ExtractionResultResponse` (if ai_extraction), `PDFViewerDataResponse` (if document_processing), `EvidenceCitation` (if evidence_display), `WebSocketMessage` (if realtime_status), `EditRequest/Response` (if editable_results).

### TEST MATRIX GATE (BLOCKING)

Before spawning ANY subagent, HANDOFF.md Phase 0 MUST contain a test matrix derived from user stories. Every user story (US-ID) must have at least one test case (TC-ID). The test matrix is a contract — the quality-tester executes it, the integration-tester validates API/Contract rows.

See `.claude/orchestrator/requirements.md` Section 1c for the derivation process and format.

If schemas, types, or test matrix are incomplete, DO NOT spawn subagents. See `.claude/orchestrator/requirements.md` for the full gate checklists.

---

**Detailed orchestrator instructions:** See `.claude/orchestrator/` — read ONLY the file for your current phase:
- `requirements.md`: Capability selection, schema derivation, environment variables, orchestrator checklist, test fixtures (Phase 0)
- `infrastructure.md`: Phase 0.5 infrastructure setup
- `spawning.md`: Phase instructions, verify→resume, parallel phases
- `templates.md`: Standard data model template, API shapes

**If you proceed without approved schemas, agents will produce incompatible data.**

---

## 1. Architecture Overview

**Skills** (frontend-guide, backend-guide, ai-engineering-guide, ui-testing-guide) are domain knowledge references loaded exclusively by subagents when spawned — not used directly by the orchestrator.

**Subagents** execute each phase: ui-builder (Phase 1), api-builder (Phase 2), ai-integrator (Phase 2.5), quality-tester (Phase 3).

**integration-tester** runs AFTER each phase to verify cross-phase integration before proceeding.

**Infrastructure**: MongoDB (Motor async), Docker Compose. Conditional: Redis + Celery (if `async_processing`), AWS S3 (if `file_storage` or `document_processing`), WebSocket (if `realtime_status`).

---

## 2. Functional Requirements

**Baseline pillars** (extend based on user problem statement):

1. **AI Workflow** (if `ai_extraction` capability) — penguin-ai-sdk pipeline per selected capabilities
2. **Backend** — FastAPI with multi-tenant auth, RBAC. If `async_processing`: Celery workers. If `file_storage` or `document_processing`: S3 storage. If `realtime_status`: WebSocket status.
3. **Frontend** — React UI. If `document_processing`: annotation tools (PDFViewer/NERViewer). If `ai_extraction`: AI response display. If `realtime_status`: real-time status.

**Problem-Driven Extensions:** The orchestrator MUST derive additional functional requirements from the user's problem statement during Phase 0. Document all problem-specific functional requirements in `HANDOFF.md` Phase 0 before spawning agents.

---

## 3. Non-Functional Requirements

**Baseline NFRs** (extend based on user problem statement):

- **Reuse-First**: ALWAYS copy from platform-backend-kit / Standard_UI_Template / data-labelling-library before writing from scratch
- **Test-Driven Development**: Tests written per phase, no phase complete without passing tests
- **Multi-tenant by default**: Shared DB with `org_id` filtering on every query (NOT separate DBs)
- **API versioning**: `/api/v1/` URL prefix on all endpoints
- **If `async_processing`:** All background tasks use Celery (Redis broker) — NO FastAPI BackgroundTasks
- **If `file_storage` or `document_processing`:** All file operations via S3 (presigned URLs) using `platform-backend-kit/app/modules/storage/`
- **If `realtime_status`:** WebSocket for real-time status — processing progress pushed to client via starter kit WebSocket manager
- **If `async_processing`:** Retry + Notify on failure — Celery tasks retry 3x with exponential backoff, then notify user via WebSocket
- **Docker Compose** for deployment (generated per project)
- **Prometheus metrics** + loguru structured logging
- **Security headers**, rate limiting, CORS from starter kit middleware

Document all problem-specific NFRs in `HANDOFF.md` Phase 0 before spawning agents.

---

## 4. Production-Ready Checklist

Every application MUST satisfy ALL items before shipping:

| Category | Requirement |
|----------|-------------|
| **Auth** | JWT login/logout, token refresh, protected routes, RBAC permissions |
| **Error Handling** | Global exception handler (starter kit), `{"detail": "message"}` error format, proper HTTP status codes |
| **Retry Logic** | If `async_processing`: Celery tasks: 3 retries, exponential backoff (10s, 30s, 90s), dead-letter logging |
| **Health Checks** | `GET /health` endpoint returning `{"status": "ok"}`, used by Docker healthcheck |
| **Logging** | Loguru structured logs, `request_id` tracing on every request (from starter kit middleware) |
| **Monitoring** | Prometheus `/metrics` endpoint via starlette_exporter |
| **WebSocket** | If `realtime_status`: Real-time processing status updates (uploaded -> processing -> complete/failed) |
| **Security** | Security headers middleware, rate limiting, CORS, input validation |
| **Seed Data** | 2+ demo users, 6+ sample items with varied statuses |
| **Docker** | docker-compose.yml with all services (app + conditional: celery worker, redis, mongo based on capabilities) |
| **Tests** | Backend: pytest + httpx. Frontend: Vitest. E2E: Browser tests via Playwright MCP |
| **API Docs** | Auto-generated at `/docs` (Swagger) and `/redoc` |

---

## 5. Technology Stack

| Layer | Technology | Source |
|-------|-----------|--------|
| Frontend | React + Vite + Tailwind v4 + React Router | Standard_UI_Template |
| Backend | FastAPI + Uvicorn | platform-backend-kit |
| Database | MongoDB (Motor async, multi-tenant via TenantDatabaseManager) | platform-backend-kit/app/database.py, app/tenant.py |
| Cache/Broker | Redis (caching + Celery broker) — if `async_processing` | platform-backend-kit/app/redis.py |
| Object Storage | AWS S3 (presigned URLs) — if `file_storage` or `document_processing` | platform-backend-kit/app/modules/storage/ |
| AI/ML | penguin-ai-sdk v0.2.0 (Azure OCR + user-selected LLM) — if `ai_extraction` | penguin-ai-sdk |
| Task Queue | Celery (background work, Redis as broker) — if `async_processing` | platform-backend-kit/app/modules/tasks/workers/ |
| Auth | JWT (SaaS token) + OAuth2 + SAML | platform-backend-kit/app/modules/auth/ |
| Real-time | WebSocket (processing status) — if `realtime_status` | platform-backend-kit/app/middleware/ |
| Deployment | Docker Compose | Generated per project |
| Monitoring | Prometheus + loguru + request_id tracing | platform-backend-kit/app/telemetry.py, app/middleware/logging.py |

---

## 6. Core Development Principles

### Principle 1: Reuse-First

**Priority order**: (1) Copy as-is → (2) Copy and extend → (3) Write from scratch ONLY if nothing exists

See `.claude/skills/backend-guide/SKILL.md` for the full module lookup table.

### Principle 2: Test-Driven Development

**TDD is not optional.** Tests are written BEFORE code, not after.

See `.claude/skills/ui-testing-guide/SKILL.md` for TDD requirements and test ownership matrix.

### Principle 3: Workflow Design First

BEFORE any agent writes code, it MUST design the workflow:

- **ui-builder**: Designs screen inventory, user journeys, state transitions, button inventory → appends Phase 1 to `HANDOFF.md`
- **api-builder**: Reads Phase 0 + Phase 1 of `HANDOFF.md`, maps button actions to endpoints, defines data models → appends Phase 2
- **ai-integrator**: Reads Phases 0-2 of `HANDOFF.md`, implements AI pipeline per Phase 0 capability selection → appends Phase 2.5
- **quality-tester**: Executes test matrix from `HANDOFF.md` Phase 0, tests against design (all phases), not just what code exists → appends Phase 3

---

## 7. Handoff Protocol (HANDOFF.md)

All inter-agent communication flows through a single `HANDOFF.md` file in the project root.

### Rules

1. **Orchestrator creates** `HANDOFF.md` with Phase 0 (requirements, data model, status enums) before spawning any agent.
2. **Each agent reads** the full file on startup to understand what previous phases built.
3. **Each agent appends** its phase section on completion — never overwrites previous phases.
4. **Append-only** — agents must not modify content from other phases.

Use `HANDOFF_TEMPLATE.md` as your starting point. It includes contract checklists for each phase.

---

## 8. Phase Workflow

| Phase | Agent | Skill | Key Deliverable | Done When |
|-------|-------|-------|-----------------|-----------|
| **-1** | **Orchestrator** | - | Capability→Contract mapping | USER APPROVED |
| 0 | Orchestrator | - | HANDOFF.md Phase 0, test fixtures | User approved |
| 0.5 | Orchestrator | - | Infrastructure verified, .env | Services running |
| 1 | ui-builder | frontend-guide | React app, HANDOFF.md Phase 1 | Build passes, :5173 |
| 1✓ | **orchestrator** | - | **Verify Phase 1 output** | **Checklist passes (or resume)** |
| 1→ | integration-tester | - | Frontend build + routes match screen inventory | Routes match, build clean |
| 2 | api-builder | backend-guide | FastAPI, HANDOFF.md Phase 2 | /docs at :8000 |
| 2✓ | **orchestrator** | - | **Verify Phase 2 output** | **Checklist passes (or resume)** |
| 1↔2 | integration-tester | - | Frontend↔backend contract check | Auth, shapes, CORS match |
| 2.5 | ai-integrator | ai-engineering-guide | AI integration per selected capabilities | Golden case passes (if applicable) |
| 2.5✓ | **orchestrator** | - | **Verify Phase 2.5 output** | **Checklist passes (or resume)** |
| 2.5→3 | integration-tester | - | Full stack end-to-end check | Golden case results + bboxes valid |
| 3 | quality-tester | ui-testing-guide | Test report | PRODUCTION READY |

**Parallel Execution:** Phases 1+2 MAY run concurrently (both depend only on Phase 0). When parallel: skip the `1→` integration run and go straight to `1↔2` after both complete.
**Verify→Resume:** Orchestrator verifies after each phase, resumes with feedback if issues (max 3). See `.claude/orchestrator/spawning.md`.

**CRITICAL:**
- **Phase -1 is BLOCKING** — Do NOT skip requirements gathering
- Orchestrator verifies subagent output, then **AUTOMATICALLY spawns integration-tester after EVERY phase** (no permission needed).
- **After integration tests pass, the orchestrator AUTOMATICALLY spawns the next phase based on HANDOFF.md (capabilities from Phase 0, completed phases, contracts). NEVER present "Option 1 / Option 2 / Option 3" to users** — the entire flow (verify → integration test → next phase) is automatic and deterministic.

For detailed phase instructions, see `.claude/orchestrator/spawning.md`.

---

## 9. Quick Reference Tables

### Resource Locations

| Resource | Path |
|----------|------|
| **Capabilities** | `.claude/capabilities/` |
| Skills | `.claude/skills/` |
| Subagents | `.claude/agents/` |
| Contracts | `.claude/contracts/` |
| Orchestrator Guide | `.claude/orchestrator/` (phase-specific files) |
| HLD (Architecture) | `.claude/HLD.md` |
| Standard UI Template | `Standard_UI_Template/` |
| PDF Viewer Library | `data-labelling-library/` (if `document_processing`) |
| Platform Backend Kit | `platform-backend-kit/` |
| Test Files | `test_files/` |

### Infrastructure Defaults

```
# Always
MongoDB:    mongodb://localhost:27017/ (default DB: penguin_app, org_id filtering)
API:        http://localhost:8000/api/v1/
Health:     GET /health -> {"status": "ok"}
Metrics:    GET /metrics (Prometheus)
Docs:       GET /docs (Swagger), GET /redoc

# If async_processing capability
Redis:      localhost:6379 (password: from env, SSL: from env)
Celery:     Redis as broker, 3 retries, exponential backoff

# If file_storage or document_processing capability
S3:         Shared bucket: workflow-builder-platform-backend-uploads (per-app folder via S3_APP_PREFIX)

# If realtime_status capability
WebSocket:  ws://localhost:8000/ws/{user_id}

# If ai_extraction capability (tracing — penguin-ai-sdk v0.2.0)
# Tracing is AUTOMATIC — set env vars and every create_model() call is traced.
# User MUST create a Langfuse project and provide keys.
LANGFUSE_PUBLIC_KEY:  pk-... (from Langfuse project settings)
LANGFUSE_SECRET_KEY:  sk-... (from Langfuse project settings)
LANGFUSE_HOST:        https://langfuse.penguinai.co
LANGFUSE_PROJECT:     your-project-name (optional — used as filter tag in Langfuse dashboard)
```

### Branding & Design System

The `Standard_UI_Template/` is the canonical design system. **All apps must match its visual patterns** — glass morphism, gradient backgrounds, shadow depth, hover animations, premium polish.

- **Design Reference:** `Standard_UI_Template/` — copy CSS classes (`index.css`) and animations (`tailwind.config.js`) into every new project
- **Primary Color:** `#fc459d`
- **Gradients:** `from-[#fc459d] via-purple-600 to-pink-600`
- **Glass Effect:** `bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl`
- **Hover Transforms:** `hover:scale-105 hover:shadow-2xl transition-all duration-300`
- **Logo Files:** `penguin-logo.svg`, `Penguinai-name.png`
- **Full design system details:** See `.claude/skills/frontend-guide/SKILL.md` "Design System" section
- **Wow Factor:** Every UI screen must feel premium — use animated counters, gradient accents, hover micro-interactions, progress visualizations, meaningful empty states, and smooth transitions. No flat, static, or boring screens.

### AI Providers (if `ai_extraction` capability)

| Capability | Provider | Selection |
|------------|----------|-----------|
| **OCR** | Azure Document Intelligence | Default |
| **LLM** | **Ask user** (Bedrock, Gemini, OpenAI, Azure OpenAI) | **User selects during Phase 0** |

> **IMPORTANT:** The orchestrator MUST ask the user which LLM provider and model to use. See `.claude/capabilities/ai-extraction.md` for the question and options. Record the selection in HANDOFF.md Phase 0.

---

## 10. Integration Contracts

Contracts define data formats between agents. See `.claude/contracts/README.md` for full specifications.

### Core Contracts (Always Needed)

| Contract | Producer | Consumers |
|----------|----------|-----------|
| auth-response | api-builder | ui-builder |
| error-response | api-builder | ui-builder |
| pagination | api-builder | ui-builder |
| websocket-messages | api-builder | ui-builder | *(if `realtime_status`)*

### Document Processing Contracts (For PDF Apps)

| Contract | Producer | Consumers |
|----------|----------|-----------|
| pdfviewer-data | api-builder, ai-integrator | ui-builder |
| page-images | ai-integrator | api-builder, ui-builder |
| bbox-format | ai-integrator | api-builder, ui-builder |

### Contract Validation Rules

1. **Status Enums Must Match:** Phase 2 status enums must exactly match Phase 0 definitions
2. **All Endpoints Implemented:** Phase 2 must implement all endpoints from Phase 1's `api_endpoints_required`
3. **Canonical Bbox Format:** If `evidence_display`: Phase 2.5 MUST use bbox-format contract — no exceptions
4. **Page Images Required:** If `document_processing`: Phase 2.5 MUST generate page images per page-images contract
5. **All Buttons Tested:** Phase 3 must test all buttons from Phase 1's button inventory
6. **Real Bboxes Required:** If `evidence_display`: All extraction results MUST include real bboxes — empty arrays forbidden

### Canonical Bounding Box Format (if `evidence_display` capability)

See `.claude/contracts/bbox-format.md` for full specification.

**Quick Reference:**
```json
{
  "page_number": 1,
  "document_name": "document.pdf",
  "bbox": [[x1, y1, x2, y2, x3, y3, x4, y4]]
}
```

**Critical Rules:**
- Coordinates normalized 0-1 (not pixels)
- page_number is 1-indexed
- document_name must match documentData.files exactly
- Empty bboxes forbidden for TRUE criteria

---

## 11. Production Enforcement

All agents must include the `production-enforcement` skill and follow these rules:

### Forbidden Patterns (must grep to 0)

- `TODO`, `FIXME`, `HACK` comments
- Mock/hardcoded data in production paths
- `pass` statements in handlers
- `return True` auth stubs
- `console.log` in onClick handlers
- Direct AI provider imports (openai, anthropic); langchain allowed ONLY via `penguin.core` re-exports
- Hardcoded `localhost:8000` URLs in frontend code (use relative `/api/v1` instead)

### Verification Commands

```bash
grep -rn "TODO" --include="*.py" --include="*.js" --include="*.jsx" .
grep -rn "FIXME" --include="*.py" --include="*.js" --include="*.jsx" .
grep -rn "mock" --include="*.py" --include="*.js" --include="*.jsx" .
grep -rn "localhost:8000" --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" --include="*.env*" .
```

### Definition of Done (all agents)

- [ ] NO TODO/FIXME comments
- [ ] NO mock data in production paths
- [ ] All functions fully implemented
- [ ] Real error handling
- [ ] Verification grep returns 0
- [ ] Deployable immediately

---

## 12. Index

| Documentation | Location | Purpose |
|---------------|----------|---------|
| **Requirements Gathering** | `CLAUDE.md Section 0` | **BLOCKING** - Capability→Contract mapping before any work |
| **Capabilities Registry** | `.claude/capabilities/README.md` | Available capabilities, dynamic selection |
| **Orchestrator Guide** | `.claude/orchestrator/` | Phase-specific instructions (requirements, infrastructure, spawning, templates, completion) |
| **HLD (Architecture)** | `.claude/HLD.md` | System diagrams, data flow, runtime architecture |
| **Contracts** | `.claude/contracts/README.md` | Data format specifications between agents |
| **Frontend Patterns** | `.claude/skills/frontend-guide/SKILL.md` | React, PDFViewer, state management |
| **Backend Patterns** | `.claude/skills/backend-guide/SKILL.md` | FastAPI, MongoDB, error handling |
| **AI Engineering** | `.claude/skills/ai-engineering-guide/SKILL.md` | penguin-ai-sdk, OCR, LLM |
| **Testing Guide** | `.claude/skills/ui-testing-guide/SKILL.md` | TDD, browser testing, cleanup |
| **Production Rules** | `.claude/skills/production-enforcement/SKILL.md` | No mocks, verification |
| **Subagents** | `.claude/agents/*.md` | Agent definitions per phase |