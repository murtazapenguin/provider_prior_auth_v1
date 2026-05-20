# Architecture

System design, services, data model, and the deployment shape. Deliberately written so any developer (or AI agent) can pick this up cold and know where every piece of behavior lives.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js (App Router) + TypeScript + React Server Components | Server-rendered pages with low UI overhead; same repo as API routes |
| Styling | Tailwind CSS | Penguin's design system tokens map cleanly to Tailwind config |
| API | Next.js Route Handlers + Server Actions | Co-located with frontend, no separate gateway needed |
| ORM | Prisma | Type-safe DB client, migrations, schema as source of truth |
| Database | Postgres (Vercel Postgres or Supabase for hosting) | Relational fit for our schema; full-text search available if needed |
| AI orchestration | Penguin AI SDK | Required by hackathon |
| Hosting | Vercel | One-click deploy, edge-friendly, hooks into Postgres |
| Background work | Vercel Cron + a queue table | Drives the status simulator and 60-day expiration sweep |

## Architecture decision: AI service runs as a Python FastAPI sidecar (Path B)

**Decided.** Penguin AI SDK is Python-only (`from penguin.core import create_model`), so we run a small **FastAPI service** alongside Next.js that owns every SDK interaction. Next.js calls it over HTTP from server-side code only.

Why we made it this way:
- Real separation of concerns — the AI service can be scaled, restarted, and re-deployed independently of the web app.
- The Penguin SDK ships with primitives we lean on directly (`with_structured_output`, `FaithfulnessDetector`, `OCRResult`, `PenguinTracer`) — keeping them in their native Python is cheaper than re-implementing equivalents in TS.
- The boundary is a single typed HTTP API (`/derive-codes`, `/extract-evidence`, `/ingest-policy`, `/ocr-document`, `/generate-submission-packet`) so swapping the backend later (different SDK version, different model) doesn't ripple into Next.js.

Cost: two deploys, two languages. Worth it.

The TS-side adapter (`lib/ai/penguinClient.ts`) is the only file in the Next.js codebase that knows the FastAPI service exists. Everything else imports typed wrappers (`lib/ai/codeDerivation.ts`, `lib/ai/evidenceExtraction.ts`) that re-validate responses with zod before handing them to callers.

## High-level module map

```
provider_pa_hackathon/
├── app/                          # Next.js App Router
│   ├── (provider)/               # Provider-facing UI
│   │   ├── encounter/[id]/       # Code review screen
│   │   ├── pa/new/               # Manual PA initiation wizard (code+payer+patient)
│   │   ├── pa/[id]/              # Single PA detail (checklist + actions)
│   │   ├── pa/[id]/review/       # Ready-for-submission review
│   │   ├── pa/[id]/tracker/      # Post-submission tracker
│   │   ├── queue/                # Work queue dashboard (3 tabs: Action needed / Parked / Submitted)
│   │   └── layout.tsx
│   ├── api/
│   │   ├── encounters/route.ts   # POST: ingest encounter
│   │   ├── pa/route.ts           # CRUD for PA records
│   │   ├── pa/initiate/route.ts  # POST: create PA from scratch (code+payer+patient); necessity check
│   │   ├── pa/[id]/recheck/      # Re-run evidence extraction
│   │   ├── pa/[id]/submit/       # Submit to payer simulator
│   │   ├── pa/[id]/upload/       # Attach document (storageKey + clean OCR text)
│   │   ├── pa/[id]/attachments/[attachmentId]/file/  # GET: stream uploaded binary (auth-checked)
│   │   ├── pa/[id]/priority/     # PATCH: edit priority/rationale before submission
│   │   ├── pa/[id]/withdraw/
│   │   ├── pa/[id]/void/
│   │   ├── pa/[id]/cancel/
│   │   ├── payers/route.ts       # GET: list all payers
│   │   ├── patients/route.ts     # GET: search patients by name
│   │   └── simulator/webhook/    # Status updates from simulator
│   └── layout.tsx
├── lib/
│   ├── ai/                       # Penguin SDK adapter (single boundary, calls FastAPI sidecar)
│   │   ├── penguinClient.ts      # HTTP client → FastAPI sidecar (the only file that knows the URL)
│   │   ├── codeDerivation.ts     # CPT/HCPCS/ICD-10 from notes (zod validates response)
│   │   ├── evidenceExtraction.ts # criteria-by-criteria evidence + citations (zod validates)
│   │   └── policyIngestion.ts    # PDF → structured criteria (zod validates)
│   ├── ehr/                      # EHR adapter — mock impl, real impl later
│   │   └── mockEhr.ts
│   ├── eligibility/              # Coverage lookup
│   │   └── lookup.ts
│   ├── policies/                 # Policy lookup + matching
│   │   ├── lookup.ts
│   │   └── matchEngine.ts
│   ├── payer/                    # Submission adapter — mock now, real later
│   │   ├── submit.ts
│   │   └── simulator.ts
│   ├── statusMachine/            # State transitions, guards
│   │   └── transitions.ts
│   ├── audit/                    # Append-only audit log helper
│   │   └── log.ts
│   ├── storage/                  # Storage adapter (binary uploads); local-FS impl, prod swaps to Vercel Blob/S3
│   │   ├── index.ts              # StorageAdapter interface + factory (STORAGE_BACKEND env var)
│   │   └── local.ts              # ./data/uploads/ filesystem impl (gitignored)
│   └── db/                       # Prisma client singleton
│       └── client.ts
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── components/
│   ├── ui/                       # Penguin design-system primitives
│   ├── pa/                       # Domain components: Checklist, CodeReview, Tracker
│   └── ...
├── tasks/                        # Build tickets (planning, not source code)
└── docs/...                      # Planning docs (this set)
```

## Data model

The schema below uses Prisma syntax for clarity. Field types and indexes are illustrative; tighten during implementation.

### Patient + encounter
```prisma
model Patient {
  id           String   @id @default(cuid())
  externalId   String?  @unique  // EHR mrn, mock for now
  firstName    String
  lastName     String
  dob          DateTime
  sex          String
  coverages    Coverage[]
  encounters   Encounter[]
  createdAt    DateTime @default(now())
}

model Coverage {
  id              String   @id @default(cuid())
  patientId       String
  patient         Patient  @relation(fields: [patientId], references: [id])
  payerId         String
  payer           Payer    @relation(fields: [payerId], references: [id])
  planName        String
  memberId        String
  groupNumber     String?
  benefitCategory String   // e.g., "Medical", "Pharmacy", "DME"
  effectiveFrom   DateTime
  effectiveTo     DateTime?
  isPrimary       Boolean  @default(true)
}

model Encounter {
  id          String     @id @default(cuid())
  patientId   String
  patient     Patient    @relation(fields: [patientId], references: [id])
  providerId  String
  provider    Provider   @relation(fields: [providerId], references: [id])
  encounterDate DateTime
  placeOfService String   // POS code
  notes       ClinicalNote[]
  priorAuths  PriorAuth[]
}

model CachedDocumentReference {
  id              String    @id @default(cuid())
  encounterId     String
  encounter       Encounter @relation(fields: [encounterId], references: [id])
  noteType        String    // "H&P", "Progress", "Imaging", "Operative", etc.
  authoredAt      DateTime
  authorRole      String
  text            String    // raw note body (legacy plain-text path)
  source          String    // "ehr", "scribe", "upload"
  // Phase 6 additions (migration 0006_cached_document_reference):
  fhirResourceId   String?   // FHIR DocumentReference.id (when synced from FHIR)
  fhirVersionId    String?   // FHIR meta.versionId (cache invalidation key)
  fhirContentType  String?   // "application/pdf", "text/rtf", "application/xml" (CCDA), etc.
  pdfUrl           String?   // normalized PDF path under public/cached-docs/<paId>/<fhirId>/
  pageImages       Json?     // canonical pdfviewer-data shape {files, presigned_urls}
  ocrLineCount     Int?
  lastFetchedAt    DateTime?
  kind             String    @default("clinical_note")  // clinical_note | provider_upload | policy_pdf

  @@map("ClinicalNote")   // legacy table name pinned for non-destructive Phase 6 rename
}

model Provider {
  id        String  @id @default(cuid())
  npi       String  @unique
  firstName String
  lastName  String
  specialty String
  encounters Encounter[]
}
```

### FHIR cache semantics (Phase 6+)

Phase 6 adds three columns to `Patient`, `Encounter`, `Coverage`, and `Provider` (= FHIR `Practitioner`): `fhirResourceId String?`, `fhirVersionId String?`, `lastFetchedAt DateTime?` (migration `0005_fhir_cache_fields`). These models are **caches** of FHIR R4 resources read from Epic, **not source-of-truth**.

- **Read-through cache.** Every domain read first calls `lib/domain/syncFromFhir.ts` (T3 scope), which checks TTL and either returns the cached row or refreshes from Epic via the typed FHIR adapters in `lib/fhir/`.
- **TTL invalidation.** Patient demographics: 1h. Encounter (more volatile, periods/status change): 5min. Coverage: 1h. `force: true` opt-in bypasses TTL.
- **Idempotent upsert.** Re-syncing the same `(fhirResourceId, fhirVersionId)` within TTL is a no-op. `fhirVersionId` mismatch triggers a refresh even within TTL.
- **ID strategy.** Prisma `id` equals FHIR resource `id` for FHIR-synced rows. Phase 1 fixture IDs (e.g., `camila-lopez-test`) are FHIR-compatible and used directly; `fhirResourceId` mirrors `id` for clarity. New rows created via FHIR sync use the FHIR id verbatim.
- **`FHIR_MODE` env flag.** `mock` (default in dev) routes through `lib/fhir/mock.ts` against fixture JSON; `real` (or unset) routes through Epic's sandbox via the per-resource adapters in `lib/fhir/{patient,encounter,coverage,practitioner,serviceRequest,...}.ts`. Both paths use the same mappers under `lib/domain/mappers/`.
  - Selection happens once at module load in `lib/fhir/index.ts`. Every domain consumer (including `lib/domain/syncFromFhir.ts`) should `import { getPatient } from '@/lib/fhir'` (the umbrella module). The per-resource modules remain importable for tests that exercise the real HTTP client in isolation.
  - Mock fixtures live under `prisma/fixtures/fhir/{resourceType}/{id-or-patient-id}.json` (note: distinct from the per-adapter test fixtures under `__tests__/fixtures/fhir/`, which use Epic-style sandbox IDs for the adapter-layer tests).
  - Tests that need to override adapter selection without env mutation should pass `{adapter}` into `syncPatientFromFhir(session, id, {adapter})` — bypasses both `FHIR_MODE` and the `lib/fhir/index.ts` resolution.
- **`PriorAuth.fhirServiceRequestId String?`** (same migration) records the FHIR `ServiceRequest.id` whose ordering produced this PA. Optional — backfilled when a PA is FHIR-driven; null for legacy Phase 4 PAs.

The `lastFetchedAt` field is the TTL anchor; it is **never** used to drive a state-machine transition. Cache misses on a stale `Encounter` trigger a refresh on next read, not a status change.

Implementation lives in `lib/domain/syncFromFhir.ts` (T3 — Phase 6). The orchestrator function `syncPatientFromFhir(session, patientId, opts?)` returns `{patient, encounter?, coverages, serviceRequests, provider?}` and wraps every Prisma write in a single `$transaction` so partial-fetch failures don't leave inconsistent rows. Pure mapper functions in `lib/domain/mappers/{patient,encounter,coverage,practitioner,serviceRequest}.ts` do no I/O and are tested in isolation under `__tests__/lib/domain/mappers/`.

### Payer + policies
```prisma
model Payer {
  id        String   @id @default(cuid())
  name      String   @unique     // "Medicare (CMS)", "United Healthcare"
  shortCode String   @unique     // "CMS", "UHC"
  policies  Policy[]
  coverages Coverage[]
}

model Policy {
  id              String   @id @default(cuid())
  payerId         String
  payer           Payer    @relation(fields: [payerId], references: [id])
  policyType      String   // "NCD", "LCD", "Medical Policy"
  externalId      String?  // CMS NCD/LCD id, UHC policy id
  title           String
  effectiveFrom   DateTime
  effectiveTo     DateTime?
  sourceUrl       String?
  sourceText      String?  // raw text used for ingestion
  pageImages      Json?    // pdfviewer-data shape {files,presigned_urls}; null for hand-curated policies
  applicableCodes PolicyCode[]
  criteria        PolicyCriterion[]
  // Phase 6 additions (migration 0007_policy_publishing):
  publishStatus   String    @default("draft")  // draft | published | retired
  publishedAt     DateTime?
  publishedBy     String?   // Provider id, or "seed" for Phase 1 hand-curated backfill
  policyVersion   String?   // e.g. "phase-1-curated", "2024-01-15-v3"
}
```

**Phase 6 policy-publishing semantics** (migration `0007_policy_publishing`): new `Policy` rows default to `publishStatus='draft'`. The 6 Phase 1 hand-curated demo policies (id prefix `policy-uhc-`) are backfilled inline by the migration to `publishStatus='published'` + `publishedBy='seed'` + `policyVersion='phase-1-curated'` so they surface under both `POLICY_SOURCE=demo` and `POLICY_SOURCE=production`. AI-ingested policies (T6 onward) land as `draft` until an admin publishes them via `app/(admin)/policies/[id]/publish/`.

```prisma

model PolicyCode {
  id        String  @id @default(cuid())
  policyId  String
  policy    Policy  @relation(fields: [policyId], references: [id])
  codeType  String  // "CPT", "HCPCS", "J", "Q", "ICD10"
  code      String
  modifier  String?
  posCodes  String[] // applicable place-of-service codes; empty = any
  @@index([code, codeType])
}

model PolicyCriterion {
  id              String   @id @default(cuid())
  policyId        String
  policy          Policy   @relation(fields: [policyId], references: [id])
  ordinal         Int      // criteria order on the checklist
  text            String   // human-readable criterion (e.g., "Conservative therapy attempted ≥6 weeks")
  evidenceHint    String?  // hint for AI extraction (e.g., "Look in PT notes, MD notes for documented therapy")
  requiredCodes   String[] // ICD-10s that must accompany if criterion is dx-driven
  group           String?  // for grouped criteria like "Any of the following: ..."
  groupOperator   String?  // "ALL" | "ANY"
  // Citation back to the source policy PDF (canonical bbox-format, see ARTIFACTS_MAP.md).
  // Populated by Task 3 (policy ingestion) when the policy came from a PDF; null for hand-curated demo policies.
  sourceBboxes    Json?    // array of { document_name, page_number (int, 1-indexed), bbox: [[...]], line_numbers? }
  sourceLineNumbers Int[]  // top-level convenience
}
```

### Prior auth + state
```prisma
model PriorAuth {
  id            String   @id @default(cuid())
  encounterId   String
  encounter     Encounter @relation(fields: [encounterId], references: [id])
  providerId    String
  provider      Provider @relation(fields: [providerId], references: [id])
  payerId       String
  payer         Payer    @relation(fields: [payerId], references: [id])
  status        String   // see WORKFLOW.md states
  statusReason  String?
  priority      String   @default("standard")  // "standard" | "expedited" | "urgent"
  priorityRationale String?                    // required when priority != "standard"
  trackingId    String?  // returned by simulator at submission
  submittedAt   DateTime?
  pendingSubmissionExpiresAt DateTime? // 60-day timer
  payerExpiresAt DateTime?              // payer-side approval validity
  simulatorNextTransitionAt DateTime?   // simulator tick target; null when not in-flight
  codes         PriorAuthCode[]
  criteriaResults CriterionResult[]
  attachments   Attachment[]
  events        PaEvent[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([status])
}

model PriorAuthCode {
  id          String   @id @default(cuid())
  priorAuthId String
  priorAuth   PriorAuth @relation(fields: [priorAuthId], references: [id])
  codeType    String   // "CPT", "HCPCS", "J", "Q", "ICD10"
  code        String
  modifier    String?
  description String
  isPrimary   Boolean  // primary procedure vs accompanying dx
  derivedBy   String   // "ai" | "provider" | "ai-then-confirmed"
  confidence  Float?   // AI confidence at time of derivation
}

model CriterionResult {
  id              String   @id @default(cuid())
  priorAuthId     String
  priorAuth       PriorAuth @relation(fields: [priorAuthId], references: [id])
  criterionId     String
  criterion       PolicyCriterion @relation(fields: [criterionId], references: [id])
  status          String   // "passed" | "failed" | "needs_info" | "manual_override"
  rationale       String?  // AI explanation
  confidence      Float?
  citations       Citation[]
  evaluatedAt     DateTime @default(now())
}

model Citation {
  id                 String   @id @default(cuid())
  criterionResultId  String
  criterionResult    CriterionResult @relation(fields: [criterionResultId], references: [id])
  sourceType         String   // "clinical_note" | "attachment" | "policy_pdf"
  sourceId           String   // FK into ClinicalNote, Attachment, or Policy
  // Canonical evidence-citation shape (see penguinai-claude-artifacts-main/.claude/contracts/evidence-citation.md).
  // Stored as-is; API and UI consume identically (zero-transform rule).
  supportingTexts    String[] // verbatim OCR / note excerpts
  reasoning          String?  // LLM explanation
  confidence         Float    // 0.0 - 1.0
  bboxes             Json     // array of { document_name, page_number (int, 1-indexed), bbox: [[x1,y1,...,x4,y4]], line_numbers?: int[] }
  lineNumbers        Int[]    // OCR line numbers (top-level convenience; full per-bbox values live in bboxes JSON)
}

model Attachment {
  id          String   @id @default(cuid())
  priorAuthId String
  priorAuth   PriorAuth @relation(fields: [priorAuthId], references: [id])
  kind        String   @default("upload")  // "upload" | "submission_packet" | "rfi_response"
  filename    String
  mimeType    String
  storageUrl  String
  uploadedBy  String   // provider id or "system"
  uploadedAt  DateTime @default(now())
  extractedText String?  // text extracted at ingestion time, for re-runs
  pageImages    Json?    // pdfviewer-data shape (files, presigned_urls); populated by sidecar /ingest-attachment after OCR + page-image generation
  ocrLineCount  Int?     // count of OCR lines in extractedText; mirrors CachedDocumentReference.ocrLineCount
  @@index([priorAuthId, kind, uploadedAt])
}

model PaEvent {
  id           String   @id @default(cuid())
  priorAuthId  String
  priorAuth    PriorAuth @relation(fields: [priorAuthId], references: [id])
  type         String   // free-form discriminator — see "PaEvent.type values in use" below
  fromStatus   String?
  toStatus     String?
  actor        String   // provider id or "system" or "simulator"
  metadata     Json
  createdAt    DateTime @default(now())
  @@index([priorAuthId, createdAt])
}
```

#### `PaEvent.type` values in use

`PaEvent.type` is intentionally a free-form `String` (not a Prisma enum) so adding a new audit-event class doesn't require a migration. The values currently emitted across the codebase are listed below; any new value MUST be added to this table in the same change that emits it (CLAUDE.md "Hard rules" applies — `ARCHITECTURE.md` is canonical).

| `type` value | Emitter (file:line region) | Semantics |
|---|---|---|
| `status_change` | `lib/statusMachine/applyTransition.ts:48` | Every PA state transition. `fromStatus` + `toStatus` populated. |
| `pa_created` | `app/api/pa/route.ts:49`, `app/api/pa/initiate/route.ts:147` | PA row first inserted (from encounter / from FHIR-initiated flow). |
| `codes_updated` | `app/api/pa/[id]/codes/route.ts:39` | Provider edits derived codes. Metadata carries diff. |
| `priority_changed` | `app/api/pa/[id]/priority/route.ts:69` | Priority transitioned (Standard / Expedited / Urgent) pre-submission. |
| `upload` | `app/api/pa/[id]/upload/route.ts:54` | Provider or MA attached a document. `Attachment` row id is in metadata. |
| `rfi_response` | `app/api/pa/[id]/rfi-respond/route.ts:29` | Provider replied to a payer RFI. Distinct from the `status_change` that returns the PA to In Progress. |
| `criterion_evaluated` | `lib/policies/matchEngine.ts:358` | AI evaluated a single criterion via `extract_evidence_for_criterion`. Metadata carries result + confidence + prompt version. |
| `criterion_override` | `app/api/pa/[id]/criteria/[cid]/override/route.ts:76` | Provider manually overrode a `failed` / `needs_info` criterion. **Audit discriminator vs AI-derived `passed`** — see WORKFLOWS.md `WF-PROV-manual-override`. |
| `document_triage_completed` | `lib/policies/matchEngine.ts:258` (Phase 6 T5) | Triage layer narrowed the candidate corpus for evidence extraction. Metadata carries kept/filtered counts + cost-reduction telemetry. |
| `document_triage_skipped` | `lib/policies/matchEngine.ts:281` (Phase 6 T5) | Triage gating bypassed (no `CachedDocumentReference` rows with `pdfUrl IS NOT NULL` for this PA — Phase 3 legacy corpus path runs). |

`PaEvent.type` values reserved but not currently emitted (planning text references them — keep available for forward compatibility): `audit_note` (free-form provider annotation), `code_added` (subsumed by `codes_updated`), `submit` (subsumed by the `status_change` that walks `ready_for_submission` → `pending`), `comment` (medical-assistant comments per `WF-MA-pre-screen`).

### Reference code data
```prisma
model CodeReference {
  id          String  @id @default(cuid())
  codeType    String  // "ICD10" | "CPT" | "HCPCS"
  code        String
  description String
  category    String?
  effectiveFrom DateTime?
  effectiveTo   DateTime?
  @@unique([codeType, code])
}
```

### Auth — SMART on FHIR session (Phase 6)

```prisma
model SmartSession {
  id               String    @id @default(cuid())
  sessionToken     String    @unique  // HMAC-signed cookie value; lookups go through @unique
  iss              String              // Epic FHIR base URL for this session's tenant
  accessTokenEnc   String              // AES-256-GCM ciphertext (base64) — APP_TOKEN_ENCRYPTION_KEY
  refreshTokenEnc  String?             // optional — present only if Epic returned offline_access
  idTokenEnc       String?
  expiresAt        DateTime
  fhirUser         String              // e.g. "Practitioner/abc123" — claim from Epic id_token
  patientContext   String?             // launch context — set on EHR launch with patient
  encounterContext String?             // launch context — set on EHR launch with encounter
  scope            String              // space-delimited GRANTED scopes (Epic echoes a subset)
  createdAt        DateTime  @default(now())
  lastUsedAt       DateTime  @default(now())
  revokedAt        DateTime?
  @@index([fhirUser, revokedAt])
}
```

Replaces the Phase 4 hardcoded session cookie (`lib/auth/session.ts`, removed in `phase-6-integration`). Every authenticated request carries a SMART-issued OAuth 2.0 access token; `getCurrentSession()` reads the session row by signed cookie value, decrypts `accessTokenEnc` only at FHIR-call time, and never serializes any *Enc field across an API boundary. Token refresh is silent on near-expiry; refresh failure revokes the session and redirects to `/launch?iss={iss}`.

Token encryption is AES-256-GCM keyed off the `APP_TOKEN_ENCRYPTION_KEY` env var (32-byte key). Plaintext tokens never land in audit logs, error messages, or API responses. Migration: `0004_smart_session` (Phase 6).

## API surface (initial)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/encounters` | Ingest a mock encounter (loads patient, notes, orders) |
| `POST` | `/api/pa` | Create a new PA from an encounter |
| `GET`  | `/api/pa/:id` | Fetch full PA detail (codes, criteria, citations, events) |
| `POST` | `/api/pa/:id/codes` | Update derived codes (provider corrections) |
| `POST` | `/api/pa/:id/recheck` | Re-run evidence extraction across all criteria |
| `POST` | `/api/pa/:id/upload` | Attach a document (storageKey + extractedText); auto-triggers recheck |
| `GET`  | `/api/pa/:id/attachments/:attachmentId/file` | Auth-checked binary stream of an uploaded document (proper Content-Type) |
| `PATCH` | `/api/pa/:id/priority` | Update priority + rationale before submission. Validates rationale required for Expedited/Urgent. Records `priority_changed` audit event. Returns 422 once status is past `ready_for_submission`. |
| `POST` | `/api/pa/:id/submission-packet` | Generate (or regenerate) the submission-packet PDF; returns `{pdfUrl, attachmentId, generatedAt, narrativeParagraph}`. Page 1 includes inline Priority line (when not standard) + an "ATTACHED DOCUMENTS" list of cited docs. The internal criteria checklist is no longer rendered. Following pages contain only the cited clinical notes + uploads. |
| `POST` | `/api/pa/:id/submit` | Submit to payer simulator |
| `POST` | `/api/pa/:id/withdraw` | Provider withdrawal (post-submission) |
| `POST` | `/api/pa/:id/void` | Provider void (pre-submission) |
| `POST` | `/api/pa/:id/cancel` | Patient cancellation |
| `POST` | `/api/pa/:id/park` | Move to Pending Submission |
| `POST` | `/api/pa/:id/resume` | Move from Pending Submission back to Draft |
| `POST` | `/api/simulator/webhook` | Inbound from payer simulator |
| `GET`  | `/api/queue` | Provider work queues |

## Integration points (designed but mocked)

### EHR ingestion adapter (`lib/ehr/`)
Interface:
```ts
interface EhrAdapter {
  fetchEncounter(encounterId: string): Promise<EncounterPayload>;
  fetchPatient(patientId: string): Promise<PatientPayload>;
  fetchNotes(encounterId: string): Promise<ClinicalNotePayload[]>;
}
```
Mock implementation reads from JSON fixtures. Real implementations: SMART on FHIR, Epic FHIR, Cerner Millennium.

### Payer submission adapter (`lib/payer/`)
Interface:
```ts
interface PayerAdapter {
  submit(pa: PriorAuthSubmission): Promise<SubmissionAck>;
  cancel(trackingId: string): Promise<void>;
  fetchStatus(trackingId: string): Promise<PayerStatus>;
}
```
Mock implementation hits the in-process simulator. Real implementations: X12 278 over clearinghouse, FHIR Da Vinci PAS.

## Status simulator (`lib/payer/simulator.ts`)

A small in-process state machine that records submitted PAs and walks them through transitions on a timer (driven by Vercel Cron, polling every 10 seconds in dev and every 60 seconds in production-mock). Outcome script per PA is determined at submission time based on a scenario tag attached to the encounter (so demo scenarios are deterministic).

For the demo, the simulator also exposes a "fast-forward" admin endpoint: `POST /api/simulator/fast-forward` accelerates all in-flight PAs to their next state immediately.

## Audit log

Every meaningful action writes a `PaEvent` row. UI surfaces these in a chronological timeline on the PA detail page. The event log is append-only; nothing in the system updates or deletes events.

## Deployment

Two services, one DB:

- **Next.js** on Vercel.
- **Python AI service** (FastAPI) on Railway / Render / Fly. Repo path: `services/ai/`. Exposes `/derive-codes`, `/extract-evidence-criterion`, `/ingest-policy`, `/ocr-document` (shared OCR helper used by ingestion + uploads), `/generate-submission-packet`, `/health`. Auth between the two services is a shared bearer token from `AI_SERVICE_TOKEN` env var.
- **Postgres** shared (Vercel Postgres or Supabase). The Python service reads/writes the AI cache table; everything else is Prisma-owned from Next.js.
- **Cron** via Vercel Cron, hitting Next.js routes — the simulator and 60-day expiration sweep don't need to live in the Python service.

### SDK install (Python service)

The Penguin SDK ships as a bundled wheel inside the vendor artifacts directory:

```bash
# Mac/laptop (CPU torch first)
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install "../penguinai-claude-artifacts-main/packages/penguin_ai_sdk-0.2.0-py3-none-any.whl[cpu]"
```

Pin the wheel path in `services/ai/pyproject.toml` so CI installs deterministically. Other Python deps: `fastapi`, `uvicorn`, `pydantic>=2`, `pymupdf` (for PDF page-dimension lookup during bbox normalization), `httpx`, `loguru`.

### Local dev

`pnpm dev` runs Next.js on `:3000`. `uvicorn services.ai.main:app --reload --port 8000` runs the AI service. `AI_SERVICE_URL=http://localhost:8000` in `.env.local` wires them up.

**Policy ingestion CLI** — `pnpm policies:ingest` runs `scripts/ingest-uhc-policies.ts`, which scans `UHC/medical-policies/` for `*-cs.pdf` files (UHC criteria summaries), OCRs each via Textract, extracts criteria with Claude Sonnet, and upserts Policy + PolicyCriterion rows into the DB. Flags: `--limit N` (first N files only), `--dry-run` (extract but skip DB write), `--force` (re-ingest even if policy already exists). Requires the FastAPI sidecar to be running. Estimated cost: ~$12 for all 242 files.

### Env vars

The AI service expects:
- `AI_SERVICE_TOKEN` — shared bearer for Next.js → AI auth.
- `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (or instance role) — Bedrock + Textract.
- `S3_OCR_STAGING_BUCKET` — name of an S3 bucket Textract uses to stage PDFs during async processing. User-owned, same region as Bedrock recommended. Apply a 7-day lifecycle rule.
- `LANGFUSE_*` — optional. When set, every `create_model` call is auto-traced. Off by default for the demo.
- `PENGUIN_LLM_PROVIDER=bedrock`, `PENGUIN_LLM_MODEL=claude-sonnet-4-5` — friendly model name; SDK resolves to the inference profile ID.

## Auth (mocked for hackathon)

A single seeded provider account auto-logged-in on every request via a hardcoded session cookie. Real auth (SSO / SMART on FHIR launch) is out of scope but the `Provider` table is designed to support it.
