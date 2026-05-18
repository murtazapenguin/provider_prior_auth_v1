# Spawning & Verifying Agents

---

## Phase Instructions

For the phase workflow table showing all phases and their deliverables, see **CLAUDE.md Section 8**.

### Phase 1: ui-builder

- **Spawns with:** frontend-guide skill
- **FIRST ACTION:** Enter plan mode, create task backlog, get approval
- **THEN:** Read `HANDOFF.md` Phase 0, design workflow
- **Requirements:**
  - Login page mandatory
  - Header with profile + collapsible left sidebar
  - Paginated dashboard with filters and sorting
  - If `document_processing`: LH: PDFViewer/annotation tool, RH: AI responses. Otherwise: layout appropriate to selected capabilities.
  - Loading skeletons, error banners, empty states on every page
  - If `realtime_status`: WebSocket connection for real-time processing status
  - **Must copy CSS classes (`.gradient-bg`, `.glass-effect`, `.input-glow`) from `Standard_UI_Template/src/index.css`**
  - **Must copy animations (`gradient`, `float`, `pulse-slow`) from `Standard_UI_Template/tailwind.config.js`**
  - **Visual design must match Standard UI Template patterns (glass cards, gradients, shadows, hover transforms)**
- **Outputs:** Appends Phase 1 section to `HANDOFF.md`
- **Done when:** Build passes, ALL buttons wired, ALL routes work, visual design matches Standard UI Template, dev server at :5173

### Phase 2: api-builder

- **Spawns with:** backend-guide skill
- **FIRST ACTION:** Enter plan mode, create task backlog, get approval
- **Reads:** Phase 0 + Phase 1 Contract Surface of `HANDOFF.md`
- **MUST copy platform-backend-kit modules**
- **Requirements:**
  - API versioning `/api/v1/`
  - Multi-tenant: shared DB with `org_id` filtering
  - Celery worker for ALL background processing
  - S3 for ALL file operations
  - Global exception handler from starter kit
  - Health check: `GET /health` -> `{"status": "ok"}`
  - Seed data: 2 users, 6+ items with varied statuses
- **Does NOT handle AI/ML**
- **Outputs:** Appends Phase 2 section to `HANDOFF.md`
- **Done when:** ALL endpoints implemented, seed data loaded, server at :8000

### Phase 2.5: ai-integrator (conditional)

- **Spawns with:** ai-engineering-guide skill
- **FIRST ACTION:** Enter plan mode, create task backlog, get approval
- **Reads:** Phase 0 fully + Phase 1 and Phase 2 Contract Surfaces of `HANDOFF.md`
- **penguin-ai-sdk ONLY**
- **Celery tasks** for OCR + LLM processing
- If `document_processing`: Render PDF pages to PNG during OCR
- **MANDATORY:** Test with golden case fixture
- **Outputs:** Appends Phase 2.5 section to `HANDOFF.md`
- **Done when:** Golden case passes, AI integration complete per selected capabilities. If `evidence_display`: bboxes mapped.

**BLOCKING:** If golden case test fails, phase 2.5 CANNOT be marked complete.

### Phase 3: quality-tester

- **Spawns with:** ui-testing-guide skill
- **FIRST ACTION:** Enter plan mode, **extract test matrix from HANDOFF.md Phase 0**, create test backlog from TC-IDs, get approval
- **Reads:** ALL phases of `HANDOFF.md` — tests against the design
- **Primary input:** Test matrix from Phase 0 (TC-IDs traced to US-IDs)
- **MANDATORY:** Execute every TC-ID row in the test matrix
- **MANDATORY:** Real tests, not grep checks
- **MANDATORY:** Browser testing with Playwright MCP tools (`browser_navigate`, `browser_snapshot`, `browser_click`, etc.)
- **Agent executes tests automatically:** quality-tester runs ALL quality tests without asking permission
- **Test type = agent role:** quality-tester = quality tests, integration-tester = integration tests
- **Test matrix from Phase 0:** TC-IDs derived from user stories in HANDOFF.md - execute ALL automatically
- **NEVER ask:** "Should I run integration or quality tests?" (agent role determines this)
- **Outputs:** Appends Phase 3 section to `HANDOFF.md` with TC-ID results
- **Done when:** ALL TC-IDs executed and PASS, golden case produces expected output, PRODUCTION READY

---

## Plan Mode Protocol (ALL Agents)

**Every agent MUST enter plan mode before writing code.**

1. **Read HANDOFF.md** - Understand previous phases and requirements
2. **Load contracts** - Read relevant contracts from `.claude/contracts/`
3. **Create task backlog** - Break work into atomic tasks
4. **Get approval** - Present plan to user before executing
5. **Execute tasks** - Work through backlog, marking tasks complete

### Task Backlog Format

```markdown
## Task Backlog

### Setup (do first)
- [ ] Read HANDOFF.md Phases 0-N
- [ ] Load contracts: [list]
- [ ] Verify prerequisites: [list]

### Implementation
- [ ] Task 1: [specific, atomic action]
- [ ] Task 2: [specific, atomic action]

### Verification
- [ ] Run contract validation
- [ ] Run tests
- [ ] Update HANDOFF.md
```

### Example: api-builder Task Backlog

```markdown
## api-builder Task Backlog

### Setup
- [ ] Read HANDOFF.md Phase 0 (data model, enums) and Phase 1 Contract Surface (API requirements)
- [ ] Load contracts: auth-response, error-response, pagination, pdfviewer-data
- [ ] Verify: MongoDB running, Redis running

### Implementation
- [ ] Create project structure (backend/, routes/, models/, services/)
- [ ] Copy auth modules from platform-backend-kit
- [ ] Create User model matching Phase 0 schema
- [ ] Create POST /api/v1/auth/login (contract: auth-response)
- [ ] Create POST /api/v1/auth/register
- [ ] Create GET /api/v1/auth/me
- [ ] Create Case model matching Phase 0 schema
- [ ] Create GET /api/v1/cases (contract: pagination)
- [ ] Create GET /api/v1/cases/{id}
- [ ] Create POST /api/v1/cases/{id}/evaluate
- [ ] Create GET /api/v1/cases/{id}/results
- [ ] Create GET /api/v1/cases/{id}/pdfs (contract: pdfviewer-data)
- [ ] Create seed_data.py with demo users and cases
- [ ] Create docker-compose.yml

### Verification
- [ ] Run: pytest tests/
- [ ] Verify: GET /health returns {"status": "ok"}
- [ ] Append Phase 2 to HANDOFF.md
```

---

## Verify→Resume Feedback Loop (MANDATORY)

After EVERY subagent completes, there are TWO separate verification steps that run **AUTOMATICALLY**:

1. **Orchestrator verification** — quick checklist (build passes, HANDOFF updated, no TODOs)
2. **Integration-tester** — contract-driven cross-phase tests (HTTP calls, response shapes, format matching)

These are distinct. The orchestrator verifies deliverables; the integration-tester verifies contracts.

**CRITICAL: This entire flow is AUTOMATIC.** The orchestrator does NOT ask permission to run integration tests or proceed to the next phase. Verification and progression are deterministic based on test results and capabilities.

### Protocol

```
Orchestrator spawns subagent → gets summary + agent_id
        ↓
Step 1: ORCHESTRATOR VERIFIES (checklists below) [AUTOMATIC]
        ↓
    ┌── Pass → proceed to Step 2 [AUTOMATIC]
    └── Fail → Resume(agent_id, feedback) → re-verify (max 3)
                    ↓
               Still fails → STOP, ask user
        ↓
Step 2: SPAWN INTEGRATION-TESTER [AUTOMATIC - NO PERMISSION NEEDED]
        ↓
    ┌── Pass → auto-spawn next phase (see Automatic Phase Progression below)
    └── Fail → Resume(responsible_agent_id, details) (max 3)
                    ↓
               Still fails → STOP, ask user
```

### Step 1: Orchestrator Verification Checklists

These are quick checks the orchestrator runs directly (bash commands, file reads).

#### After Phase 1 (ui-builder)
- [ ] HANDOFF.md has "## Phase 1" with Contract Surface + screen/button inventories
- [ ] `npm run build` exits 0
- [ ] `grep -rn "TODO\|FIXME" src/` returns 0
- [ ] App.jsx routes match screen inventory

#### After Phase 2 (api-builder)
- [ ] HANDOFF.md has "## Phase 2" with Contract Surface + endpoints/models
- [ ] `GET /health` returns `{"status": "ok"}`
- [ ] `GET /docs` returns 200
- [ ] Status enums match Phase 0 exactly
- [ ] `grep -rn "TODO\|FIXME" backend/` returns 0

#### After Phase 2.5 (ai-integrator)
- [ ] HANDOFF.md has "## Phase 2.5" with Contract Surface
- [ ] Golden case has results in MongoDB
- [ ] If `evidence_display`: Results contain non-empty bboxes
- [ ] If `document_processing`: Page images exist in S3 (presigned URLs return 200)

#### After Phase 3 (quality-tester)
- [ ] Phase 3 section contains test matrix results (every TC-ID has PASS/FAIL)
- [ ] All TC-IDs from Phase 0 test matrix are executed
- [ ] Phase 3 section contains "PRODUCTION READY"

### Step 2: Spawn Integration-Tester (AUTOMATIC)

After orchestrator verification passes, **automatically spawn** the integration-tester to validate cross-phase contracts. **No user permission needed** — this is part of the automated phase flow.

**Integration-tester runs after EVERY phase. No exceptions.**

| After Phase | Integration-Tester Tests | Prompt Context |
|-------------|--------------------------|----------------|
| Phase 1 | Frontend builds, routes match screen inventory | "Phase 1 just completed" |
| Phase 2 | Frontend↔backend: auth format, response shapes, CORS | "Phase 2 just completed" |
| Phase 2.5 | Full stack: golden case results. If `evidence_display`: bbox format, evidence structure. | "Phase 2.5 just completed" |

**Parallel execution exception:** If phases 1+2 ran concurrently, skip the "after Phase 1" run and go straight to the "after Phase 2" run once both complete. The `1↔2` integration test covers everything.

**Spawn syntax:**
```
Task(subagent_type="integration-tester", prompt="""
  Phase 2 just completed. Test frontend↔backend integration.
  HANDOFF.md is at [project_root]/HANDOFF.md.
  Backend at http://localhost:8000, frontend at http://localhost:5173.
""")
```

**If integration-tester fails:** Use the failure routing table to identify the responsible agent, then resume that agent with the structured failure details.

### Automatic Phase Progression (MANDATORY)

After integration tests pass, the orchestrator MUST automatically spawn the next phase by reading HANDOFF.md. **NEVER ask the user "Option 1 / Option 2 / Option 3".**

**Decision-making process:**
1. Read entire HANDOFF.md (all completed phases)
2. Check Phase 0 capabilities to determine conditional phases
3. Verify which phases are complete
4. Automatically spawn the next required phase

**Phase Flow:**

| After Phase(s) | Integration Tests Pass | Next Action (AUTOMATIC) |
|----------------|------------------------|-------------------------|
| Phase 1+2 | ✅ | If `ai_extraction` capability (from Phase 0) → Spawn Phase 2.5 (ai-integrator)<br>If NO `ai_extraction` → Spawn Phase 3 (quality-tester) |
| Phase 2.5 | ✅ | Spawn Phase 3 (quality-tester) |
| Phase 3 | ✅ | Report completion (see completion.md) |

**The orchestrator determines the next phase by reading HANDOFF.md — NOT by asking the user.**

**Spawn immediately after integration tests pass. No user approval needed for phase progression.**

### Resume Syntax

```
result = Task(subagent_type="ui-builder", prompt="...")
# result includes agent_id

# If verification fails:
Task(resume=agent_id, prompt="""
  Verification found these issues:
  1. HANDOFF.md missing button inventory
  2. npm run build fails: [error]
  Fix these and re-verify.
""")
```

### Failure Routing

| Failure Type | Responsible Agent |
|-------------|-------------------|
| Wrong response field names | api-builder |
| Wrong request format | ui-builder |
| Missing endpoint | api-builder |
| Wrong bbox format | ai-integrator |
| CORS failure | api-builder |
| WebSocket failure | api-builder |

---

## Parallel Phase Execution (Phases 1 + 2)

Phases 1 and 2 depend ONLY on Phase 0 contracts. The orchestrator MAY spawn them in parallel:

```
Phase 0 approved
     ↓
┌────────────────┬────────────────┐
│  Phase 1       │  Phase 2       │
│  (ui-builder)  │  (api-builder) │
└────────┬───────┴────────┬───────┘
         ↓                ↓
Verify both (checklists above)
         ↓
Integration-tester: frontend↔backend check
         ↓
Phase 2.5 (if needed)
```

Spawn syntax:

```
Task(subagent_type="ui-builder", prompt="...", run_in_background=True)
Task(subagent_type="api-builder", prompt="...", run_in_background=True)
```

When NOT to parallelize:
- Phase 0 schemas are incomplete/ambiguous
- User requests sequential execution
