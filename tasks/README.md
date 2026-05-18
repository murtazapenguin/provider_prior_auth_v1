# Build Tasks

This folder is the concrete, ordered build plan. Each phase is a markdown file. Each phase contains discrete tickets — read the orchestrator briefing in `ORCHESTRATION.md` first to know which tickets parallelize and which are sequential.

## Files

- `STATUS.md` — current phase, what's done, what's blocked. Updated by the orchestrator at phase boundaries.
- `phase-0-foundation.md` — scaffolding, schema, SDK boundary stub
- `phase-1-data.md` — reference code data + demo fixtures + hand-curated policies
- `phase-2-backend.md` — status machine, eligibility, policy match engine, payer simulator, API routes
- `phase-3-ai.md` — real Penguin SDK calls for code derivation and evidence extraction
- `phase-4-ui.md` — provider screens, queue dashboard, scenario launcher
- `phase-5-polish.md` — demo script, fast-forward tuning, canned-fallback verification, error states

## How to use these

1. Open the current phase file (per `STATUS.md`).
2. Find the next un-claimed ticket.
3. If it's marked "agent" — spin up a subagent with the ticket's prompt, scope, and contract (template in `ORCHESTRATION.md`).
4. If it's marked "inline" — execute it directly.
5. Mark the ticket complete in `STATUS.md` after verification.
6. Move to next.

## Ticket structure

Each ticket has the same shape:
- **ID** — phase-NN-short-name
- **Type** — inline | agent
- **Goal** — one sentence
- **Why it matters** — one sentence
- **Owns** — directories / files this ticket may modify
- **Depends on** — earlier tickets that must complete first
- **Contract** — what shipping looks like (function signatures, expected behavior, smoke test)
- **Verify** — concrete check the orchestrator runs to confirm shipped
