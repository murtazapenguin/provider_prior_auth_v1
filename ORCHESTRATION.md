# Orchestration: Splitting Build Work Across Subagents

This doc is for the human running the build (and for any orchestrating agent) to know how to break this app into parallelizable, well-scoped chunks of work that subagents can execute without stepping on each other.

The goal is **maximum parallelism with minimum merge pain**. We've designed the architecture (`ARCHITECTURE.md`) so that modules have clear boundaries — orchestration takes advantage of those boundaries.

## Core principles

1. **One module, one agent.** Each agent owns a directory. Two agents do not edit the same files.
2. **Interfaces first.** Before parallel work starts, the data model and module interfaces (`lib/*` exports) are locked. After that, agents can build against stubs.
3. **Stubs over branches.** When module A depends on module B, A imports a stub that returns realistic-shaped fake data until B is ready. We integrate later, not branch separately.
4. **Brief like a colleague.** Subagent prompts include: what we're trying to accomplish, what's already done, paths/line numbers, and the contract the subagent owes. Never "based on your findings, do X" — the orchestrator does the synthesis.
5. **Verify before declaring done.** Every subagent task ends with a verification step — typically reading the diff or running a smoke test.

## Available agent types (and when to use them)

This is a Cowork session running on top of the Claude Agent SDK. Available subagents:

- **Plan** — software architect; designs implementation plans for complex tasks. Use before starting anything cross-cutting (e.g., the data model, the AI module, the status state machine). Read-only — produces a plan, doesn't write code.
- **Explore** — fast read-only search agent. Use to find files / symbols / references during the build. Don't use for review or audit.
- **general-purpose** — researches, searches, executes multi-step tasks. Use for self-contained build chunks. **This is the agent type for every "agent" ticket in our `tasks/phase-*.md` files.**
- **claude-code-guide** — answers questions about Claude Code / SDK / API. Use only when we need help with the agent SDK itself (rare).
- **statusline-setup** — irrelevant for this project.

### Two virtual agent roles we layer on top

The Penguin artifacts kit's orchestration model defines two more "roles" we adopt by spawning a `general-purpose` agent with a specialized system prompt. They aren't separate Claude Agent SDK types — they're our naming convention.

- **integration-tester** — runs after every phase boundary (not at every ticket). Validates cross-phase contracts via real HTTP / DB calls and the demo scenarios. Blocks the next phase on failure. Pattern is adapted from `penguinai-claude-artifacts-main/.claude/agents/integration-tester.md`.
- **quality-tester** — runs in Phase 5 only. Browser-based testing with Playwright MCP. Executes the demo scenarios end-to-end through the live UI. Pattern is adapted from `penguinai-claude-artifacts-main/.claude/agents/quality-tester.md`.

We do not spawn agents unless the work is genuinely parallelizable or the task spans the codebase. Inline tools (Read/Write/Edit/Grep/Glob/Bash) handle most work and don't pay the cold-start cost.

### Agent definitions to read before spawning

Our subagent prompts in `tasks/phase-*.md` are minimal scopes + contracts. The Penguin kit's agent definitions (under `penguinai-claude-artifacts-main/.claude/agents/`) are richer — production rules, definition-of-done, forbidden-import lists, code templates. Subagents we spawn for build work should read the matching kit definition as required context:

| Our phase | Kit agent file (required reading) | Notes |
|---|---|---|
| Phase 1 (data) | — (no direct match) | Stick to our ticket prompt. |
| Phase 2 (domain backend) | `agents/api-builder.md` | Their API kit is FastAPI + MongoDB. We're Next.js Route Handlers + Postgres/Prisma. The route-shape, validation, and contract-first patterns transfer; the storage layer doesn't. Cite for shape, not for implementation. |
| Phase 3 (AI integration) | `agents/ai-integrator.md` | **High-fidelity match** — our `services/ai/` is exactly this agent's scope. Adopt the production rules wholesale: forbidden imports, line-number bbox retrieval, `with_structured_output(ContainerModel)`, the bbox-mapping process, definition-of-done. |
| Phase 4 (UI) | `agents/ui-builder.md` | Their UI kit is Vite + Tailwind v4. We're Next.js (App Router) + Tailwind v3. The PDFViewer integration, screen-inventory pattern, button inventory pattern transfer. Scaffold patterns don't. |
| Phase 5 polish + integration gates | `agents/integration-tester.md`, `agents/quality-tester.md` | Adopt their structured failure-output format and the test-matrix-from-Phase-0 pattern. |

## When to use parallelism

**Yes, parallelize when:**
- Two or more independent modules need to be built (e.g., the EHR adapter and the policy ingestion pipeline have no overlap).
- A research task and a build task can run side by side (e.g., one agent reads the Penguin SDK docs while another scaffolds the Next.js project).
- A test/eval task runs alongside the implementation it's evaluating.

**No, keep it sequential when:**
- Both tasks touch the same files.
- The output of one task changes the design of the next.
- The work is small enough that the cold-start of an agent is more cost than benefit.

## Build phases and agent allocation

The build is divided into **5 phases**. Phase boundaries are integration points — work crosses phases sequentially, but within a phase tasks parallelize.

### Phase 0 — Foundation (sequential, orchestrator-driven)
Goal: Next.js scaffolding + Prisma schema + Python FastAPI sidecar + AI client stubs.

Steps (full ticket-by-ticket detail in `tasks/phase-0-foundation.md`):
1. Scaffold Next.js + Tailwind + TypeScript. (orchestrator inline)
2. Placeholder design tokens. (orchestrator inline)
3. Prisma + Postgres setup, then author the full schema from `ARCHITECTURE.md`. (orchestrator inline)
4. FastAPI sidecar scaffold at `services/ai/` with `/health` and stubbed `penguin_client.get_model()`. (orchestrator inline)
5. TS HTTP client at `lib/ai/penguinClient.ts` — only file that knows the AI service URL. (orchestrator inline)
6. Stub modules + audit helper so Phase 2/3 agents have an import surface. (orchestrator inline)
7. Vitest smoke test. (orchestrator inline)

No agents here — fast, single-threaded scaffolding. Parallelizing only creates merge conflicts.

### Phase 1 — Core data + reference ingestion (parallel × 2)
Goal: code reference data loaded; demo patient/encounter fixtures loaded; policy schema populated with hand-curated demo policies.

Two agents in parallel:

- **Agent A: Reference data ingest.** Builds `prisma/seed/codeReference.ts` to load ICD-10 / CPT / HCPCS CSVs into `CodeReference`. Verifies row counts. Owns `prisma/seed/codeReference.ts` only.
- **Agent B: Demo fixtures + hand-curated policies.** Builds `prisma/seed/fixtures.ts` to load three patients, three encounters, three sets of clinical notes, and three hand-validated policies (one per scenario). Owns `prisma/seed/fixtures.ts` and `prisma/fixtures/*.json` only.

Integration: orchestrator wires both into `prisma/seed.ts`. Both agents agree on the `Policy` / `PolicyCriterion` row shape upfront (locked from `ARCHITECTURE.md`).

### Phase 2 — Domain backend (parallel × 4)
Goal: The state machine, eligibility lookup, policy lookup/matching, and the payer simulator all stand up. AI calls are still stubbed.

Four agents in parallel:

- **Agent C: Status machine.** Builds `lib/statusMachine/transitions.ts` and unit tests for every transition in `WORKFLOW.md`. Owns `lib/statusMachine/`. Returns clear function signatures for `transition(pa, event)`.
- **Agent D: Eligibility / coverage lookup.** Builds `lib/eligibility/lookup.ts` against seeded data. Owns `lib/eligibility/`.
- **Agent E: Policy lookup + matching engine (with stubbed AI).** Builds `lib/policies/lookup.ts` and `lib/policies/matchEngine.ts`. The match engine calls `lib/ai/evidenceExtraction.ts` which is still stubbed (returns canned responses for demo encounters). Owns `lib/policies/`.
- **Agent F: Payer simulator.** Builds `lib/payer/submit.ts` (HTTP boundary) and `lib/payer/simulator.ts` (timer-driven state walker hooked to Vercel Cron). Includes the fast-forward admin endpoint. Owns `lib/payer/`.

Integration: orchestrator wires the API routes (`app/api/pa/[id]/*`) to call the modules built above. Smoke test: programmatically run scenario 1 (Head CT) end-to-end at the API level.

### Phase 3 — AI integration (sequential then parallel × 2)
Goal: Real Penguin SDK calls replace the stubs. Path B is locked (Python only); details in `tasks/phase-3-ai.md`.

Sequential first:
1. Replace stubs in `services/ai/penguin_client.py` with the real `create_model` lazy initializer per `AI_INTEGRATION.md`. Stand up the four FastAPI route shells. Add the AI cache helper. (orchestrator inline)

Then parallel × 2:
- **Agent G: Code derivation.** Implements `services/ai/code_derivation.py` + `lib/ai/codeDerivation.ts`. Verifies output on the three demo encounters matches `DEMO_SCENARIOS.md`. Owns those files and `services/ai/prompts/code_derivation_v1.py`.
- **Agent H: Evidence extraction.** Implements `services/ai/evidence_extraction.py` (with `FaithfulnessDetector` for citation validation) + `lib/ai/evidenceExtraction.ts`. Verifies pass/fail/needs_info outcomes match `DEMO_SCENARIOS.md`. Owns those files and the prompt file.

Then orchestrator inline: build the canned-response fallback layer for demo determinism (cache is built in the sequential step).

(Policy ingestion — `services/ai/policy_ingestion.py` — is **not** on the demo critical path. The three demo policies are hand-curated in Phase 1. Build the ingester opportunistically when the UHC PDF arrives; see deferred ticket `phase-3-policy-ingestion`.)

### Phase 4 — UI (parallel × 4 by screen)
Goal: All provider-facing screens built and wired to the API.

Four agents in parallel, one per screen group. Each agent owns its directory in `app/(provider)/`.

- **Agent I: Encounter intake + code review.** `app/(provider)/encounter/[id]/`
- **Agent J: PA detail + criteria checklist + upload.** `app/(provider)/pa/[id]/`
- **Agent K: Ready-for-submission review + post-submission tracker.** `app/(provider)/pa/[id]/review/` and `tracker/`
- **Agent L: Work queue dashboard + scenario launcher.** `app/(provider)/queue/` and `app/demo/`

All four share the design system (`components/ui/`) which the orchestrator builds in Phase 0/1 from Penguin's tokens. Agents do not modify `components/ui/`.

Integration: orchestrator runs the three demo scenarios through the live UI end-to-end and fixes any cross-screen issues.

### Phase 5 — Polish + demo prep (sequential, orchestrator-driven)
Goal: Tighten timing, fix demo-killing bugs, write the demo script, fast-forward control, canned-response fallback verified, error states cleaned up.

No agents — this phase is hand-tuning.

## Subagent prompt template

Every subagent invocation should follow this shape (the per-ticket prompts in `tasks/phase-*.md` already use it; this is the canonical template):

```
Goal: <one sentence>

Why this matters: <one sentence — what does shipping this unblock?>

Required reading (in this order):
- <relevant kit agent definition under penguinai-claude-artifacts-main/.claude/agents/>
- <relevant kit contracts under .claude/contracts/>
- <relevant kit skill under .claude/skills/>
- <our planning doc(s) — CLAUDE.md, ARCHITECTURE.md, the ticket file>

Context (already done): <what exists in the repo that the agent should rely on>

Your scope: <exact files / directories the agent owns>

Your contract: <what the orchestrator expects: function signatures, schemas, return shapes, where to write tests>

Constraints:
- Do not modify files outside your scope
- Use existing types in lib/db (or wherever)
- Match the style of <reference file>
- Penguin SDK only — see CLAUDE.md "Forbidden libraries"

Plan mode (required, see below):
- Enter plan mode FIRST. Do not write code until the orchestrator approves the plan.
- The plan must list every file you'll create/edit, every function signature, every test you'll write.

When done, report back:
- Files changed
- Smoke test result (one paragraph)
- Definition-of-done checklist (see Phase ticket) — every item checked or explicitly skipped with reason
- Anything you discovered that the orchestrator should know
```

## Plan mode protocol (mandatory for every subagent)

Adopted from `penguinai-claude-artifacts-main/.claude/orchestrator/spawning.md`. Every subagent we spawn for build work follows this protocol:

1. **Read required context** — the ticket, the kit agent definition, the relevant contracts, our planning docs.
2. **Enter plan mode** (Claude Agent SDK supports this natively).
3. **Produce a task backlog** — atomic checklist of every file to create/edit, every function signature, every test, every dependency to add. Format:
   ```
   ## Task Backlog (agent: <name>)

   ### Setup
   - [ ] Read required context: <list>
   - [ ] Verify prerequisites: <list>

   ### Implementation
   - [ ] <atomic action 1>
   - [ ] <atomic action 2>
   ...

   ### Verification
   - [ ] Run <test command>
   - [ ] Update tasks/STATUS.md
   ```
4. **Get orchestrator approval** — present the backlog. The orchestrator either approves or sends it back with feedback.
5. **Exit plan mode** and execute the backlog, marking items complete as it goes.
6. **Report at the end** with the structured "When done" output above.

This is non-negotiable. Subagents that skip plan mode and start writing code get cancelled and respawned with a stricter prompt.

## Integration gates between phases

Adopted from `penguinai-claude-artifacts-main/.claude/agents/integration-tester.md`. After a phase's tickets all complete, **two verification steps run before the next phase begins**:

### Step 1: Orchestrator quick checks

The orchestrator runs short bash / file-read checks tied to that phase's exit checklist (the ones in each `tasks/phase-N-*.md` "exit checklist" section). These are fast (<60 seconds) and catch obvious misses: build failures, missing files, status enums that don't match `CLAUDE.md`, etc.

If any check fails, the orchestrator resumes the responsible agent with a structured feedback message (max 3 retries; on the third failure, stop and ask the user).

### Step 2: Spawn integration-tester (automatic)

If Step 1 passes, the orchestrator **automatically spawns** an `integration-tester` subagent — no user permission needed; this is part of the phase boundary.

The integration-tester runs the demo scenarios end-to-end at the appropriate level for the phase that just completed:

| After phase | What the integration-tester runs |
|---|---|
| 0 | Smoke: `pnpm dev` boots; FastAPI `/health` returns 200; `/_dev/components` renders. |
| 1 | DB has expected row counts; demo policies queryable; reference codes resolvable. |
| 2 | Smoke each demo scenario at the API level (with stubbed AI). Head CT lands on Approved end-to-end. |
| 3 | Smoke each demo scenario with the real Penguin SDK in the loop. Outcomes match `DEMO_SCENARIOS.md`. Hallucinated-citation test passes. |
| 4 | Browser-driven scenario walks (Playwright via the kit's `quality-tester` pattern). PolicyPdfViewer renders bboxes correctly. |
| 5 | Two clean rehearsals back-to-back, including the canned-fallback drill. |

The integration-tester reports in the structured failure format from `penguinai-claude-artifacts-main/.claude/agents/integration-tester.md` and routes failures via the table below. If it passes, the orchestrator marks the phase complete in `tasks/STATUS.md` and starts the next phase.

## Failure routing

When orchestrator checks or the integration-tester reports a failure, the orchestrator routes it to the responsible agent for resume (max 3 retries):

| Failure type | Responsible (resume target) |
|---|---|
| Status enum mismatch / state-machine bug | Agent C (Phase 2 status machine) |
| Wrong policy lookup result | Agent E (Phase 2 policy match engine) |
| Wrong code derivation | Agent G (Phase 3 code derivation) |
| Wrong evidence pass/fail or invalid citation | Agent H (Phase 3 evidence extraction) |
| Wrong bbox shape (not 8-point normalized, page_number not int, etc.) | Agent H or whoever produced the bboxes |
| API response shape mismatch with kit contracts | Orchestrator (API routes are inline-owned) |
| Frontend build failure or wrong route | Agent I/J/K/L (Phase 4) |
| Missing canonical-fallback handling | Orchestrator (Phase 3 canned-fallback layer is inline) |
| Demo timing off | Orchestrator (Phase 5 polish is inline) |

Same protocol as the kit: max 3 resume cycles, then stop and ask the user.

Concrete example for Agent C (Status machine):

```
Goal: Implement the PA status state machine.

Why this matters: All routes that change PA status will go through this — getting it right makes every downstream feature simpler.

Context (already done): Prisma schema is in /Users/murtaza/Documents/provider_pa/prisma/schema.prisma. WORKFLOW.md lists every state and transition. Audit log helper exists at lib/audit/log.ts.

Your scope: Only files under /Users/murtaza/Documents/provider_pa/lib/statusMachine/ and __tests__/lib/statusMachine/.

Your contract:
- Export function: transition(pa: PriorAuth, event: PaTransitionEvent): { ok: true, next: PriorAuth } | { ok: false, reason: string }
- Export constant: TRANSITIONS — the full transition table (typed)
- Write a vitest spec covering every transition in WORKFLOW.md (positive cases) and at least 5 invalid transitions (negative cases)

Constraints:
- Do not write to the DB; the caller persists. You return the next state.
- Do not modify the Prisma schema.

When done:
- List of files changed
- Output of `pnpm vitest run lib/statusMachine` showing all green
- Any state I should add or rename based on what you found
```

## What the orchestrator does

The orchestrator (the main Claude session driving the build) is responsible for:

1. **Owning the data model.** Schema changes flow through the orchestrator only.
2. **Owning the API routes.** Route handlers in `app/api/` are wired by the orchestrator after subagent modules return their contracts.
3. **Owning integration.** The orchestrator runs each demo scenario end-to-end after every phase and catches cross-module issues.
4. **Owning the build commands.** package.json scripts, ESLint, prettier, vitest config.
5. **Owning the prompt evolution loop.** When AI tasks misbehave, the orchestrator iterates the prompts (not subagents).
6. **Owning verification gates.** Phase doesn't end until the orchestrator runs the demo scenario at the appropriate level (API in Phase 2, UI in Phase 4).

## Anti-patterns to avoid

- **Letting an agent design.** Subagents implement against a contract; they don't decide the contract. If a contract is unclear, the orchestrator clarifies before spawning the agent.
- **Multi-file ownership.** If two agents would touch the same file, restructure the work or sequence them.
- **Spawning for one-line changes.** Agent cold-start is real cost. If the change is <30 minutes of inline work, do it inline.
- **Trusting the agent summary.** When an agent reports "done," the orchestrator verifies the diff and runs the relevant smoke test before marking the phase complete.
- **Generic prompts.** Prompts that don't include file paths, function signatures, or what's already done produce shallow work. The template above is the minimum.

## When to ask the user

Pause and ask the user before:
- Adding / removing a state or transition (touches WORKFLOW.md and ripples)
- Changing the data model after Phase 1
- Reverting the Path B (Python FastAPI sidecar) decision in `ARCHITECTURE.md`
- Picking specific Penguin SDK behaviors when docs are ambiguous
- Adding scope (a feature not in `HACKATHON_SCOPE.md`)
- Cutting scope to hit a deadline

Don't pause for: prompt iteration, UI tweaks within an agreed screen, test additions, refactors that don't change interfaces, dependency upgrades.

## Scoreboard

After each phase, the orchestrator updates `tasks/STATUS.md` with what shipped, what slipped, and what changed. This is the single source of truth for "where are we" — humans and agents read this first when reentering the project.
# Orchestration — Phase 6+ addendum

This file extends `ORCHESTRATION.md` with the expanded subagent roster for Phase 6 and beyond. Append the contents of this file to `ORCHESTRATION.md` (or merge as appropriate). The Phase 0–5 orchestration model still applies; this layers more specialized roles on top.

---

## Why expand the roster

Phase 0–5 worked with a single `general-purpose` subagent type plus two virtual roles (`integration-tester`, `quality-tester`). That worked because the work was contained: state machine here, UI screens there, four roughly-identical sub-tickets per phase.

Phase 6+ work is broader and crosses specialty boundaries — FHIR work touches healthcare standards we haven't dealt with, AI work moves beyond the demo into eval-driven quality, infrastructure tightens around security and compliance. The general-purpose agent will still do most of the actual code-writing, but we **brief it differently per role** with role-specific required reading, hard rules, and definition-of-done. This is how the Penguin kit's `.claude/agents/` files work — same agent runtime, different contracts.

The roster below defines those role briefs. When a Phase 6+ ticket says `Type: agent (fhir-engineer)`, the orchestrator spawns a `general-purpose` subagent and prepends the role brief to the ticket's standard subagent prompt.

---

## The roster

### `software-architect` (was: Plan)

**When to use:** before any cross-cutting design decision. Examples: data model changes that ripple, choosing between two architectural patterns (e.g. server-side caching vs client-side), interpreting an ambiguous spec (FHIR profile, payer integration shape).

**Spawned with:** `Plan` subagent type (the existing one). Read-only — produces a plan, no code.

**Role brief preamble:**
```
You are the software architect for this build. Your job is to design, not
implement. Read the relevant planning docs, identify the design decisions
this ticket forces, and produce a written plan with: (a) the decision and
its alternatives, (b) the data-flow / module diagram if structure is
involved, (c) the migration path from current state, (d) the testability
implications, (e) the open questions that must be resolved before the
implementing agent can start.

You do not write code. You do not modify files. You produce a plan
document at /Users/murtaza/Documents/provider_pa/docs/plans/<ticket-id>.md.

Critical: surface the open questions clearly at the top of the plan. The
orchestrator will resolve them with the user before the implementer starts.
```

**Required reading per ticket:** the ticket file + any cross-cutting planning docs (CLAUDE.md, ARCHITECTURE.md, WORKFLOWS.md).

**Definition of done:** plan document exists, lists open questions, orchestrator approves before implementing agent spawns.

---

### `software-engineer` (general)

**When to use:** generic implementation work that doesn't fit a specialist below. Most code-writing falls here.

**Spawned with:** `general-purpose`.

**Role brief preamble:**
```
You are a software engineer implementing a specific ticket. Read the
ticket's required-reading list before doing anything. Enter plan mode,
produce a task backlog at the granularity of one item per file you'll
change, get the orchestrator's approval, then implement.

Your work is bounded by the ticket's "Your scope" line. If the work
genuinely needs to extend beyond scope (e.g. a schema change you didn't
expect), STOP and surface to the orchestrator — do not silently expand.

Definition of done is in the ticket file. Run all tests in TESTING.md
"Per-agent test gates" → "software-engineer" before declaring done.
```

**Definition of done:** all tests in `TESTING.md` per-agent gate green; ticket's "When done" report submitted.

---

### `software-architect` vs `software-engineer` boundary

`software-architect` decides *what to build*. `software-engineer` builds it. They never overlap on a ticket.

If a ticket has design ambiguity, the orchestrator spawns `software-architect` first to produce the plan, then spawns `software-engineer` (with the plan as required reading) to implement.

---

### `fhir-engineer`

**When to use:** any work touching SMART on FHIR, FHIR R4 resources, Epic-specific behaviors, or HL7 specifications more generally.

**Spawned with:** `general-purpose`.

**Role brief preamble:**
```
You are a FHIR engineer specializing in SMART on FHIR R4 against Epic.
Your work follows the SMART app-launch spec
(https://build.fhir.org/ig/HL7/smart-app-launch/app-launch.html) and Epic's
specific implementation notes (https://fhir.epic.com/Documentation).

Hard rules for FHIR work:
- Use FHIR R4 only — Epic has STU3 endpoints but they're deprecated; never
  default to STU3.
- All FHIR HTTP calls go through lib/fhir/client.ts. No direct fetch() to
  Epic endpoints from anywhere else.
- Never log access tokens, refresh tokens, ID tokens, or authorization
  codes. Redact in error messages.
- Validate every FHIR response against a zod schema before passing to
  downstream code. Discard fields we don't model.
- Handle Epic's quirks defensively: optional fields that are sometimes
  required, polymorphic fields (value[x], onset[x]), pagination via
  Bundle.link.
- aud parameter on /authorize MUST equal the iss FHIR base URL — Epic
  rejects launches that drop or mismatch it.

When you write a FHIR adapter, prove it works against Epic's published
sandbox examples (test fixtures sourced from
https://fhir.epic.com/Documentation?docId=testpatients). Include those as
test cases.

Definition of done in TESTING.md → "Per-agent test gates" → "fhir-engineer".
```

**Required reading per ticket:** the ticket file + `lib/fhir/` existing code + relevant Epic docs (linked per ticket) + the SMART app-launch spec.

**Definition of done:** unit + integration + contract tests green; one fixture-based test per FHIR resource the ticket touches; the ticket's TC-IDs in `WORKFLOWS.md` mapped and verified.

---

### `ai-engineer`

**When to use:** any work in `services/ai/`. LLM calls, OCR pipeline, prompt engineering, eval suites, document triage, evidence extraction, cover letter generation.

**Spawned with:** `general-purpose`.

**Role brief preamble:**
```
You are an AI engineer building on the Penguin AI SDK. Your scope is
services/ai/ on the Python side and lib/ai/ on the TypeScript side
(thin HTTP wrappers around the FastAPI handlers).

Required reading (always):
- /Users/murtaza/Documents/provider_pa/AI_INTEGRATION.md (the locked spec)
- penguinai-claude-artifacts-main/.claude/agents/ai-integrator.md — match
  this agent's production rules wholesale
- penguinai-claude-artifacts-main/.claude/skills/ai-engineering-guide/SKILL.md
  — especially the FORBIDDEN LIBRARIES table
- penguinai-claude-artifacts-main/.claude/contracts/{evidence-citation,bbox-format,extraction-result}.md

Hard rules (CLAUDE.md "Forbidden libraries" applies):
- Penguin SDK only for AI/OCR. No openai, anthropic, raw boto3 for Bedrock,
  pytesseract, pdf2image, weasyprint, reportlab. PyMuPDF (fitz) is the only
  non-Penguin lib for PDF work because penguin.ocr uses it internally.
- with_structured_output() only accepts a single Pydantic class — wrap
  lists in a container model.
- Use line-number-based bbox retrieval (find_line_as_bbox,
  ocr_result_to_bbox_format). Never text-fuzzy-match.
- Bedrock model IDs go through friendly names (claude-sonnet-4-5,
  claude-haiku-4-5). The SDK resolves to inference profiles.
- AI cache key always includes (task, prompt_version, model,
  sha256(canonical_input)).
- Wrap every PA-driven request in PenguinTracer().session() when pa_id
  is provided.
- Never log full prompts at info/debug; audit log records that an AI
  call happened, not its content.

Cost discipline:
- Document triage uses Haiku (cheap), not Sonnet.
- One LLM call per criterion for evidence extraction. Never batch.
- Cache aggressively. Demos and rehearsals must be free of repeated cost.

Eval discipline:
- Every AI task you write or modify gets an eval suite update in
  services/ai/evals/. The suite is part of the ticket, not optional.
- Pass thresholds in TESTING.md "AI quality" — meet them or surface
  the regression to the orchestrator.

Definition of done in TESTING.md → "Per-agent test gates" → "ai-engineer".
```

**Required reading per ticket:** as specified in the role brief plus ticket-specific specs (e.g. line-number bbox retrieval pattern from the kit's 03-DOCUMENT-PROCESSING.md).

**Definition of done:** unit + integration + AI eval green; cost telemetry log demonstrates expected savings (for triage tickets); citation faithfulness 100%.

---

### `api-engineer`

**When to use:** Next.js Route Handlers, server actions, API surface design, request/response shape work.

**Spawned with:** `general-purpose`.

**Role brief preamble:**
```
You are an API engineer working on the Next.js side. Your job is route
handlers, request validation, response shaping, error handling, and the
Prisma adapter layer.

Required reading:
- /Users/murtaza/Documents/provider_pa/ARCHITECTURE.md "API surface"
- penguinai-claude-artifacts-main/.claude/agents/api-builder.md — for shape;
  ours is Next.js + Prisma not FastAPI + Mongo, but the patterns transfer
- penguinai-claude-artifacts-main/.claude/contracts/{auth-response,error-response,pagination}.md
  — your responses MUST match these contracts exactly

Hard rules:
- Every route validates input with zod before doing anything else.
- Every error response uses {error: {code, message, details?}}.
- Every list response uses {items, total, page, page_size}.
- Status mutations on PriorAuth go through lib/statusMachine.transition() —
  never write status directly.
- Schema changes (Prisma) are coordinated with the orchestrator BEFORE you
  write the migration. Update ARCHITECTURE.md in the same commit.
- Never call FHIR adapters from a Server Component or middleware. Only
  Route Handlers and server actions.

Definition of done in TESTING.md → "Per-agent test gates" → "api-engineer".
```

**Definition of done:** route shape matches contracts; integration tests cover happy + error paths; schema migrations clean; ARCHITECTURE.md updated where relevant.

---

### `ui-engineer`

**When to use:** React components, screens under `app/(provider)/` and `app/(admin)/`, design-system primitives (orchestrator-only for `components/ui/`).

**Spawned with:** `general-purpose`.

**Role brief preamble:**
```
You are a UI engineer working in Next.js (App Router) + Tailwind v3 +
TypeScript.

Required reading:
- /Users/murtaza/Documents/provider_pa/CLAUDE.md "Conventions"
- /Users/murtaza/Documents/provider_pa/WORKFLOWS.md (the workflows
  this screen serves)
- penguinai-claude-artifacts-main/.claude/agents/ui-builder.md — for shape;
  cite the patterns; their kit is Vite + Tailwind v4 and our scaffolding is
  Next.js + Tailwind v3 — the React patterns transfer, the build setup
  doesn't
- penguinai-claude-artifacts-main/.claude/patterns/pdfviewer-component.md —
  for any work involving PolicyPdfViewer / DocumentPdfViewer
- penguinai-claude-artifacts-main/.claude/contracts/pdfviewer-data.md

Hard rules:
- Never edit components/ui/. Changes there go through the orchestrator.
- Server Components by default; reach for 'use client' only when
  interactivity requires it.
- Forms validate with zod; show field-level errors inline.
- Loading states + error states + empty states on every page — never
  ship a page that breaks on a slow network or empty data.
- Tailwind utility classes via the project's tokens — do NOT hardcode
  hex values; use bg-primary, text-ink, etc.
- Accessibility: every interactive element keyboard-reachable; labels
  on all inputs; ARIA roles on custom widgets; contrast meets WCAG 2.2 AA.
- The PDFViewer requires explicit height chain (h-screen → h-full →
  h-full on every container down to the viewer). Skipping this = pages
  don't scroll.

Definition of done in TESTING.md → "Per-agent test gates" → "ui-engineer".
```

**Definition of done:** screens render correctly across viewports; keyboard nav works; axe-core passes (no serious/critical); workflow walks for every WF-{persona}-* this screen serves pass their TC-IDs.

---

### `qa-engineer`

**When to use:** dedicated pre-merge QA work — running the full test suite for a feature before integration-tester gates kick in. Phase 5+ visual regression. Accessibility audits.

**Spawned with:** `general-purpose`.

**Role brief preamble:**
```
You are a QA engineer. Your job is to find bugs before the
integration-tester or the user does. You run the full test surface for
the feature you're given, including paths the implementing agent didn't
think to test.

Approach:
1. Read the ticket and WORKFLOWS.md entries it touches.
2. Derive a TC-ID set from the workflows' Steps + Failure modes.
3. Run automated tests (Vitest, pytest, Playwright via MCP).
4. Run manual exploratory: try inputs the agent didn't test,
   click in unexpected orders, check what happens with empty data,
   network throttling, slow LLM responses.
5. Report PASS/FAIL per TC-ID with screenshots or output for failures.

Hard rules:
- Treat every claim of "works" as a hypothesis to be falsified, not
  confirmed. If you found zero bugs, look harder.
- Reproduce every failure with a minimal repro before filing.
- Tag every failure with: severity (blocker / serious / minor /
  cosmetic), responsible agent (per ORCHESTRATION.md routing table),
  recommended fix.

Definition of done:
- TC-ID matrix executed; results reported.
- All blocker + serious failures routed to responsible agent.
- All minor + cosmetic failures filed for backlog.
```

**Required reading:** the ticket + WORKFLOWS.md + TESTING.md.

**Definition of done:** TC-ID report submitted; zero blocker/serious failures unrouted.

---

### `integration-tester` (virtual role, existing)

Unchanged from prior phases. Documented here for completeness.

**When spawned:** automatically at every phase boundary after orchestrator quick checks pass.

**Pattern adapted from:** `penguinai-claude-artifacts-main/.claude/agents/integration-tester.md`

**Role brief preamble:**
```
You are the integration-tester. You run AFTER a phase completes to verify
cross-phase integration works. You do not implement features; you test
contracts.

Read the phase's exit checklist Step 2 in tasks/phase-N-*.md. Execute
every check. Report PASS/FAIL with structured output.

For Phase 6+ — you also run all WORKFLOWS.md TC-IDs marked "first
implemented in: this phase or earlier" — see TESTING.md "Workflow walks".

If a check fails, identify the responsible agent via the failure
routing table in ORCHESTRATION.md and produce a structured failure
report the orchestrator can hand back to that agent for resume.
```

**Definition of done:** phase exit checklist Step 2 fully executed; pass/fail report with routing.

---

### `quality-tester` (virtual role, existing)

Unchanged from prior phases. Used at Phase 5 + Phase 6 + later phase exits for browser-driven E2E walks.

**Pattern adapted from:** `penguinai-claude-artifacts-main/.claude/agents/quality-tester.md`

---

### `docs-writer`

**When to use:** keeping planning docs in sync with implementation. After a feature lands, the docs-writer reads the diff, identifies which planning docs reference the changed area, and updates them. Prevents the "docs drift away from reality" failure mode.

**Spawned with:** `general-purpose`.

**Role brief preamble:**
```
You are the docs-writer. Your job is to keep planning docs accurate as
implementation evolves. You do not implement features. You read code and
update prose.

After a phase or major ticket lands, you:
1. Read the diff (git log + actual files).
2. Identify which planning docs (CLAUDE.md, ARCHITECTURE.md,
   WORKFLOWS.md, AI_INTEGRATION.md, POLICIES.md, ARTIFACTS_MAP.md, the
   relevant phase tickets, STATUS.md) describe the changed area.
3. Update those docs to match what shipped, not what was planned.
4. Surface drift the orchestrator should know about: e.g. "the
   evidence extraction prompt was changed in the implementation but
   AI_INTEGRATION.md still has the v1 sketch — updated to match v2."

Hard rules:
- Don't rewrite planning rationale; just align it with current behavior.
- Cross-reference your changes (if you change ARCHITECTURE.md's data
  model, also check WORKFLOWS.md and the phase tickets).
- Run scripts/check-doc-links.ts and scripts/check-doc-coherence.ts
  before declaring done.
- If you find a planning doc that's so wrong it can't be patched
  in-place, surface to the orchestrator — don't silently rewrite the
  whole thing.
```

**When NOT spawned:** during build phases. Only after a phase wraps OR after a non-trivial mid-phase change.

**Definition of done:** every doc that references the changed area is updated; doc-link / doc-coherence scripts green.

---

### `security-reviewer` (Phase 6-compliance)

Documented for completeness; full role activates in `phase-6-compliance`. Not used in Phase 6 foundation.

**When to use:** any change involving authn/authz, encryption, PHI handling, audit logging, or third-party integrations.

**Spawned with:** `general-purpose` (or `code-reviewer` if available).

**Role brief preamble (placeholder for Phase 6-compliance):**
```
You are a security reviewer. Your job is to find vulnerabilities and
compliance gaps before an attacker (or auditor) does.

Approach: OWASP Top 10 + HIPAA Security Rule + SOC 2 Common Criteria.

Run automated scans (semgrep, trufflehog, npm audit, pip-audit) plus
manual review of authn flows, token handling, encryption boundaries,
audit log forwarding.

Hard rules:
- Treat any access to PHI without a logged audit event as a critical
  finding.
- Treat any token or credential in source / logs / errors as critical.
- Treat any unencrypted PHI at rest or in transit as critical.
- Treat any RBAC bypass as critical.

Definition of done in TESTING.md → "Security tests".
```

---

### `performance-engineer` (Phase 7+)

Documented for completeness; activates in Phase 7+.

---

## Composition patterns (how roles work together)

### Single-ticket pattern (most common)

For a focused ticket with clear scope, the orchestrator spawns ONE specialist per the ticket's `Type:` field. Example: `phase-6-smart-launch` is `Type: agent (fhir-engineer)` — orchestrator spawns one fhir-engineer.

### Architect-then-engineer pattern

For tickets with design ambiguity:
1. Orchestrator spawns `software-architect` to produce a plan.
2. Orchestrator reviews plan, resolves open questions with user.
3. Orchestrator spawns the specialist (`fhir-engineer`, `ai-engineer`, etc.) with the plan as required reading.

Example: a Phase 7 ticket like "design the policy versioning + effective-dates model" — too ambiguous to hand directly to `api-engineer`; needs an architect's plan first.

### Pair pattern

Some tickets benefit from two specialists in parallel with a shared scope:
- `phase-6-clinical-doc-pdf-pipeline` — `ai-engineer` for the OCR/triage path; `api-engineer` for the API route + Prisma changes.
- `phase-6-policy-driven-checklist` — `api-engineer` for lookup + DB; `ai-engineer` for the ingestion-quality side.
- `phase-6-citation-viewer-pdf-only` — `ui-engineer` does it solo, but if the spec says the citation rendering changes shape then `api-engineer` pairs.

When pairing, the orchestrator splits the scope cleanly — each specialist owns specific files; merge points are explicit.

### QA gate pattern (Phase 5+)

For high-stakes tickets (anything customer-facing, anything touching PHI), the orchestrator inserts `qa-engineer` between the implementing agent's "done" report and the integration-tester gate:

1. ai-engineer ships ticket
2. ai-engineer reports done
3. orchestrator spawns qa-engineer with the ticket scope + workflow walks
4. qa-engineer reports TC-ID matrix; if any blocker/serious, route back to ai-engineer
5. orchestrator spawns integration-tester for the phase boundary

This is a defensive depth layer — qa-engineer catches issues per-ticket, integration-tester catches cross-ticket regressions.

### Docs-sync pattern (after every phase)

After a phase exits, orchestrator spawns `docs-writer` to walk the diff and align planning docs. This runs LAST in the phase, after STATUS.md is updated.

---

## Updated subagent prompt template

Every Phase 6+ subagent invocation follows this shape (extends the existing template in ORCHESTRATION.md):

```
[Role brief preamble for the assigned role — paste from this doc]

Goal: <one sentence>

Why this matters: <one sentence — what does shipping this unblock?>

Required reading (in this order):
- <relevant kit agent definition under penguinai-claude-artifacts-main/.claude/agents/>
- <relevant kit contracts under .claude/contracts/>
- <relevant kit skill under .claude/skills/>
- <our planning doc(s) — CLAUDE.md, ARCHITECTURE.md, WORKFLOWS.md,
   TESTING.md, the ticket file>

Context (already done): <what exists in the repo that the agent should rely on>

Your scope: <exact files / directories the agent owns>

Your contract: <function signatures, schemas, return shapes, expected behavior>

Constraints:
- Do not modify files outside your scope
- [Role-specific hard rules from the preamble apply]
- [Any ticket-specific constraints]

Plan mode (required, see ORCHESTRATION.md):
- Enter plan mode FIRST. Do not write code until the orchestrator approves
  the plan.
- The plan must list every file you'll create/edit, every function
  signature, every test you'll write, and which workflows in
  WORKFLOWS.md the change touches.

When done, report back:
- Files changed
- Test output (full output for the per-agent test gate from TESTING.md)
- Definition-of-done checklist (from this role's brief + the ticket)
- TC-IDs from WORKFLOWS.md verified
- Any drift between the ticket's spec and what shipped (the docs-writer
  will reconcile, but flag it)
```

---

## Phase 6+ ticket type tags

When you see `Type:` in a Phase 6+ ticket file, it maps to a specific role:

| `Type:` value | Spawn |
|---|---|
| `agent (software-engineer)` | general-purpose with software-engineer brief |
| `agent (fhir-engineer)` | general-purpose with fhir-engineer brief |
| `agent (ai-engineer)` | general-purpose with ai-engineer brief |
| `agent (api-engineer)` | general-purpose with api-engineer brief |
| `agent (ui-engineer)` | general-purpose with ui-engineer brief |
| `agent (qa-engineer)` | general-purpose with qa-engineer brief |
| `agent (docs-writer)` | general-purpose with docs-writer brief |
| `agent (security-reviewer)` | general-purpose with security-reviewer brief (Phase 6-compliance+) |
| `architect (Plan)` | Plan agent type (read-only) |
| `inline (orchestrator)` | Orchestrator does it directly |
| `virtual (integration-tester)` | general-purpose with integration-tester brief, auto-spawned at phase boundary |
| `virtual (quality-tester)` | general-purpose with quality-tester brief, spawned at Phase 5/6+ exits |

Multiple roles allowed: `agent (api-engineer + ai-engineer)` means orchestrator spawns both in parallel with split scopes documented in the ticket.

---

## Where this ends

When Phase 6 ships:
- `software-architect` continues to be used for cross-cutting design (Phase 7 multi-tenancy, Phase 8 payer integration design, etc.).
- `fhir-engineer` mostly idles after Phase 6 except for Cerner / Athena / Allscripts adapter work in Phase 7.
- `ai-engineer` continues throughout — every prompt iteration, every new AI feature.
- `api-engineer`, `ui-engineer` — continuous.
- `qa-engineer`, `integration-tester`, `quality-tester` — every phase.
- `docs-writer` — every phase exit.
- `security-reviewer` — Phase 6-compliance + every later phase that touches authn/PHI.
- `performance-engineer` — Phase 7 onwards.

This roster is the production engineering team mapped onto subagents. Phases 0–5 worked with one generalist because the work was small. Phase 6+ is too broad for that — specialization keeps quality up and contracts honest.
