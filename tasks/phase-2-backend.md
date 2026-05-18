# Phase 2 — Domain Backend

Goal: every API route the UI needs is real. Status machine, eligibility, policy lookup + match engine, payer simulator. AI calls remain stubbed (the Phase 0 stubs return canned responses for the three demo encounters); Phase 3 swaps in the real ones.

This phase parallelizes well — four agents own non-overlapping `lib/*` directories. The orchestrator wires API routes after the modules return their contracts.

Phase exit criteria are in `tasks/STATUS.md`.

---

## phase-2-statemachine — PA status state machine (Agent C)

- **Type:** agent (general-purpose)
- **Goal:** implement `transition()` covering every transition in `WORKFLOW.md`, plus the typed transition table.
- **Why it matters:** every status mutation routes through this. Hard rule from `CLAUDE.md`: no `pa.status = 'foo'` anywhere else.
- **Owns:** `lib/statusMachine/transitions.ts`, `lib/statusMachine/types.ts`, `__tests__/lib/statusMachine/`.
- **Depends on:** Phase 0.

### Subagent prompt

```
Goal: Implement the PA status state machine per /Users/murtaza/Documents/provider_pa/WORKFLOW.md.

Why this matters: Every route that changes PA status calls this. Getting it right makes every downstream feature simpler. Wrong transitions silently corrupt the audit trail.

Context (already done):
- Stub at /Users/murtaza/Documents/provider_pa/lib/statusMachine/transitions.ts.
- Audit log helper at /Users/murtaza/Documents/provider_pa/lib/audit/log.ts.
- WORKFLOW.md contains the complete state diagram and transition tables (the "State machine" Mermaid + the "State definitions" tables).
- CLAUDE.md "Status model (vocabulary lock)" lists the only valid status names — do not invent new ones.

Your scope: ONLY /Users/murtaza/Documents/provider_pa/lib/statusMachine/ and /Users/murtaza/Documents/provider_pa/__tests__/lib/statusMachine/.

Your contract:
- Export a discriminated union `PaTransitionEvent` with one variant per trigger (provider_submit, provider_park, provider_resume, provider_void, provider_cancel, provider_withdraw, patient_decline, criteria_all_met, sixty_day_timer, simulator_in_progress, simulator_rfi, simulator_approved, simulator_denied, simulator_partial_approval, simulator_partial_denial, rfi_responded). Add the `actor` field on every variant.
- Export `transition(currentStatus: PaStatus, event: PaTransitionEvent): { ok: true, next: PaStatus, sideEffects: SideEffect[] } | { ok: false, reason: string }`.
- `SideEffect[]` is a typed list of follow-on actions the caller should perform — e.g., `{ type: 'set_field', field: 'submittedAt', value: 'now' }`, `{ type: 'start_timer', kind: 'pending_submission_60d' }`, `{ type: 'audit_event', metadata: {...} }`.
- Export `TRANSITIONS` — the full table — keyed by (fromStatus, eventType) → next status or guard function.
- Pure function — no DB calls. Caller persists.
- Vitest spec covers (a) every positive transition in WORKFLOW.md and (b) at least 8 invalid transitions returning {ok: false, reason}.

Constraints:
- Do not write to the DB; the caller persists.
- Do not modify the Prisma schema.
- Do not invent new status names. If you think one is missing, stop and document it instead of adding it.
- Use snake_case for status values in code (per CLAUDE.md "Naming") — UI converts to display strings.

When done:
- Files changed
- Output of `pnpm vitest run lib/statusMachine` showing all green
- Any state I should add or rename based on what you found
```

- **Verify:** orchestrator runs the test suite; eyeballs the transition table against `WORKFLOW.md` row-by-row.

---

## phase-2-eligibility — Coverage / eligibility lookup (Agent D)

- **Type:** agent (general-purpose)
- **Goal:** `resolveCoverage(patientId, encounterDate)` returns the `(payer, plan, benefitCategory)` tuple from seeded `Coverage` rows.
- **Why it matters:** the policy lookup needs a coverage tuple to find the right `Policy`. Real implementations later swap in 270/271 EDI or FHIR Coverage; the interface is identical.
- **Owns:** `lib/eligibility/lookup.ts`, `lib/eligibility/types.ts`, `__tests__/lib/eligibility/`.
- **Depends on:** Phase 1 (so coverages are seeded).

### Subagent prompt

```
Goal: Implement coverage/eligibility lookup against seeded Coverage rows.

Why this matters: Policy lookup needs (payer, plan, benefit_category) — the same CPT can need PA on one plan and not another.

Context (already done):
- Coverage rows seeded by /Users/murtaza/Documents/provider_pa/prisma/seed/fixtures.ts. Each demo patient has one primary coverage.
- Prisma schema's Coverage model includes payerId, planName, benefitCategory, effectiveFrom/To, isPrimary.
- Phase 1 fixtures use deterministic Payer ids: "payer-cms" and "payer-uhc".

Your scope: ONLY /Users/murtaza/Documents/provider_pa/lib/eligibility/ and /Users/murtaza/Documents/provider_pa/__tests__/lib/eligibility/.

Your contract:
- Export `resolveCoverage(prisma, patientId, encounterDate): Promise<CoverageLookup>` where:
    type CoverageLookup = {
      payerId: string; payerShortCode: string;
      planName: string; benefitCategory: string;
      memberId: string; coverageId: string;
    }
- Pick the Coverage with isPrimary=true that's effective on encounterDate (effectiveFrom <= date AND (effectiveTo IS NULL OR effectiveTo > date)).
- Throw a typed `NoActiveCoverageError` if none found. Don't return null.
- Vitest covers (a) all three demo patients return the expected coverage, (b) inactive coverage is skipped, (c) NoActiveCoverageError thrown when none active.

Constraints:
- Do not import the real EHR adapter — coverage comes from our DB only (per HACKATHON_SCOPE.md).
- Don't modify the Prisma schema.

When done:
- Files changed
- Vitest output
- Three lines, one per demo patient, listing the resolved coverage
```

- **Verify:** orchestrator runs the test suite and visually confirms the coverage tuple for each scenario matches `DEMO_SCENARIOS.md`.

---

## phase-2-policy-match — Policy lookup + match engine (Agent E)

- **Type:** agent (general-purpose)
- **Goal:** given confirmed codes + coverage tuple, find the applicable `Policy` and run criteria evaluation against the chart corpus. AI calls go through the `lib/ai/evidenceExtraction.ts` stub (the stub returns canned responses keyed by encounter id + criterion id; the real impl lands in Phase 3).
- **Why it matters:** the heart of the system. Phase 4 UI is a thin wrapper around this.
- **Owns:** `lib/policies/lookup.ts`, `lib/policies/matchEngine.ts`, `lib/policies/types.ts`, `__tests__/lib/policies/`.
- **Depends on:** Phase 1 (policies seeded), Phase 0 (AI stubs exist).

### Subagent prompt

```
Goal: Implement policy lookup + the match engine that aggregates per-criterion AI results into a PA-level pass/fail.

Why this matters: This is the heart of the app. The UI checklist is a thin render over what this returns.

Context (already done):
- Three hand-curated demo policies seeded with deterministic ids.
- AI stub at /Users/murtaza/Documents/provider_pa/lib/ai/evidenceExtraction.ts returns a canned per-criterion result for known (encounterId, criterionId) pairs. (You'll add the canned mappings; Phase 3 replaces the implementation but keeps your contract.)
- POLICIES.md "The matching engine" describes the algorithm in detail (steps 1-5).
- AI_INTEGRATION.md task 2 defines the per-criterion CriterionResult shape.

Your scope: ONLY /Users/murtaza/Documents/provider_pa/lib/policies/ and /Users/murtaza/Documents/provider_pa/__tests__/lib/policies/, plus the canned-response map inside lib/ai/evidenceExtraction.ts.

Your contract:
- Export `findApplicablePolicies(prisma, args): Promise<Policy[]>` — args = { codeType, code, coverage, posCode? }. Most-specific match wins; multiple may apply, return all.
- Export `runMatchEngine(prisma, priorAuthId): Promise<MatchResult>` where MatchResult = { policyId, criteriaResults: Array<CriterionResult>, overallStatus: 'all_passed'|'has_failures'|'has_needs_info', missingItems: string[] }.
- runMatchEngine: load chart corpus (notes + attachment text), iterate criteria, call lib/ai/evidenceExtraction.ts in parallel (Promise.all, capped at 12 concurrency via p-limit), persist CriterionResult + Citation rows, write a PaEvent with type='criterion_evaluated' (one per criterion).
- "Most restrictive wins on missing criteria; most permissive wins on PA-required determination" per POLICIES.md.
- Vitest covers all three demo scenarios end-to-end at the matchEngine level using the canned AI responses (head_ct → all_passed, knee_mri → has_needs_info on conservative therapy, botox → has_needs_info on amitriptyline duration).

Constraints:
- Do not call the Penguin SDK directly. Always go through lib/ai/.
- Do not write to PriorAuth.status — that's the state machine's job. Return the overallStatus and let the route handler call statusMachine.
- Audit-log every criterion evaluation.

When done:
- Files changed
- Vitest output for all three scenarios
- The canned response map you added to lib/ai/evidenceExtraction.ts (the orchestrator will review it)
```

- **Verify:** orchestrator runs the test suite. Each demo scenario's `MatchResult` matches what `DEMO_SCENARIOS.md` predicts.

---

## phase-2-payer-simulator — Payer adapter + simulator (Agent F)

- **Type:** agent (general-purpose)
- **Goal:** mock submission adapter + timer-driven status walker. Submit returns a tracking id; the simulator advances state on a timer per scenario script.
- **Why it matters:** the post-submission tracker UI watches this. The fast-forward admin endpoint is the demo's escape hatch.
- **Owns:** `lib/payer/PayerAdapter.ts` (interface), `lib/payer/mockPayer.ts` (impl), `lib/payer/simulator.ts`, `lib/payer/types.ts`, `__tests__/lib/payer/`.
- **Depends on:** Phase 0 (state machine stubs exist), Phase 1 (PriorAuth table exists).

### Subagent prompt

```
Goal: Build the mock payer submission adapter + the timer-driven adjudication simulator.

Why this matters: Post-submission UX (Pending → In Progress → outcome) depends on this. The fast-forward endpoint is what makes live demos feel snappy.

Context (already done):
- Status machine stub at /Users/murtaza/Documents/provider_pa/lib/statusMachine/transitions.ts (sibling agent is implementing it — your code calls it via the same interface).
- WORKFLOW.md "Status simulator behavior" defines default delays (Pending→In Progress 30s, In Progress→terminal 90s) and per-scenario outcome scripts (Head CT → Approved; Knee MRI → Approved; Botox → RFI then Approved).
- ARCHITECTURE.md "Status simulator" describes the cron-driven walker.
- HACKATHON_SCOPE.md confirms no real X12/FHIR — this is HTTP to an in-process simulator.

Your scope: ONLY /Users/murtaza/Documents/provider_pa/lib/payer/ and /Users/murtaza/Documents/provider_pa/__tests__/lib/payer/.

Your contract:
- Export `interface PayerAdapter { submit, cancel, fetchStatus }` per ARCHITECTURE.md.
- Implement `MockPayerAdapter` — submit() returns a tracking id and registers the PA in an in-memory simulator queue keyed by trackingId. Stash the queue in a module-level Map; the simulator drains it.
- `runSimulatorTick(prisma, now): Promise<TickResult>` — pure function called by Vercel Cron. Walks the queue, transitions any PA whose nextTransitionAt <= now via the state machine, persists, audit-logs.
- `fastForward(prisma): Promise<TickResult>` — advances every in-flight PA to its next state immediately, regardless of timer. Used by the demo admin endpoint.
- Per-scenario script: tag each PA at submit time with `scenarioTag` (read from the encounter metadata) — head_ct → Approved, knee_mri → Approved, botox → RFI then Approved on rfi_response.
- Vitest covers (a) submit returns a tracking id, (b) tick advances Pending→In Progress at 30s, (c) tick advances In Progress→Approved at 120s for Head CT, (d) Botox tick advances In Progress→RFI at 120s, then on rfi_response advances RFI→Approved on the next tick, (e) fastForward jumps every in-flight PA one step.

Constraints:
- All status transitions go through statusMachine.transition() — never write status directly.
- Audit-log every transition.
- The queue must survive process restarts during the demo. Persist the next-transition-at to the DB on PriorAuth (add a `simulatorNextTransitionAt` field to your contract — coordinate the schema change with the orchestrator before adding it).

When done:
- Files changed
- Vitest output
- Note for the orchestrator: did you need to add a column to PriorAuth? If so, what?
```

- **Verify:** orchestrator runs the test suite. Then runs a Vercel-cron-style local script against the demo Head CT PA and watches it transition.

---

## phase-2-api-routes — Wire the API routes (orchestrator)

- **Type:** inline
- **Goal:** implement every route from `ARCHITECTURE.md` "API surface" as a thin wrapper over the `lib/*` modules.
- **Why it matters:** the UI calls these. Until they exist, Phase 4 cannot integration-test.
- **Owns:** `app/api/encounters/route.ts`, `app/api/pa/route.ts`, `app/api/pa/[id]/route.ts`, `app/api/pa/[id]/codes/route.ts`, `app/api/pa/[id]/recheck/route.ts`, `app/api/pa/[id]/upload/route.ts`, `app/api/pa/[id]/submit/route.ts`, `app/api/pa/[id]/withdraw/route.ts`, `app/api/pa/[id]/void/route.ts`, `app/api/pa/[id]/cancel/route.ts`, `app/api/pa/[id]/park/route.ts`, `app/api/pa/[id]/resume/route.ts`, `app/api/simulator/webhook/route.ts`, `app/api/simulator/fast-forward/route.ts`, `app/api/queue/route.ts`, `app/api/cron/sweep/route.ts` (60-day Pending Submission sweep + simulator tick).
- **Depends on:** all four agent tickets above.
- **Contract:**
  - Each route parses input with zod, calls into `lib/`, persists with Prisma, returns JSON.
  - Mutations always go through `statusMachine.transition()`.
  - The cron route is auth-gated by a header `Authorization: Bearer ${CRON_SECRET}`.
  - Provider auth: hardcoded session cookie that reads as a single seeded provider per `HACKATHON_SCOPE.md`.
  - 60-day sweep: select PriorAuth where status='pending_submission' and pendingSubmissionExpiresAt <= now, call `transition(..., {type: 'sixty_day_timer'})`.
- **Verify:** orchestrator writes a script `scripts/smoke-scenario-1.ts` that POSTs through every API route for the Head CT scenario end-to-end. With AI stubbed and the simulator on a 1-second tick, the PA goes from new → Approved in <10 seconds.

---

## Phase 2 exit checklist

**Step 1 — Orchestrator quick checks:**
- [ ] `pnpm test` reports green across all four `lib/*` agent suites
- [ ] `scripts/smoke-scenario-1.ts` runs Head CT end-to-end at the API level (with stubbed AI) and lands on Approved
- [ ] Every PA status mutation in the codebase routes through `statusMachine.transition()` (grep for `pa.status =` should return 0 hits)
- [ ] Every status change writes a `PaEvent` row (verified by spot-checking the audit log in Prisma Studio after the smoke run)

**Step 2 — Integration-tester gate (auto-spawned per `ORCHESTRATION.md` "Integration gates"):**
- [ ] integration-tester runs the three demo scenarios at the API level (with stubbed AI) and reports PASS for all three
- [ ] integration-tester verifies API response shapes match the canonical `error-response` and `pagination` contracts from `penguinai-claude-artifacts-main/.claude/contracts/`

When both steps pass, the orchestrator updates `tasks/STATUS.md` and Phase 3 begins automatically.
