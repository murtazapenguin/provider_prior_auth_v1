# Phase 6 — Production Foundation (Epic)

The transition from "demo working at the API + UI level" to "real provider, real Epic, real PHI." This phase replaces every mocked interface with the production interface for our committed launch EHR (**Epic**). When this phase exits, a real provider can launch the app from inside Epic, see their real patient's data, run the AI evidence check against real clinical documents, generate a real submission packet, and submit a real PA — all without any of the demo's hardcoded sessions, JSON fixtures, or hand-curated policies.

This phase is **months of work for a small team**, not weeks. SMART on FHIR alone is 4–8 weeks done well, and the FHIR adapter layer is another 3–4. We split it into discrete tickets so it can be parallelized.

> **HIPAA / compliance hardening (BAAs, encryption verification, SIEM forwarding, RBAC enforcement, retention policy) is intentionally out of this phase** and lives in `tasks/phase-6-compliance.md` as a follow-on. Phase 6 ships against Epic's sandbox (`fhir.epic.com`), which is fully synthetic data — no real PHI lands until compliance hardens. **Do not point the app at a real Epic production tenant before Phase 6-compliance closes.**

---

## Phase exit criteria (recap)

This phase is complete when:

1. **EHR launch from Epic Hyperspace/Hyperdrive works** end-to-end against Epic's sandbox: provider clicks the app inside Epic, lands on our PA detail page with the right patient/encounter context preloaded.
2. **Standalone launch works** for off-Epic access (provider opens our URL, picks patient context via Epic's patient picker).
3. **Every domain object that was previously seeded is now FHIR-driven** — `Patient`, `Encounter`, `Coverage`, `Practitioner`, `ServiceRequest`, `DocumentReference`, `Condition`, `Observation` all flow from FHIR R4 reads.
4. **Clinical documents render as PDFs** in `PolicyPdfViewer` — no markdown panel left anywhere. Citations on clinical notes show bbox highlights via OCR, identical to the existing policy-PDF flow.
5. **Document triage runs before evidence extraction.** Haiku scores each `DocumentReference` for relevance against the criteria checklist; only the top-K relevant docs go through expensive evidence extraction. Cost reduction tracked and reported.
6. **Policy-driven checklist** — `PolicyCriterion` rows for active production payers come from the AI ingestion pipeline (not hand-curation). Demo scenarios continue working but the production code path no longer reads hand-curated rows.
7. **The mocked submission simulator stays** for now — real payer integration is **Phase 8** (X12 278 / Da Vinci PAS). Phase 6 keeps the mock to focus on Epic + FHIR + AI changes.
8. Integration-tester gate passes: a synthetic Synthea patient injected into Epic's sandbox makes it through the full flow with real FHIR reads.

---

## Architectural shifts this phase makes

Treat these as design constraints all subagents must respect:

- **Auth replaces mock session.** The hardcoded session cookie from Phase 4 is removed. Every authenticated request now carries an Epic-issued OAuth 2.0 access token. `getCurrentProvider()` reads the token's `fhirUser` claim and resolves to a `Practitioner` resource.
- **`Patient` / `Encounter` / `Coverage` are no longer Prisma-owned source-of-truth tables** — they become caches of FHIR resources. We retain them for join performance, but they're populated lazily from FHIR reads with TTL-based invalidation (default: 1 hour for demographics, 5 minutes for in-flight encounters).
- **`PriorAuth` and everything below it (codes, criteria results, citations, attachments, events) stay Prisma-owned.** These are our domain — no FHIR equivalent.
- **`DocumentReference` resources back the clinical-note pipeline.** When a PA is created we fetch all `DocumentReference` for the patient (filtered by encounter + recency), triage by relevance, OCR the relevant ones, and the citation flow runs against the resulting bboxes. Patient-uploaded files via `phase-4-pa-detail` continue to work — they get persisted as a `DocumentReference` in our cache table with `kind="provider_upload"`.
- **The `ClinicalNote` domain model is renamed to `CachedDocumentReference` and gains FHIR fields** (`fhirResourceId`, `fhirVersionId`, `lastFetchedAt`, `pdfUrl`, `pageImages Json?`). Migration: existing demo `ClinicalNote` rows map 1:1 with synthesized FHIR ids.
- **Submission packet generation gets richer.** Page 3+ of the packet now appends rendered PDFs of the actual `DocumentReference` resources (not the synthetic text we used in the demo). The packet still uses PyMuPDF for assembly; the only change is the content source.

---

## Sequencing

Phase 6 splits into a **sequential foundation** (first three tickets — block everything else) and **parallel build streams** that can run concurrently after foundation is in.

```
1. phase-6-epic-app-registration         (orchestrator inline)
2. phase-6-smart-launch                  (fhir-engineer)
3. phase-6-fhir-resource-adapters        (fhir-engineer)
   ↑ sequential — each builds on the previous

After foundation ships, parallelize:
4. phase-6-fhir-domain-mapping           (api-engineer)
5. phase-6-clinical-doc-pdf-pipeline     (ai-engineer)
6. phase-6-document-triage               (ai-engineer)
7. phase-6-policy-driven-checklist       (api-engineer + ai-engineer)
8. phase-6-submission-packet-real-docs   (ai-engineer + ui-engineer)
9. phase-6-citation-viewer-pdf-only      (ui-engineer)
10. phase-6-launch-routing-ui            (ui-engineer)

Then:
11. phase-6-integration                  (orchestrator inline)
12. phase-6-quality-tester               (quality-tester subagent)
```

---

## Tickets

### phase-6-epic-app-registration

- **Type:** orchestrator inline (you, the human + your team)
- **Goal:** register the app in Epic's developer portal so we have a `client_id`, sandbox FHIR endpoint, and known redirect URIs. Without this, no SMART launch can be tested.
- **Why it matters:** every later ticket depends on having sandbox creds.
- **Owns:** `services/ai/.env.example` and `.env.local` get new vars; `docs/epic-integration.md` (new — captures sandbox URL, client_id, scopes, redirect URIs).
- **Steps:**
  1. Sign up at <https://fhir.epic.com> developer portal (this is Epic's open sandbox; production access is via App Orchard / Vendor Services and is its own multi-month process — defer).
  2. Register the app:
     - Application name: `Provider PA — sandbox`
     - Application audience: **Clinicians or Administrative Users** (not Patients)
     - Incoming API: **EHR Launch (provider)** + **Standalone Launch (provider)** + **Backend Services** (we use the first two now; backend services later for cron-driven policy refresh)
     - Outgoing API base: a public dev URL (use ngrok / Cloudflare tunnel against your local Next.js)
     - Redirect URI: `https://<your-tunnel>/api/auth/smart/callback`
     - SMART version: **R4** (Epic supports R4 GA since 2023; do NOT use STU3)
  3. From the FHIR resources tab, request access to: `Patient.Read, Patient.Search, Encounter.Read, Encounter.Search, Coverage.Read, Coverage.Search, Practitioner.Read, ServiceRequest.Read, ServiceRequest.Search, DocumentReference.Read, DocumentReference.Search, Binary.Read, Condition.Read, Condition.Search, Observation.Read, Observation.Search` — all R4.
  4. Note the `client_id`. Note the sandbox FHIR endpoint (`https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4/`). Note the OAuth endpoints (`/oauth2/authorize`, `/oauth2/token`, `/oauth2/.well-known/smart-configuration`). Do NOT have a client_secret for public client; if you registered confidential, save the secret in 1Password — never commit.
  5. Add to `services/ai/.env.example` (commented):
     ```
     EPIC_SANDBOX_FHIR_BASE=https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4
     EPIC_SANDBOX_CLIENT_ID=
     EPIC_SANDBOX_REDIRECT_URI=
     EPIC_SANDBOX_AUTH_BASE=https://fhir.epic.com/interconnect-fhir-oauth/oauth2
     ```
  6. Write `docs/epic-integration.md` with: registration summary, scope list, how to launch from the Epic test harness (`https://fhir.epic.com/test`), test patient ids in the sandbox (Camila Lopez, Derrick Lin, etc. — Epic publishes a list).
- **Verify:** the orchestrator (a) can log into the Epic dev portal and see the app, (b) can launch the app from `https://fhir.epic.com/test` and reach the redirect URI (it'll 404 the callback for now — that's fine, ticket 2 builds the callback). (c) `docs/epic-integration.md` exists and lists the test patient ids.

> **Public vs confidential client.** Epic supports both. For Phase 6 use a **public client with PKCE** — it's simpler and Epic supports it for both EHR launch and standalone launch. Move to confidential client in Phase 7 when we add per-org configuration.

---

### phase-6-smart-launch

- **Type:** agent (`fhir-engineer`)
- **Goal:** implement the SMART app-launch flow against Epic — both EHR launch (provider clicks from Hyperspace) and standalone launch (provider opens our URL, picks patient via Epic's picker).
- **Why it matters:** unlocks every later ticket. Nothing FHIR-driven works without a valid access token.
- **Owns:** `lib/smart/` (new module: discovery, authorize, callback, token storage, refresh), `app/api/auth/smart/{authorize,callback,refresh}/route.ts`, `app/launch/page.tsx` (entry point Epic redirects into), `middleware.ts` (token-aware route guard replaces the mock session middleware from Phase 4).

#### Subagent prompt

```
Goal: Build the SMART on FHIR app-launch flow for Epic. Both EHR launch and standalone launch must work end-to-end against Epic's sandbox (fhir.epic.com).

Why this matters: Foundation. Every later Phase 6 ticket reads FHIR data using the access token this flow produces.

Required reading:
- https://build.fhir.org/ig/HL7/smart-app-launch/app-launch.html (the spec)
- https://fhir.epic.com/Documentation?docId=oauth2 (Epic-specific OAuth notes)
- https://fhir.epic.com/Documentation?docId=oauth2_launch (Epic-specific launch sequence)
- /Users/murtaza/Documents/provider_pa/CLAUDE.md "Forbidden libraries" — applies here too
- /Users/murtaza/Documents/provider_pa/ORCHESTRATION.md "Plan mode protocol"

Context (already done):
- App registered with Epic sandbox; client_id, redirect_uri, scopes documented in docs/epic-integration.md.
- Mock session middleware from Phase 4 lives at middleware.ts. You're REPLACING it (the mock provider session goes away).

Your scope:
- /Users/murtaza/Documents/provider_pa/lib/smart/discovery.ts — fetch /.well-known/smart-configuration, cache per-iss for 24h
- /Users/murtaza/Documents/provider_pa/lib/smart/pkce.ts — generate PKCE verifier/challenge per launch
- /Users/murtaza/Documents/provider_pa/lib/smart/state.ts — state token for CSRF; encrypted server-side store
- /Users/murtaza/Documents/provider_pa/lib/smart/session.ts — server-side SMART session storage; refresh-on-demand; getCurrentSession() helper
- /Users/murtaza/Documents/provider_pa/lib/smart/types.ts — TS types for SMART config, token response, launch context
- /Users/murtaza/Documents/provider_pa/app/launch/page.tsx — Epic redirects here with ?iss=&launch=; this page kicks off the OAuth dance
- /Users/murtaza/Documents/provider_pa/app/api/auth/smart/authorize/route.ts — builds the authorize URL with PKCE, redirects to Epic
- /Users/murtaza/Documents/provider_pa/app/api/auth/smart/callback/route.ts — handles the redirect back from Epic, exchanges code for tokens, stores session, redirects to /pa/[id] or /queue
- /Users/murtaza/Documents/provider_pa/app/api/auth/smart/refresh/route.ts — refresh-token rotation
- /Users/murtaza/Documents/provider_pa/middleware.ts — REPLACE the mock cookie check with a SMART-session check. Routes under (provider) require a valid (non-expired) session; expired but refreshable = silent refresh; no session at all = redirect to /launch.
- Schema additions: SmartSession table in prisma/schema.prisma. Coordinate with orchestrator.

Schema change (coordinate BEFORE editing):
- New table SmartSession {id, sessionToken (HMAC-signed cookie value), iss (FHIR base URL), accessTokenEnc (encrypted), refreshTokenEnc (encrypted, nullable), idTokenEnc (nullable), expiresAt, fhirUser (e.g. "Practitioner/123"), patientContext (nullable), encounterContext (nullable), scope, createdAt, lastUsedAt, revokedAt}
- Encrypt access/refresh tokens at rest with AES-256-GCM keyed off APP_TOKEN_ENCRYPTION_KEY env var. NEVER store tokens in plaintext.
- @@index([sessionToken]), @@index([fhirUser, revokedAt])
- Migration: 0004_smart_session
- Update ARCHITECTURE.md SmartSession block in same commit

Your contract:
- EHR launch flow (Epic redirects to /launch?iss=<EpicFhirBase>&launch=<launchToken>):
  1. /launch reads iss + launch from query, calls discovery on iss, generates PKCE pair + state, stores {iss, launch, codeVerifier, redirectAfterAuth} server-side keyed by state, redirects to {smart_config.authorization_endpoint}?response_type=code&client_id={EPIC_SANDBOX_CLIENT_ID}&redirect_uri={callback}&scope={requested_scopes}&state={state}&aud={iss}&launch={launch}&code_challenge={pkce.challenge}&code_challenge_method=S256
  2. Epic auths the user (or uses existing session), redirects back to /api/auth/smart/callback?code=<>&state=<>
  3. Callback verifies state, exchanges code for tokens at smart_config.token_endpoint with PKCE verifier, gets {access_token, refresh_token, id_token, expires_in, scope, patient (if launched with patient ctx), encounter (if launched with encounter ctx), fhirUser}, creates SmartSession row, sets HMAC-signed httpOnly cookie ({sessionToken, expires}), redirects to /pa/[id] (if encounter has an active PA) or /queue (otherwise).
- Standalone launch flow (provider opens https://<our-app>/launch?iss=<EpicFhirBase>):
  - Identical to EHR launch but no `launch` parameter, scope must include `launch/patient` so Epic shows the patient picker.
- Refresh flow:
  - middleware notices session expires within 60s, calls refresh endpoint silently, swaps tokens in SmartSession, continues request.
  - On refresh failure (revoked/expired refresh token) → revoke session, redirect to /launch?iss={iss}.
- Scope list (request these): launch openid fhirUser profile offline_access patient/Patient.read patient/Encounter.read patient/Coverage.read patient/Practitioner.read patient/ServiceRequest.read patient/DocumentReference.read patient/Binary.read patient/Condition.read patient/Observation.read user/Practitioner.read

Constraints:
- public client with PKCE only — do NOT include client_secret in any request
- never log access_token, refresh_token, id_token, or code parameter at any log level
- the state token expires in 10 minutes; reject older callbacks
- aud parameter MUST equal the iss FHIR base URL — Epic rejects launches that drop it
- handle Epic's quirky scope echo (Epic returns granted scopes in the token response which can be a subset of requested; persist the granted scope list, not the requested list)
- TOKEN STORAGE: encrypt at rest, decrypt only when calling FHIR; never serialize tokens in API responses, never include them in audit log payloads

Tests must verify:
- Discovery: GET fhir.epic.com/...//.well-known/smart-configuration returns expected endpoints; cached for 24h.
- PKCE: code_verifier is 43-128 chars, code_challenge is base64url-no-pad of SHA256(verifier).
- EHR launch: synthetic launch token + iss → /launch redirects to authorize URL with all required params.
- Callback: valid code+state exchanges for tokens, SmartSession created with encrypted tokens, cookie set, redirects to /queue.
- State CSRF: callback with mismatched/missing state → 400.
- Refresh: expired access token + valid refresh token → silent refresh, new SmartSession.accessTokenEnc, continues.
- Scope rejection: callback with missing required scopes → flow fails with clear error.
- Revoked session: call protected route after deleting SmartSession → 401 redirect to /launch.

Penguin SDK rule: not relevant to this ticket (no AI). Forbidden libraries rule still applies (no rolling our own JWT — use jose for ID token verification).

When done:
- Files changed
- Schema migration applied
- Test output
- Screen recording or screenshots: launch from https://fhir.epic.com/test against the registered app, land on /queue with patient context populated
- A token-shape sample (with values redacted to "REDACTED") confirming: access_token JWT decoded reveals expected aud, scope, sub, fhirUser claims
```

- **Verify:** orchestrator launches from Epic's test harness (`https://fhir.epic.com/test`) with sandbox patient "Camila Lopez", lands on `/queue`, confirms (in Prisma Studio) a `SmartSession` row exists for that practitioner with non-empty encrypted tokens.

---

### phase-6-fhir-resource-adapters

- **Type:** agent (`fhir-engineer`)
- **Goal:** typed Epic-FHIR client + adapters for every resource we read. All FHIR HTTP calls go through this single layer; no other module talks to Epic directly.
- **Why it matters:** clean boundary keeps Epic-specific quirks (pagination styles, search parameter dialects, vendor extensions) in one place.
- **Owns:** `lib/fhir/` (new): `client.ts` (auth-aware HTTP client), `types.ts` (TS types for R4 resources we use), `patient.ts`, `encounter.ts`, `coverage.ts`, `practitioner.ts`, `serviceRequest.ts`, `documentReference.ts`, `condition.ts`, `observation.ts`, `binary.ts`. Plus `__tests__/lib/fhir/` mocking against fixture FHIR JSON.

#### Subagent prompt

```
Goal: Implement typed Epic-FHIR adapters. One module per resource type. All Epic API calls flow through here.

Why this matters: Single boundary for Epic quirks. Future swap to Cerner/Athena reuses the same adapter shape.

Required reading:
- https://www.hl7.org/fhir/R4/resourcelist.html — R4 resource specs
- https://fhir.epic.com/Specifications — Epic-specific implementation notes per resource (search parameters, supported elements, gotchas)
- /Users/murtaza/Documents/provider_pa/lib/smart/session.ts (Phase 6 ticket 2) — getCurrentSession() returns iss + decrypted access_token

Context (already done):
- SMART session is live; getCurrentSession() works.
- Synthea-generated test fixtures live at __tests__/fixtures/fhir/{patient,encounter,coverage,...}.json (you'll add these from Epic's published sandbox examples).

Your scope:
- /Users/murtaza/Documents/provider_pa/lib/fhir/client.ts — fetch wrapper that:
    * resolves session via getCurrentSession(), attaches Bearer token
    * sets Accept: application/fhir+json
    * handles paginated bundles via Bundle.link[rel="next"]
    * retries on 401 with one silent refresh attempt; on second 401, throws SmartSessionExpiredError → middleware catches → redirects to /launch
    * retries with exponential backoff on 429/503 (max 3 attempts)
    * never logs the Bearer token; redacts before any error message
- /Users/murtaza/Documents/provider_pa/lib/fhir/types.ts — Zod schemas for: Patient, Encounter, Coverage, Practitioner, ServiceRequest, DocumentReference, Binary, Condition, Observation, Bundle. Use only fields we consume — no need to model the entire spec.
- One file per resource exposing typed READ + SEARCH:
    fhir/patient.ts: getPatient(id), searchPatients(params)
    fhir/encounter.ts: getEncounter(id), searchEncounters({patient, _sort, _count})
    fhir/coverage.ts: getCoverage(id), searchCoverages({patient, status})
    fhir/practitioner.ts: getPractitioner(id) — uses fhirUser claim
    fhir/serviceRequest.ts: searchServiceRequests({patient, encounter, status})
    fhir/documentReference.ts: searchDocumentReferences({patient, encounter, type, date}); fetchBinary(documentRef.content[0].attachment.url) → returns Buffer
    fhir/condition.ts: searchConditions({patient, clinical-status, category})
    fhir/observation.ts: searchObservations({patient, category, date})
- All adapters return zod-validated typed objects, not raw JSON. Discard fields we don't use.
- /Users/murtaza/Documents/provider_pa/__tests__/lib/fhir/*.test.ts — Vitest tests against fixture JSON; mock fetch.

Constraints:
- Epic SPECIFIC quirks to handle:
    * DocumentReference pagination uses ?_count up to 1000 max; we use 100 default
    * Binary fetch returns base64-encoded data in `data` field by default; pass Accept: application/octet-stream to get raw bytes (preferred for PDFs)
    * Coverage.status is optional in some Epic versions; treat null as "active"
    * Encounter.period.end is null for active encounters; this is normal, not a data quality issue
    * Observation.value[x] polymorphism — code defensively, support valueQuantity and valueCodeableConcept at minimum
- ServiceRequest is the FHIR resource for "the order" (CT 70450). It carries the procedure code in code.coding[0].code. We map this → PriorAuthCode in the next ticket.
- Never make a FHIR call from a Server Component or middleware — only from Route Handlers, server actions, and the AI service. (Server Components run too eagerly and would explode FHIR call volume.)

Tests must verify:
- Each adapter parses the published Epic sandbox example for that resource without error.
- 401 on first call triggers silent refresh, second 401 throws SmartSessionExpiredError.
- 429 triggers exponential backoff (verify with sinon timers).
- Pagination: a 3-page Bundle is concatenated into a single typed array.
- Binary fetch with Accept: application/octet-stream returns Buffer not base64 string.
- SearchParameter handling: ?patient=Patient/{id}&_sort=-date renders correctly in URL.

When done:
- Files changed
- Test output
- Screen recording: hit /api/_debug/fhir?resource=patient&id={sandbox-camila-lopez-id} — get back a parsed typed Patient
```

- **Verify:** orchestrator hits `/api/_debug/fhir?resource=patient&id={sandbox-id}` and gets back a typed `Patient` JSON; spot-checks `Encounter`, `DocumentReference` searches against the same patient.

---

### phase-6-fhir-domain-mapping

- **Type:** agent (`api-engineer`)
- **Goal:** map FHIR resources → Prisma domain models. Replaces the Phase 1 fixture loaders for `Patient`, `Encounter`, `Coverage`, `Practitioner`. The mapping layer is what the API routes call; routes don't read FHIR adapters directly.
- **Why it matters:** keeps domain logic Epic-agnostic. State machine, policy match, evidence extraction don't know FHIR exists.
- **Owns:** `lib/domain/syncFromFhir.ts` (new orchestrator: `syncPatientFromFhir(patientId, encounterId)` reads everything we need, upserts cached rows). Schema additions to `Patient`, `Encounter`, `Coverage`, `Practitioner` (FHIR fields). Migration `0005_fhir_cache_fields`.

#### Subagent prompt

```
Goal: Map FHIR resources to our Prisma domain models. The mapping is the only place that knows about both worlds.

Required reading:
- /Users/murtaza/Documents/provider_pa/lib/fhir/* (Phase 6 ticket 3)
- /Users/murtaza/Documents/provider_pa/ARCHITECTURE.md "Data model"
- /Users/murtaza/Documents/provider_pa/CLAUDE.md
- penguinai-claude-artifacts-main/.claude/agents/api-builder.md — required reading for the agent shape

Context (already done):
- FHIR adapters all working (ticket 3).
- SMART session live (ticket 2).

Your scope:
- /Users/murtaza/Documents/provider_pa/lib/domain/syncFromFhir.ts — main orchestrator
- /Users/murtaza/Documents/provider_pa/lib/domain/mappers/{patient,encounter,coverage,practitioner,serviceRequest}.ts — pure mapping functions (no I/O)
- prisma/schema.prisma adds: Patient.fhirResourceId, Patient.fhirVersionId, Patient.lastFetchedAt; same fields on Encounter, Coverage, Practitioner. ServiceRequest reference replaces the old Order model — Order goes away.
- Migration name: 0005_fhir_cache_fields
- Update ARCHITECTURE.md in same commit.

Your contract:
- Export syncPatientFromFhir(session, patientId, opts?: {encounterId?, force?}): Promise<{patient: Patient, encounter?: Encounter, coverages: Coverage[], serviceRequests: ServiceRequest[]}>
- TTL-based cache: Patient demographics 1 hour, Encounter 5 minutes (more volatile), Coverage 1 hour. force=true bypasses TTL.
- Pure mapper functions take a typed FHIR resource and return Prisma create/update args. No DB calls in mappers.
- Mapping rules:
    Patient.id (Prisma) = FHIR Patient.id (we deliberately reuse the FHIR id; not a UUID)
    Patient.firstName = FHIR Patient.name.given[0] of the official-use HumanName, fallback to first
    Patient.lastName = name.family
    Patient.dob = birthDate (parse YYYY-MM-DD)
    Patient.sex = gender
    Encounter.id = FHIR Encounter.id
    Encounter.encounterDate = period.start
    Encounter.placeOfService = derive from class.code or serviceType.coding (hand-rolled lookup table; Epic uses different codes than CMS)
    Coverage.payerId = lookup by Coverage.payor.display name → Payer.shortCode (case-insensitive, with synonym table for "United Healthcare" vs "UnitedHealthcare" vs "UHC")
    Coverage.planName = Coverage.class[0].name where Coverage.class[0].type.coding[0].code = "plan"
    Coverage.memberId = Coverage.subscriberId or Coverage.identifier[0].value
    ServiceRequest.code → mapped to PriorAuthCode at PA creation time (next ticket handles); the mapping just stores the FHIR ServiceRequest id on the PriorAuth row for reference.
- Idempotent: re-running syncPatientFromFhir with same args is a no-op if within TTL.
- All Prisma upserts wrapped in a single transaction so partial sync doesn't leave inconsistent rows.

Constraints:
- The Phase 1 fixture loader (prisma/seed/fixtures.ts) stays — it loads our three demo patients with deterministic FHIR-style ids ("camila-lopez-test", etc.). The demo flow now goes through syncFromFhir against a mock FHIR adapter; production goes through the real adapter. Both paths use the same mapper code.
- Mock FHIR adapter: lib/fhir/mock.ts — same TypeScript interface as the real adapters but reads from prisma/fixtures/fhir/*.json. Used by demo scenarios + tests. Selected via FHIR_MODE=mock|real env var.

Tests:
- Each mapper has a fixture-based unit test (mappers/__tests__/*.test.ts).
- Integration: syncPatientFromFhir against the mock adapter for the three demo patients, confirm Prisma rows match the existing demo fixture state byte-for-byte.
- TTL: second call within TTL hits cache (assertion: fhir adapter's getPatient was called once not twice).

When done:
- Files changed
- Schema migration applied
- Test output
- Confirmation that the Phase 4 demo scenarios still work end-to-end (regression check)
```

- **Verify:** orchestrator runs scenario 1 (Head CT) end-to-end against the mock FHIR adapter; confirms identical outcome to before. Then runs against the real Epic sandbox with sandbox patient "Camila Lopez"; confirms a PA is created with the right encounter, coverage, codes.

---

### phase-6-clinical-doc-pdf-pipeline

- **Type:** agent (`ai-engineer`)
- **Goal:** clinical documents (`DocumentReference`) flow through the same OCR + bbox + PDFViewer pipeline that policy PDFs already use. The "markdown panel for clinical notes" goes away. Citations on clinical notes show real bbox highlights.
- **Why it matters:** answers the user's #1 production gap. Identical viewing experience for citations regardless of source.
- **Owns:** `services/ai/document_intake.py` (new — pulls Binary content, normalizes to PDF, OCRs, persists), `services/ai/utils/document_normalize.py` (RTF/CCDA/HTML → PDF rendering), schema changes to `CachedDocumentReference`. Migration `0006_cached_document_reference`.

#### Subagent prompt

```
Goal: Pull DocumentReference resources from Epic, normalize whatever payload format they carry (PDF/RTF/HTML/CCDA/plain text) into a PDF, OCR with Textract, store page images and bboxes. Same path the policy PDFs already use.

Required reading:
- /Users/murtaza/Documents/provider_pa/AI_INTEGRATION.md "Task 3 — Policy ingestion (PDF)" — exact pattern we're extending
- /Users/murtaza/Documents/provider_pa/POLICIES.md "Ingestion pipeline 2"
- /Users/murtaza/Documents/provider_pa/lib/fhir/documentReference.ts (Phase 6 ticket 3)
- penguinai-claude-artifacts-main/.claude/contracts/{bbox-format,pdfviewer-data}.md
- penguinai-claude-artifacts-main/.claude/skills/ai-engineering-guide/SKILL.md "FORBIDDEN LIBRARIES"

Penguin SDK rule (CLAUDE.md):
- OCR via penguin.ocr.providers.aws.AWSTextractProvider — same pattern as policy ingestion.
- LLM (if used for content classification) via penguin.core only.
- PDF normalization (RTF/HTML/CCDA → PDF) via PyMuPDF + libreoffice (cli, headless). NO weasyprint, reportlab, pdfkit.
- Page-image rasterization via PyMuPDF.

Context (already done):
- AWSTextractProvider with S3 staging bucket is live (Phase 3).
- The page-image pipeline for policy PDFs is at services/ai/policy_ingestion.py (Phase 3) — read it, same pattern applies.
- DocumentReference adapter at lib/fhir/documentReference.ts.

Schema change (coordinate BEFORE editing):
- Rename ClinicalNote → CachedDocumentReference. Add columns: fhirResourceId (string), fhirVersionId, fhirContentType (e.g. "application/pdf"), pdfUrl (relative path for our normalized PDF), pageImages Json (canonical pdfviewer-data shape), ocrLineCount Int, lastFetchedAt, kind String @default("clinical_note") {clinical_note | provider_upload | policy_pdf}.
- Migration: 0006_cached_document_reference
- Update ARCHITECTURE.md.

Your scope:
- /Users/murtaza/Documents/provider_pa/services/ai/document_intake.py — main entry point; given a FHIR DocumentReference + access token + iss, fetch Binary, normalize, OCR, render page images, persist row in CachedDocumentReference, return the cached row.
- /Users/murtaza/Documents/provider_pa/services/ai/utils/document_normalize.py — content-type-aware normalizer: PDF=passthrough; RTF=libreoffice headless convert; HTML=libreoffice or weasyprint-FREE alternative (use libreoffice); CCDA XML=apply our XSL stylesheet then libreoffice; plain text=PyMuPDF text-on-page render.
- /Users/murtaza/Documents/provider_pa/services/ai/tests/test_document_intake.py
- /Users/murtaza/Documents/provider_pa/lib/ai/documentIntake.ts — TS wrapper: triggerIngestForPa(paId) → POST /ingest-documents → response is the list of CachedDocumentReference ids; idempotent (checks fhirResourceId+fhirVersionId before re-ingesting).

Your contract:
- Pydantic request: { pa_id: str, document_references: List[DocRefRef] } where DocRefRef = {fhir_id, version_id, content_type, binary_url, title}
- The API endpoint accepts the access_token via the existing AI_SERVICE_TOKEN bearer; Epic credentials are passed inline in the request body so the AI service doesn't store them. The Next.js side fetches Binary content via the FHIR adapter, base64s it into the request payload, and the AI service does normalization+OCR+storage.
- Algorithm:
    1. For each DocRefRef, decode the binary content (if not already PDF, normalize to PDF in tempdir).
    2. Run AWSTextractProvider().process_file on the PDF.
    3. Render page images at 150 DPI via PyMuPDF, store at public/cached-docs/{paId}/{fhirId}/page_{n}.png (local for the demo; S3 in production — same pattern as policy page-images).
    4. Persist CachedDocumentReference row with pdfUrl + pageImages JSON in the canonical pdfviewer-data shape + ocrLineCount.
    5. The OCR full_text goes into the corpus available for evidence extraction (just like Phase 3 used clinical-note text).
- Idempotency: if a row exists with matching (paId, fhirResourceId, fhirVersionId), return existing. version_id changing means re-ingestion (Epic versions DocumentReferences when content updates).
- Cache: ai_call_cache key already includes (task, prompt_version, model, input_hash) — extend to include fhirResourceId+fhirVersionId for the OCR step so we don't re-Textract identical docs.

Tests:
- 4 fixture DocumentReferences (one PDF, one RTF, one CCDA XML, one plain text); each gets normalized, OCR'd, page-image-rendered.
- PDF passthrough: bytes-equal to input.
- RTF normalization: content text preserved; page count > 0.
- Idempotent re-ingest: second call with same fhirResourceId+versionId reuses existing row, no Textract call.
- Citation flow regression: the existing Phase 3 evidence extraction tests still pass when run against CachedDocumentReference rows whose corpus comes from this pipeline (instead of seeded plain-text notes).

When done:
- Files changed
- Schema migration applied
- pytest output
- For each of the three demo scenarios, list the CachedDocumentReference ids ingested and confirm pageImages exist in public/cached-docs/
```

- **Verify:** orchestrator picks one document from sandbox patient Camila Lopez, hits the ingest endpoint, opens the resulting PDF in `PolicyPdfViewer` from the in-app debug page, confirms bboxes render. Then runs an evidence extraction against this document and confirms citations point at real bboxes (not fabricated).

---

### phase-6-document-triage

- **Type:** agent (`ai-engineer`)
- **Goal:** before evidence extraction, a cheap Haiku call ranks every available `DocumentReference` for relevance against each criterion. Top-K most relevant per criterion get the expensive Sonnet evidence-extraction treatment. Cuts LLM cost on patients with hundreds of chart documents.
- **Why it matters:** addresses the user's cost-control concern. Real patients have hundreds of `DocumentReference` resources spanning years; running Sonnet evidence extraction across all of them per criterion is uneconomic.
- **Owns:** `services/ai/document_triage.py`, `services/ai/prompts/document_triage_v1.py`, `services/ai/tests/test_document_triage.py`, `lib/ai/documentTriage.ts`, `lib/ai/schemas/documentTriage.ts`. Adds `get_model("triage")` role to `penguin_client.py` (aliases to Haiku).

#### Subagent prompt

```
Goal: Build the document-triage step. Cheap Haiku call ranks each DocumentReference's relevance per criterion. Match engine consumes top-K relevant docs per criterion as the evidence-extraction corpus.

Why this matters: Cost control. Patients with 200+ chart documents otherwise hit Sonnet-extraction cost ceilings. Triage is ~5-10% of full extraction cost.

Penguin SDK rule (CLAUDE.md):
- LLM via penguin.core.create_model with the new "triage" role (Haiku 4.5).
- penguin.output_guard.hallucination.FaithfulnessDetector NOT applicable here (we're scoring relevance, not extracting evidence).
- Cache key includes (task="triage", prompt_version, model, sha256(criterion_id + document_metadata + first 500 chars)).

Required reading:
- /Users/murtaza/Documents/provider_pa/AI_INTEGRATION.md
- penguinai-claude-artifacts-main/.claude/skills/ai-engineering-guide/usage/01-CORE-AND-AGENTS.md

Context (already done):
- CachedDocumentReference rows exist with full_text from OCR (Phase 6 ticket 5).
- Match engine at lib/policies/matchEngine.ts loops criteria and calls evidence extraction.

Your scope:
- services/ai/document_triage.py — handler. Given criteria checklist + list of CachedDocumentReference metadata, return ranked relevance scores per (criterion, document).
- services/ai/prompts/document_triage_v1.py — registered prompt.
- services/ai/tests/test_document_triage.py
- lib/ai/documentTriage.ts — TS wrapper exposing scoreRelevance(criteria, documents): RelevanceScore[].
- Update lib/policies/matchEngine.ts: BEFORE looping criteria, call documentTriage; for each criterion, build the corpus from top-K (default K=5) documents by score >= threshold (default 0.4). Cache result in CriterionResult.metadata so re-rechecks don't re-triage unchanged documents.

Your contract:
- Pydantic request: {criteria: List[CriterionMeta], documents: List[DocMeta], pa_id?, provider_id?}
  - CriterionMeta = {id, text, evidence_hint, required_codes}
  - DocMeta = {id, fhir_id, doc_type (e.g. "Progress note"), authored_at, author_role, snippet (first ~500 chars of OCR text)}
- Pydantic response: {scores: List[RelevanceScore], prompt_version, model, trace_id?, cached: bool}
  - RelevanceScore = {criterion_id, document_id, score: float [0-1], reasoning: str, recommended_for_extraction: bool}
- Algorithm:
    1. For each criterion, send ONE Haiku call with all documents' metadata + snippets in the prompt. Ask for relevance scoring across the whole list at once (one call per criterion, not per (criterion, document) pair — saves cost).
    2. Use with_structured_output(RelevanceScores) where RelevanceScores wraps List[RelevanceScore] (single-class container).
    3. recommended_for_extraction = (score >= threshold) AND (rank <= K).
    4. Return.
- The triage prompt sends the document SNIPPET (first ~500 chars) NOT the full text. Cost differential: full text averages 5K tokens/doc; snippet averages 100 tokens. With 200 docs × 6 criteria, that's the difference between $30 and $0.50 per PA.
- For every (criterion, document) pair where snippet is too sparse to triage confidently (very short doc or truncation issue), default to recommended_for_extraction=true (err toward inclusion — false negative is worse than false positive in the triage step).

Tests:
- Synthetic test: 10 documents, 3 criteria; relevant docs have keywords matching the criterion, irrelevant docs are unrelated. Triage correctly ranks relevant docs > irrelevant.
- Cost test: assert exactly N_criteria Haiku calls made (not N_criteria × N_docs).
- Cache test: re-triage with same input → cached=true, no LLM call.
- Edge case: empty documents list → empty scores array, no LLM call.
- Edge case: 1 document → still triaged (don't short-circuit).
- Threshold tuning: provide a test that varies threshold; report (precision, recall) for the synthetic dataset so future threshold tuning has a baseline.

When done:
- Files changed
- pytest output
- For each demo scenario: triage results across the seeded clinical notes — which docs get recommended_for_extraction per criterion. (Should match human intuition: HPI relevant for "new headache pattern", ROS irrelevant for "neuro exam documented" if neuro is in PE only, etc.)
- Cost comparison: for one demo PA, log "extraction would have processed X docs without triage; processed Y docs with triage; cost reduced by Z%"
```

- **Verify:** orchestrator runs the Botox demo (where the chart has multiple docs across years); confirms older non-relevant docs (e.g. annual physicals from 5 years ago) get triaged out; confirms today's neuro note + headache diary + the relevant prior PCP note get included; confirms cost telemetry log shows the reduction.

---

### phase-6-policy-driven-checklist

- **Type:** agent (`api-engineer` + `ai-engineer` collaboration)
- **Goal:** in production code paths, the checklist comes from the AI-ingested `Policy.criteria` rows, not hand-curation. The Phase 1 hand-curated demo policies stay (for the demo) but a feature flag `POLICY_SOURCE=production|demo` switches the source.
- **Why it matters:** answers the user's #2 production gap. Policy is the source of truth.
- **Owns:** modifications to `lib/policies/lookup.ts` (filter by `Policy.publishStatus="published"`), additions to `Policy` model (`publishStatus` enum, `publishedAt`, `publishedBy`, `policyVersion`, `effectiveFrom/To`), simple admin UI at `app/(admin)/policies/`, scheduled rescrape job.
- **Detailed contract:** see WORKFLOWS.md "Clinical Informaticist" persona for the policy review/publish flow this enables.

---

### phase-6-submission-packet-real-docs

- **Type:** agent (`ai-engineer` + `ui-engineer`)
- **Goal:** submission packet's "supporting documents" section now appends the actual clinical PDFs (the real `DocumentReference` content), not synthesized text rendered to PDF.
- **Why it matters:** completes the "real PDFs everywhere" picture. Payer receives real documents.
- **Owns:** modifications to `services/ai/submission_packet.py` (page-2+ now uses `fitz.Document.insert_pdf` against the `CachedDocumentReference.pdfUrl`s, not text rendering — the speculative ticket text said "page-3+" assuming a criteria-checklist sat at page 2, but the implemented packet has no separate checklist page so the supporting documents begin at page 2), `phase-4-review-tracker` SubmissionPacketPreview now renders the appended pages correctly. The Preview reads the `packet_data.cited_documents` array returned by `POST /api/pa/{id}/submission-packet` (a `[{kind, label, sublabel}]` list, not the earlier `pageImages.files` shape). Test: packet for a real Epic sandbox patient renders cleanly.

---

### phase-6-citation-viewer-pdf-only

- **Type:** agent (`ui-engineer`)
- **Goal:** remove `NoteHighlighter` (the markdown-panel fallback). Every citation source is a PDF (clinical-note PDFs from `CachedDocumentReference` or policy PDFs). `CitationViewer` always uses `PolicyPdfViewer`. Component renamed from `PolicyPdfViewer` → `DocumentPdfViewer` since it now serves both.
- **Owns:** rename + simplification in `components/pa/`. Test: every citation in every demo scenario opens in the PDF viewer with a real bbox highlight.

---

### phase-6-launch-routing-ui

- **Type:** agent (`ui-engineer`)
- **Goal:** `app/launch/page.tsx`, `app/standalone-launch/page.tsx`, error states for failed launches (`app/launch/error.tsx`), the "Pick patient" UI when standalone-launching without a patient context, the post-launch routing logic (PA exists for this encounter? → `/pa/{id}`; no PA? → `/queue?encounter={id}` with a "Create PA" CTA).
- **Owns:** the launch UX layer on top of the SMART flow.

---

### phase-6-integration

- **Type:** orchestrator inline
- **Goal:** wire all the above; replace mock auth middleware; remove the `phase-4-mock-auth` ticket's hardcoded session; run all three demo scenarios end-to-end against Epic sandbox; smoke-test against a Synthea-generated synthetic patient injected into Epic sandbox.
- **Detailed work:** rip out `lib/auth/session.ts` mock; ensure every API route reads `getCurrentSession()` from `lib/smart/session.ts`; verify `getCurrentProvider()` resolves the FHIR `Practitioner`; run `scripts/smoke-scenario-1.ts` against `FHIR_MODE=real` and Epic sandbox.

---

### phase-6-quality-tester

- **Type:** quality-tester subagent (per ORCHESTRATION.md "Available agent types")
- **Goal:** browser-driven scenario walks of every workflow in `WORKFLOWS.md` against Epic sandbox. Pattern adapted from `penguinai-claude-artifacts-main/.claude/agents/quality-tester.md`. Plus contract validation per `TESTING.md`.

---

## Phase 6 exit checklist

**Step 1 — Orchestrator quick checks:**
- [ ] EHR launch from `https://fhir.epic.com/test` lands on `/queue` with patient context populated
- [ ] Standalone launch from `https://<our-app>/launch?iss=<EpicSandboxFHIR>` shows Epic patient picker, lands on `/queue` with patient context after picker
- [ ] All FHIR adapters return typed objects against sandbox patients (Camila Lopez, Derrick Lin, Warren McGinnis)
- [ ] `pnpm test` and `pytest services/ai/` green
- [ ] No `lib/auth/session.ts` mock-cookie code remains; grep returns 0 hits
- [ ] No `NoteHighlighter` component remains; grep returns 0 hits
- [ ] All three demo scenarios run via the mock FHIR adapter (regression check: existing Phase 4/5 work still works)

**Step 2 — Integration-tester gate:**
- [ ] All three demo scenarios run via the real Epic sandbox adapter against synthetic Epic patients
- [ ] integration-tester verifies: SMART session refresh on token expiry; FHIR adapter retry on 429/503; OCR pipeline runs against Epic-fetched DocumentReferences; bboxes render in DocumentPdfViewer
- [ ] integration-tester runs document triage against a "noisy" patient (50+ documents) and reports cost-reduction metric

**Step 3 — Quality-tester gate:**
- [ ] quality-tester executes every workflow in `WORKFLOWS.md` Provider persona, reports PASS/FAIL per TC-ID derived from those workflows
- [ ] quality-tester reports any contract violations against `TESTING.md` "Contract tests" section

When all three gates pass, the orchestrator updates `tasks/STATUS.md` and Phase 7 begins.

---

## What this phase deliberately does NOT include

- HIPAA / compliance hardening — see `tasks/phase-6-compliance.md` (deferred per user)
- Real payer X12 278 / Da Vinci PAS — Phase 8
- Multi-tenancy (single-org still) — Phase 7
- Cerner / Athena / Allscripts SMART support — Phase 7+ (Epic only this phase)
- Letter generation — Phase 8
- Reauth / appeal / concurrent / retrospective workflows — Phase 9
- Patient-facing features — Phase 10+
- Reporting dashboards — Phase 10+

If a subagent's work creeps into any of these, surface it to the orchestrator — don't expand scope mid-ticket.
