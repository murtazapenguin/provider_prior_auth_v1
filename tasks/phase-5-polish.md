# Phase 5 — Polish + Demo Prep

Goal: the demo runs flawlessly twice in a row without orchestrator intervention. Tight timing, friendly error states, demo script written, fast-forward verified, canned-fallback verified, design tokens swapped if delivered.

This phase is hand-tuning. No subagents — every change is small and the orchestrator owns the whole loop.

Phase exit criteria are in `tasks/STATUS.md`.

---

## phase-5-design-tokens — Swap in real Penguin design tokens (if delivered)

- **Type:** inline
- **Goal:** replace the placeholder palette in `tailwind.config.ts` with the delivered Penguin design tokens.
- **Why it matters:** the only visible "this looks like Penguin" moment in the demo.
- **Owns:** `tailwind.config.ts`, `app/globals.css`, occasional spot-fixes in `components/ui/*`.
- **Depends on:** delivery of the design tokens (the open question in `CLAUDE.md`).
- **Contract:**
  - Token names from Phase 0 stay the same; only the values change.
  - Walk every screen visually after the swap; record any contrast issues and fix them in `components/ui/*` only.
  - If the tokens never arrive, ship the placeholder palette and note it in `tasks/STATUS.md`.
- **Verify:** orchestrator visits `/_dev/components` and every screen, confirms no broken styling.

---

## phase-5-fast-forward — Tune simulator timing

- **Type:** inline
- **Goal:** make the default timing fit a stakeholder demo.
- **Owns:** `lib/payer/simulator.ts` constants, the dev-only fast-forward UI affordance.
- **Contract:**
  - Default timing (no fast-forward): 30s + 90s = ~2 min per scenario, per `WORKFLOW.md`. Verified once, end-to-end.
  - Fast-forward: ~3s per transition. The dev-only AdminFastForward button (Phase 4) hits `/api/simulator/fast-forward` and the polling tracker re-renders within 2s.
  - A keyboard shortcut for fast-forward (`f`) — bonus, but worth it for live demos.
- **Verify:** orchestrator runs each scenario twice, once with default timing and once with fast-forward, with a stopwatch. Times match the `DEMO_SCENARIOS.md` "Demo time" column.

---

## phase-5-error-states — Friendly error states everywhere

- **Type:** inline
- **Goal:** every place an exception can bubble up gets a friendly UI state. No raw stack traces ever appear in the demo.
- **Owns:** route-level `error.tsx` files, `loading.tsx` files, toast notifications, the AI failure → "couldn't analyze — please enter manually" path.
- **Contract:**
  - `app/(provider)/error.tsx`, `app/(provider)/pa/[id]/error.tsx`, `app/(provider)/encounter/[id]/error.tsx`.
  - Toast on every API non-2xx with the human-readable error message.
  - When `AiInvalidResponseError` fires (not `AiUnreachableError` — that's caught by the canned fallback), show the criterion as `needs_info` with a clear "AI couldn't analyze this — please enter manually or upload supporting documentation" rationale.
  - 404 page on `/pa/:id` for an unknown id.
  - 500 page is friendly, not the Next.js default.
- **Verify:** orchestrator deliberately breaks each path (revoke API token, kill DB, send malformed payload to a route) and confirms the UI degrades gracefully.

---

## phase-5-canned-verification — Verify canned-response fallback in anger

- **Type:** inline
- **Goal:** prove the demo runs without the FastAPI service. Stop the AI service, run all three scenarios, confirm they complete with `source: 'canned'` events in the audit trail.
- **Owns:** a documented test procedure in `docs/runbook.md`.
- **Contract:**
  - Each scenario completes end-to-end with the FastAPI service stopped.
  - Audit trail clearly shows `source: 'canned'` on the affected events so the demo'er can flag this if asked.
  - The runbook lists the exact commands ("stop FastAPI: `kill $(pgrep uvicorn)`; start: `pnpm ai:dev`").
- **Verify:** orchestrator runs the procedure twice from a clean state.

---

## phase-5-demo-script — Write the demo script

- **Type:** inline
- **Goal:** a tight, narrated walkthrough for each of the three scenarios. Includes timing, what to say, what to point at, what to do if something goes off-script.
- **Owns:** `docs/demo-script.md`.
- **Contract:**
  - Three sections (Head CT, Knee MRI, Botox); each has setup, narration, click sequence, expected screen states, talking points.
  - A "things that can go wrong" appendix: dead AI service (use canned fallback automatically), simulator stuck (use fast-forward), wrong code derived (override with confidence), citation in wrong note (use override with rationale).
  - A "compressed demo" version: ~5 minutes total using fast-forward, for hallway demos.
  - A "full demo" version: ~10 minutes using default timing.
- **Verify:** orchestrator delivers the demo from the script (out loud, alone) twice without referring to the codebase.

---

## phase-5-rehearsal — Two clean end-to-end rehearsals (with quality-tester)

- **Type:** orchestrator + quality-tester subagent
- **Goal:** prove demo robustness via browser-driven scenario walks, then a human run-through.
- **Contract:**
  - **First, spawn quality-tester** (per `ORCHESTRATION.md` "Available agent types") with the test matrix derived from `DEMO_SCENARIOS.md`. Pattern adapted from `penguinai-claude-artifacts-main/.claude/agents/quality-tester.md`. quality-tester drives the live UI with Playwright MCP, executes every scripted click for all three scenarios, and reports PASS/FAIL per TC-ID. Required reading for the agent: the kit's `agents/quality-tester.md` plus our `DEMO_SCENARIOS.md` and `WORKFLOW.md`.
  - **Then, two consecutive human rehearsals** of all three scenarios with no orchestrator intervention beyond the script.
  - Any failure (quality-tester or human rehearsal) restarts the count from 0.
  - Record the second human rehearsal as a screen capture for backup.
- **Verify:** record date + time of two consecutive successes in `tasks/STATUS.md`. Append the quality-tester report (PASS/FAIL per TC-ID) to STATUS.md too.

---

## phase-5-runbook — Operations runbook

- **Type:** inline
- **Goal:** a one-page runbook for the demo'er — how to start the stack, reset between rehearsals, fix common issues.
- **Owns:** `docs/runbook.md`.
- **Contract:**
  - Section 1: cold start (`pnpm install`, `pnpm db:push`, `pnpm db:seed`, `pnpm ai:dev` in one terminal, `pnpm dev` in another, open `localhost:3000/demo`).
  - Section 2: reset between rehearsals (`pnpm db:seed --force` to wipe + reseed; clear cookie; back to `/demo`). **`--force` must preserve the `ai_call_cache` table** — wiping it would force every rehearsal to re-pay LLM cost. The `prisma/seed.ts` orchestrator's `deleteMany` calls explicitly skip `aiCallCache`. To nuke the cache deliberately (rare, e.g. when a prompt version changes), use `pnpm db:seed --force --reset-ai-cache`.
  - Section 3: troubleshooting (table of symptom → fix).
  - Section 4: backup plan (canned fallback, screen recording).
- **Verify:** a colleague (or the orchestrator with cleared memory) follows the runbook and gets to a working demo state inside 5 minutes.

---

## Phase 5 exit checklist

- [ ] Demo script rehearsed twice end-to-end without orchestrator intervention
- [ ] Canned-response fallback verified by killing the FastAPI service mid-run
- [ ] Fast-forward timing measured and matches `DEMO_SCENARIOS.md` "Demo time"
- [ ] Every exception path produces a friendly UI state (no raw stack traces)
- [ ] `docs/demo-script.md` and `docs/runbook.md` exist and are followed end-to-end
- [ ] Real design tokens swapped in (or placeholder explicitly accepted, noted in STATUS.md)
- [ ] Screen recording of one full rehearsal saved to `docs/recordings/`

When all seven are checked, the orchestrator updates `tasks/STATUS.md` to "demo-ready" and the build is done.
