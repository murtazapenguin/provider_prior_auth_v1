# Provider Prior Authorization (PA) App

An AI-assisted prior authorization workflow tool for the **provider side** of healthcare. Pulls clinical context from EHR / scribe notes, identifies relevant procedure or drug codes, checks whether prior auth is required against payer-specific policies, extracts supporting evidence from clinical documentation, and walks the provider through a final review before submission.

Built for the hackathon as a standalone Next.js web application with mocked EHR ingestion and a simulated payer adjudication loop. The architecture is designed so that real adapters (EHR via SMART on FHIR, payer via X12 278 / Da Vinci PAS) can be swapped in later without rewriting the core domain.

## Why this exists

Prior auth is the single largest source of administrative burden in U.S. healthcare. A typical PA cycle involves a clinician (or staff) (1) figuring out whether PA is even required for the order they just placed, (2) gathering the right clinical evidence, (3) mapping that evidence to payer-specific criteria, (4) submitting and tracking, often via fax or portal, (5) responding to RFIs. Most of steps 1–3 are deterministic given the right data and policy text — and that's exactly what this app automates.

## Hackathon vision in one paragraph

A provider places an order. Within seconds, our app tells them whether prior auth is needed, and if so, exactly which clinical criteria the payer requires, which of those criteria are already supported by evidence in the chart (with citations), and which still need attention. The provider can upload a missing document, hit submit, and watch the PA flow through a simulated payer in real time. Everything is auditable and every match is explainable.

## Three demo scenarios

We're building the system around three concrete cases that exercise different parts of the workflow:

1. **Head CT — PCP order.** Imaging, payer-policy-driven criteria. Tests the "no PA required" / "PA required, all criteria met" happy path.
2. **Knee MRI — Orthopedic order.** Medicare LCD territory; usually requires documented conservative therapy. Tests the missing-evidence loop: provider uploads conservative-therapy documentation, system rechecks, then approves for submission.
3. **Botox for Migraines — Neurology order.** J-code (J0585), strict criteria (chronic migraine ≥15 headache days/month for 3 months, failed ≥2 preventives, etc.). Hardest case — best showcase for evidence extraction and citation.

Each scenario is fully scripted with seed patient data, encounter notes, expected codes, and expected outcomes. See `DEMO_SCENARIOS.md`.

## Doc map

Read in roughly this order to onboard:

- `HACKATHON_SCOPE.md` — what is and isn't being built this week, mocks vs real
- `WORKFLOW.md` — end-to-end flow + state machine for PA statuses
- `ARCHITECTURE.md` — tech stack, system layout, complete data model
- `POLICIES.md` — how payer policies are represented and matched against clinical evidence
- `AI_INTEGRATION.md` — how Penguin AI SDK is used (code derivation, evidence extraction, citation)
- `DEMO_SCENARIOS.md` — full walkthrough of the three demo cases
- `ORCHESTRATION.md` — how to split build work across subagents
- `CLAUDE.md` — project memory and conventions for any AI agent working in this repo
- `tasks/` — discrete, ordered build tickets

## Tech stack at a glance

- **Frontend + provider API:** Next.js (App Router) + TypeScript + Tailwind
- **Database:** Postgres + Prisma
- **AI:** Penguin AI SDK (Python) running as a FastAPI sidecar; Next.js calls it over HTTP. See `ARCHITECTURE.md`.
- **Hosting:** Vercel (frontend), Vercel Postgres or Supabase for DB
- **Mocks:** EHR ingestion, payer submission, payer adjudication transitions

## Run locally (planned)

To be filled in once scaffolding lands. The expected shape:

```bash
pnpm install
cp .env.example .env.local   # set DATABASE_URL and PENGUIN_API_KEY
pnpm db:push                 # apply Prisma schema
pnpm db:seed                 # load reference data (ICD-10, CPT, HCPCS) + policies + demo patients
pnpm dev
```

## Status

Pre-build. Planning docs in progress. See task tickets in `tasks/` for the implementation sequence.
