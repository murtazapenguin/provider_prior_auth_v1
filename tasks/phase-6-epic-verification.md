# Phase 6 — Epic Sandbox Verification (deferred follow-up to Phase 6 foundation)

> **Status:** placeholder. Created 2026-05-08 during Phase 6 foundation kickoff. The user chose to **build the app first, register the Epic app afterward** — so all Phase 6 foundation tickets test against fixtures + a mock FHIR adapter (`FHIR_MODE=mock`). The verification work that requires a registered Epic sandbox client lands here.

## Why this is separate

`phase-6-foundation` (the main Phase 6 ticket file) was originally written to require Epic app registration before any agent work started. The user inverted the order to keep the build moving while registration runs in parallel (Epic dev portal sign-up, scope grants, redirect URI confirmation, public-client + PKCE registration). This ticket fires after registration completes and exercises everything against the live sandbox.

## Prerequisites (user does these out of session)

- App registered at <https://fhir.epic.com> developer portal.
  - Application name: `Provider PA — sandbox`.
  - Application audience: **Clinicians or Administrative Users**.
  - Incoming API: **EHR Launch (provider)** + **Standalone Launch (provider)**.
  - SMART version: **R4** (not STU3).
  - Public client + PKCE.
  - Scope grants: `launch openid fhirUser profile offline_access patient/{Patient,Encounter,Coverage,Practitioner,ServiceRequest,DocumentReference,Binary,Condition,Observation}.read user/Practitioner.read`.
- `docs/epic-integration.md` written: client_id, redirect URIs, sandbox FHIR endpoint, sandbox auth endpoints, test patient ids (Camila Lopez, Derrick Lin, Warren McGinnis, etc.), launch URL `https://fhir.epic.com/test`.
- `services/ai/.env` and root `.env.local` populated:
  - `EPIC_SANDBOX_CLIENT_ID`
  - `EPIC_SANDBOX_REDIRECT_URI`
  - `EPIC_SANDBOX_FHIR_BASE`
  - `EPIC_SANDBOX_AUTH_BASE`
  - `APP_TOKEN_ENCRYPTION_KEY` (already set during Phase 6 foundation; verify present)
  - `FHIR_MODE=real` (flip from `mock`)

## Scope (this ticket's work)

1. **Real Epic launch** from `https://fhir.epic.com/test` for each registered launch type:
   - EHR launch (Hyperspace-style) → `/launch?iss=&launch=` → callback → `/queue` with patient context preloaded.
   - Standalone launch → `/launch?iss=` → patient picker → callback → `/queue`.
   - Verify token-shape sample (with values redacted) confirms expected aud, scope, sub, fhirUser claims.
2. **Real Epic FHIR API calls** end-to-end:
   - `Patient`, `Encounter`, `Coverage`, `Practitioner`, `ServiceRequest`, `DocumentReference`, `Binary`, `Condition`, `Observation` reads against sandbox patients.
   - `syncPatientFromFhir()` populates Prisma cache rows correctly for each demo-equivalent sandbox patient.
   - Token-refresh-on-expiry verified by waiting past `expires_in` and triggering a request.
3. **Re-run integration-tester gate** with `FHIR_MODE=real`. Cost-reduction telemetry for document triage on a "noisy" sandbox patient (50+ DocumentReferences if available; otherwise inject Synthea-generated chart).
4. **Re-run quality-tester gate** with `FHIR_MODE=real` against Synthea-injected synthetic patients in Epic sandbox. Walk every WORKFLOWS.md `WF-PROV-*` and `WF-X-*` TC.
5. **Synthea injection** (if needed): generate a Synthea patient with chronic-migraine + Botox failed therapy chart, push to Epic sandbox via the bulk-load endpoint or admin UI.
6. **Negative-path coverage**: `WF-E-token-revocation`, `WF-E-fhir-rate-limit`, `WF-E-ai-service-down`, `WF-E-bbox-render-fail`, `WF-E-malformed-citation`, `WF-E-pa-stuck-state` — exercise each against the live sandbox.
7. **STATUS.md update** when this ticket exits: Phase 6 row → `✅ complete (Epic-sandbox verified)` and add a "What is done" bullet.

## Outputs

- Screen recording of an Epic-test-harness EHR launch landing on `/queue` with patient context.
- Token-shape sample (redacted) demonstrating scope, aud, sub, fhirUser claims.
- integration-tester report with `FHIR_MODE=real` PASS.
- quality-tester report with `FHIR_MODE=real` PASS for all WF-PROV-* and WF-X-*.
- Cost-telemetry log for document triage on a noisy patient.

## Roles

- `fhir-engineer` for any sandbox-specific bug surfacing during real-Epic runs.
- `qa-engineer` for derived TC-ID coverage on the negative-path workflows.
- `integration-tester` virtual role for Step 2 gate.
- `quality-tester` virtual role for Step 3 gate.
- Orchestrator inline for STATUS.md update + pen-test handoff prep.

## What this ticket deliberately does NOT include

- HIPAA / encryption / SIEM / RBAC work — `phase-6-compliance`.
- Cerner / Athena / Allscripts adapters — Phase 7+.
- Production Epic tenant — explicitly out (sandbox only).
- Real X12 / Da Vinci PAS — Phase 8.
