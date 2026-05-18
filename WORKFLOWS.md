# Workflows

The full inventory of user workflows the production app must support. Use this as the source-of-truth for: (a) UI design, (b) test-case derivation in `TESTING.md`, (c) per-ticket scope confirmation in the phase task files.

Every workflow has:
- A **persona** (who is doing it)
- A **trigger** (what kicks it off)
- The **steps** (numbered, atomic, observable)
- The **success state** (how we know it worked)
- The **failure modes** the system must handle gracefully
- A **TC-ID prefix** for the test matrix (`WF-<persona>-<short-name>`)

If a subagent encounters a flow that isn't here, they STOP and ask the orchestrator before inventing one. New flows go into this doc, then get tickets, then get implemented.

---

## Personas

| Code | Persona | What they do |
|---|---|---|
| `PROV` | Provider (clinician — MD/DO/NP/PA) | Orders care, reviews PA criteria, makes clinical judgment calls, signs the submission |
| `MA` | Medical Assistant / Clinic Coordinator | Pre-screens PAs before provider review; gathers documents; manages the parked queue |
| `BIL` | Billing / Coding Specialist | Verifies codes; tracks aging PAs; reconciles approved PAs against billed services |
| `INF` | Clinical Informaticist | Reviews + publishes AI-extracted policies; tunes evidence hints; monitors AI accuracy |
| `ADM` | Org Admin | Manages users, roles, payer connections, org settings |
| `SYS` | System (cron / event-driven) | Background jobs that aren't user-driven |

---

## PROV — Provider workflows

### WF-PROV-launch-ehr — Launch the app from inside Epic

- **Trigger:** Provider clicks the "Provider PA" tile in Epic Hyperspace/Hyperdrive sidebar while viewing a patient's chart.
- **Steps:**
  1. Epic redirects browser to `https://<our-app>/launch?iss=<EpicFHIR>&launch=<launchToken>`.
  2. Our `/launch` page calls SMART discovery, generates PKCE, redirects to Epic's `/oauth2/authorize`.
  3. Provider auths (or has SSO session in Epic).
  4. Epic redirects to our `/api/auth/smart/callback` with code + state.
  5. We exchange for tokens, persist `SmartSession`, set HMAC-signed cookie.
  6. We resolve `Practitioner` from the `fhirUser` claim and ensure a `Practitioner` row exists in our DB.
  7. We resolve `Patient` from the launch context (`patient` claim in the token response).
  8. We resolve `Encounter` from the launch context (`encounter` claim, when present).
  9. We sync `Patient`, `Encounter`, `Coverage`, `ServiceRequest` for the encounter via `lib/domain/syncFromFhir.ts`.
  10. Branch:
      - If a `PriorAuth` already exists for this `Encounter` → redirect to `/pa/{paId}`.
      - If a `ServiceRequest` exists for this encounter that requires PA but no PA yet → redirect to `/encounter/{encounterId}` with auto-create CTA.
      - Otherwise → redirect to `/queue?encounter={encounterId}`.
- **Success:** provider lands on the right screen with the right patient/encounter context, no manual context selection required.
- **Failure modes:**
  - Bad `state` (CSRF / replay) → 400 page with retry link
  - Bad `aud` (Epic rejects) → friendly error explaining the launch was malformed; log for support
  - User denies consent → redirect to a "consent required" page with retry option
  - Token exchange 5xx from Epic → exponential-backoff retry (3 tries) then user-facing error
  - `fhirUser` claim points at a non-Practitioner (e.g. RelatedPerson) → reject with "this app is for clinicians only"
  - Patient context is missing on EHR launch (Epic config wrong) → redirect to standalone launch flow with `iss` preserved

### WF-PROV-launch-standalone — Open the app outside Epic

- **Trigger:** Provider opens `https://<our-app>` in a browser tab while not in Epic.
- **Steps:** identical to `WF-PROV-launch-ehr` except (a) provider sees Epic's patient picker after auth (because no `launch` parameter); (b) the app then asks "which encounter?" via a list of recent encounters for that patient (FHIR `Encounter?patient={id}&_sort=-date&_count=20`).
- **Success:** provider lands on `/queue?encounter={encounterId}` after picking a patient + encounter.
- **Failure modes:** Epic patient picker fails → friendly error, retry; provider has no recent encounters for the picked patient → empty-state messaging with "create from new order" link.

### WF-PROV-token-refresh — Silent token refresh during a session

- **Trigger:** any authenticated request when access token has < 60s of remaining life.
- **Steps:** middleware detects expiry → calls Epic's `/oauth2/token` with refresh_token grant → swaps tokens in `SmartSession` row → request continues. User sees nothing.
- **Failure modes:** refresh token revoked/expired → middleware redirects to `/launch?iss={iss}` preserving the intended destination; on landing back, the original action resumes if possible.

### WF-PROV-encounter-pa-create — Create a PA from a new order

- **Trigger:** provider on `/encounter/{id}` sees a `ServiceRequest` flagged "PA may be required" (informed by Da Vinci CRD or our policy lookup against the SR's procedure code + Coverage tuple).
- **Steps:**
  1. Provider clicks "Start prior authorization."
  2. Backend creates a `PriorAuth` row tied to the encounter + service request, status=`Draft`.
  3. Backend kicks off (in parallel):
     - **Code derivation** (Phase 3) against the encounter's clinical notes via `services/ai/code_derivation.py`.
     - **Document fetch** of relevant `DocumentReference` resources for this encounter from FHIR.
     - **Policy lookup** against the (code, payer, plan) tuple from the encounter's coverage.
  4. UI renders skeleton state for ~2-5s while these resolve.
  5. Provider lands on `/pa/{paId}` with derived codes + criteria checklist + supporting documents listed.
- **Success:** provider reaches the PA detail screen with a populated checklist and at least the primary procedure code visible.
- **Failure modes:** code derivation fails → provider sees "AI couldn't derive codes — please enter manually" + manual entry UI; policy lookup returns no matching policy → "PA may not be required for this code under this plan" with confirmation override.

### WF-PROV-code-review — Review and correct AI-derived codes

- **Trigger:** provider lands on a `Draft` PA with derived codes.
- **Steps:**
  1. UI shows each procedure code (CPT/HCPCS/J/Q) with description, AI confidence pill (green ≥0.85, yellow 0.5–0.85, red <0.5), and a "rationale" tooltip explaining why the AI derived it.
  2. Same for diagnosis codes (ICD-10), with a "primary" toggle.
  3. Provider can: edit a code, delete a code, add a code (typeahead against `CodeReference`), toggle primary diagnosis, add a modifier.
  4. Every change calls `POST /api/pa/{id}/codes` and writes a `PaEvent` of type `code_changed` with the actor and the diff.
  5. Provider clicks "Confirm and continue" → status stays `Draft` but transitions sub-state to `criteria-evaluating`.
- **Success:** codes locked, audit trail records every change.
- **Failure modes:** typeahead returns no matches → free-text entry allowed with a warning; provider tries to confirm with no primary diagnosis → blocked.

### WF-PROV-evidence-checklist — Review the AI-evaluated criteria

- **Trigger:** code review confirmed; system has run policy-criterion evaluation.
- **Steps:**
  1. UI shows an ordered checklist (one row per `PolicyCriterion`).
  2. Each row has: status icon (passed/failed/needs_info/manual_override), criterion text, AI confidence band, expand-to-see-citations.
  3. Provider clicks a citation → opens `DocumentPdfViewer` with the source document and bbox highlighted on the right page.
  4. Above the checklist, a summary: "X of Y criteria passed. Z need attention."
  5. For criteria not passed: provider can (a) upload a document → triggers recheck; (b) manually override with rationale → criterion marked passed with `manual_override` status; (c) park for later.
- **Success:** provider can move forward when all criteria are green (passed or override-passed).
- **Failure modes:** AI evidence extraction failed mid-flow → row shows "AI couldn't evaluate — manually mark or skip" with an alert; citation source fails to load → modal shows error, citation row stays clickable for retry.

### WF-PROV-citation-jump — Click citation, see source PDF with highlight

- **Trigger:** provider clicks any citation chip on a criterion row.
- **Steps:**
  1. `CitationViewer` modal opens, takes the citation's `bboxes` JSON.
  2. Loads `DocumentPdfViewer` with `documentData` from the cited `CachedDocumentReference` (`pageImages` JSON).
  3. Auto-scrolls to `bbox.page_number`; renders bbox highlight.
  4. Provider can scroll, zoom, navigate pages of the source.
- **Success:** highlighted excerpt is visible and matches the citation's `supporting_texts`.
- **Failure modes:** page image fails to load (presigned URL expired) → "Refreshing source…" → backend regenerates URLs → retries; bbox is malformed → highlight skipped, document still opens.

### WF-PROV-document-upload — Upload a missing document

- **Trigger:** provider clicks "Upload" on a missing-evidence criterion row.
- **Steps:**
  1. Drag-drop or file picker; accepts PDF / JPG / PNG / TXT / DOCX.
  2. Frontend POSTs to `/api/pa/{id}/upload` (multipart).
  3. Backend creates an `Attachment` (schema default `kind='upload'`, Phase 3 addition migration `0003_attachment_kind`) AND a `CachedDocumentReference` row (so the document flows through OCR + bboxes pipeline like FHIR-sourced docs). The other `kind` values in current use are `rfi_response` (RFI uploads via `WF-PROV-rfi-respond`) and `submission_packet` (the generated PDF). Earlier planning copy used `provider_upload` as the discriminator; the implemented schema default is `upload`.
  4. Backend triggers `recheck` — runs document triage + evidence extraction across **all** criteria (not just the one tied to the upload).
  5. UI shows a "rechecking…" state across the whole checklist for ~5–10s.
  6. UI re-renders with new pass/fail and any new citations pointing at the upload.
- **Success:** at least one criterion now passes (or is closer to passing) due to the new evidence.
- **Failure modes:** upload >10MB → reject with size error; OCR fails (corrupt PDF) → upload preserved, criterion remains in pre-upload state, error surfaces; AI evidence extraction times out → result downgraded to `needs_info` with "AI couldn't analyze this — please review manually."

### WF-PROV-manual-override — Override a criterion with rationale

- **Trigger:** provider clicks "Manual override" on a `failed` or `needs_info` criterion row.
- **Steps:**
  1. Modal opens asking for a free-text rationale (required, ≥1 character; UI advisory ≥20).
  2. Provider types the clinical rationale.
  3. Submits → backend (`app/api/pa/[id]/criteria/[cid]/override/route.ts`) writes `CriterionResult.status='passed'` with the rationale + `confidence=1.0`, deletes any prior AI citations on that row, and emits `PaEvent.type='criterion_override'` carrying `{criterionId, criterionResultId, rationale}`. The audit-event discriminator (`criterion_override` vs the AI-derived `criterion_evaluated`) is how override-vs-AI passes are distinguished downstream — `CriterionResult.status` itself is the same `passed` enum value in both cases.
  4. UI marks the criterion green with a distinct "Override" badge.
  5. Override appears on page 2 of the submission packet alongside cited evidence.
- **Success:** criterion is satisfied for the purposes of moving forward; the override is auditable.
- **Failure modes:** rationale too short → form validation; provider tries to override after submit → blocked (post-submission edits not allowed).

### WF-PROV-park-resume — Park for later, then resume

- **Trigger:** provider clicks "Park for later" anywhere on the PA detail screen.
- **Steps (park):**
  1. Backend transitions `PriorAuth.status` Draft → `Pending Submission`.
  2. Sets `pendingSubmissionExpiresAt = now + 60 days`.
  3. Audit event written.
  4. Routes to `/queue?bucket=parked`.
- **Steps (resume):**
  1. Provider on `/queue?bucket=parked` clicks a parked PA.
  2. Backend transitions `Pending Submission` → `Draft`.
  3. Re-runs evidence extraction (chart may have new docs since parking).
  4. Provider lands on `/pa/{id}` with refreshed checklist.
- **Failure modes:** PA expired (60 days passed without resume) → status auto-transitioned to `Expired` by the cron sweep; provider sees terminal state, can clone to start fresh.

### WF-PROV-submission-packet-review — Review the assembled submission packet

- **Trigger:** all criteria green; provider clicks "Continue to review."
- **Steps:**
  1. Backend kicks off submission packet generation if not yet present (Phase 2.5 cover-letter ticket).
  2. UI shows two panels: left = read-only summary of codes + criteria + citations; right = `DocumentPdfViewer` rendering the packet PDF.
  3. Provider scrolls through the packet preview: page 1 cover letter (header + patient block + LLM narrative + procedure codes + inline Priority line + ATTACHED DOCUMENTS list + signature), page 2+ supporting clinical notes and uploads. The earlier plan included a separate criteria-checklist page; the implemented packet folds that material into the cover letter and starts cited documents at page 2 (see `app/api/pa/[id]/submission-packet` and `ARCHITECTURE.md` API surface).
  4. If unhappy with the cover letter narrative, click "Regenerate packet" → backend re-runs `cover_letter_v1` LLM call → preview re-renders with new narrative.
  5. Submit button enabled (was disabled until packet exists).
- **Success:** provider can read the packet end-to-end and is satisfied.
- **Failure modes:** packet generation fails (LLM down) → use canned-fallback narrative; provider regenerates and gets identical result → cache hit warning.

### WF-PROV-submit — Submit the PA to the payer

- **Trigger:** provider on `/pa/{id}/review` clicks "Submit to payer."
- **Steps:**
  1. Confirmation modal: "This will send the assembled PDF to {payer name}. Continue?"
  2. Backend transitions `Ready for Submission` → `Pending`, sets `submittedAt`, calls `lib/payer/submit.ts` (currently the mock; Phase 8 swaps for real X12/PAS).
  3. Mock simulator records tracking id, schedules state-machine ticks per scenario script.
  4. Backend writes `PaEvent` `submitted`.
  5. UI redirects to `/pa/{id}/tracker`.
- **Success:** PA in `Pending` state, tracker shows "Awaiting payer review."
- **Failure modes:** submission HTTP fails → status stays `Ready for Submission`, error toast, retry CTA; payer rejects on submit (mock or real) → `PaEvent` records the rejection reason, status stays in pre-submission with corrective-action affordance.

### WF-PROV-tracker-watch — Watch the post-submission status

- **Trigger:** PA in `Pending` / `In Progress` / `RFI` state; provider on `/pa/{id}/tracker`.
- **Steps:**
  1. UI displays large status pill, expected-next-state line, live audit timeline.
  2. Polls `/api/pa/{id}` every 2s while state is non-terminal; pauses polling when tab is hidden.
  3. On state transition, timeline animates the new event.
  4. Terminal state (Approved / Denied / Partial / etc.) → polling stops, "Back to queue" CTA appears.
- **Success:** terminal state reached; provider sees the outcome with rationale.
- **Failure modes:** polling network failure → exponential backoff, "Connection lost — retrying…" state.

### WF-PROV-rfi-respond — Respond to a payer RFI

- **Trigger:** simulator (or real payer) transitions `In Progress` → `RFI`. Provider sees notification + tracker shows `RFI` with the payer's question.
- **Steps:**
  1. UI shows a callout with the RFI message ("Please clarify amitriptyline trial duration — appears <8 weeks").
  2. Provider clicks "Respond."
  3. Modal: free-text response + optional document upload.
  4. Submit → backend creates an `Attachment` `kind="rfi_response"`, transitions RFI → In Progress, fires the response to the payer (mock or real), writes `PaEvent`.
  5. Tracker resumes polling.
- **Success:** RFI response delivered; status returns to `In Progress`; eventually transitions to `Approved` (or `Denied`).
- **Failure modes:** response submission fails → status stays `RFI`, retry CTA; provider tries to respond after RFI was withdrawn by payer → blocked.

### WF-PROV-withdraw-cancel-void — Pull back a PA

- **Trigger:** provider determines the PA is no longer needed.
- **Variants:**
  - **Withdraw** (post-submission): provider pulls back from payer review. PaStatus → `Withdrawn`.
  - **Void** (pre-submission): provider cancels their own request. → `Voided`.
  - **Cancel** (any time): patient declines the service. → `Cancelled`.
- **Steps:** confirm modal → API call → audit event → terminal state → back to queue.
- **Failure modes:** provider tries to withdraw an already-terminal PA → blocked.

### WF-PROV-queue-browse — Browse the work queue

- **Trigger:** provider on `/queue`.
- **Steps:**
  1. Three tabs (`components/pa/QueueTabs.tsx`): **Action needed** (Drafts + `Ready for Submission` + `RFI`), **Parked** (`Pending Submission`), **Submitted** (`Pending` / `In Progress` plus adjudicated outcomes — Approved/Denied/Partial — for recency context). The "Recently completed" bucket from earlier planning was folded into Submitted to keep the tab count to three; terminal outcomes still surface via sort + filter on that tab.
  2. Each tab is a sortable, paginated table.
  3. Click row → routes to `/pa/{id}` (or `/pa/{id}/tracker` for in-flight).
  4. Empty states per bucket with friendly CTA.
- **Success:** provider can find and resume any of their active PAs.
- **Failure modes:** zero rows in any bucket → empty-state with "Start from /demo or new encounter" CTA (in non-Epic launch); pagination network failure → graceful retry.

### WF-PROV-audit-timeline — View the audit timeline of a PA

- **Trigger:** provider on `/pa/{id}` clicks "History" (or always-visible right rail).
- **Steps:**
  1. UI renders a chronological list of `PaEvent` rows: code changes, criterion evaluations, uploads, status transitions, AI calls, manual overrides.
  2. Each event shows: timestamp, actor (provider name / "system" / "simulator"), type, metadata.
  3. AI events show the model + prompt version + confidence; manual overrides show the rationale.
- **Success:** every action that touched the PA is visible and attributable.
- **Failure modes:** very long history (>200 events) → paginated; specific event types can be filtered.

---

## MA — Medical Assistant workflows

### WF-MA-pre-screen — Pre-screen a PA before provider review

- **Trigger:** MA opens `/queue` filtered to `Draft` PAs assigned to their org.
- **Steps:**
  1. MA opens a draft PA.
  2. Reviews derived codes (read-only at this role unless org config grants edit).
  3. Reviews evidence checklist; identifies any "needs upload" items.
  4. Uploads documents they've gathered (PT records, lab results) — same flow as `WF-PROV-document-upload`.
  5. Adds a comment for the provider via a new `PaEvent type=comment`.
  6. Hand-off: status remains `Draft`, but UI flag `readyForProviderReview` set.
- **Success:** when provider opens this PA, the green/yellow/red pattern reflects MA's prep work.
- **Failure modes:** MA tries to submit (not their role) → blocked; document upload fails → standard upload error path.

### WF-MA-managed-parked — Manage the parked queue

- **Trigger:** MA on `/queue?bucket=parked&owner=team`.
- **Steps:**
  1. MA reviews PAs nearing 60-day expiration (sort by `pendingSubmissionExpiresAt asc`).
  2. For each, MA decides: ping provider, upload missing doc to unblock, or mark as void.
  3. Pinging the provider creates a notification (in-app; email when configured).
- **Failure modes:** notification system down → in-app comment still works, email retried.

---

## BIL — Billing / Coding workflows

### WF-BIL-aging-pa-monitor — Monitor aging PAs and follow up

- **Trigger:** weekly review or on-demand.
- **Steps:**
  1. Biller opens `/queue?bucket=in-flight&sort=submittedAt asc`.
  2. Identifies PAs in `Pending` / `In Progress` for >5 business days.
  3. Initiates payer follow-up (call, portal — outside the app for now).
  4. Logs follow-up via `PaEvent type=external_followup` with notes.

### WF-BIL-approved-pa-export — Export approved PAs for billing

- **Trigger:** biller wants to reconcile against today's billed services.
- **Steps:**
  1. `/reports?type=approved-pas&date={today}`.
  2. Filterable table of approved PAs with tracking ids, codes, validity windows.
  3. Export CSV / PDF.

---

## INF — Clinical Informaticist workflows

### WF-INF-policy-review — Review AI-extracted policy criteria before publishing

- **Trigger:** AI policy ingestion has produced a `policy_drafts` row (Phase 3 deferred ticket).
- **Steps:**
  1. Informaticist on `/admin/policies/drafts`.
  2. Lists all draft policies sorted by ingest date.
  3. Opens a draft → side-by-side: extracted criteria on the left, source PDF on the right (DocumentPdfViewer with the AI-generated bboxes).
  4. Edits any incorrect criterion text (typo, wrong threshold).
  5. Edits/adds `evidenceHint` per criterion to improve future extraction quality.
  6. Validates by clicking "Test against demo encounter" — runs evidence extraction with this draft against a known encounter, shows expected vs actual.
  7. Clicks "Publish" → draft is copied into `Policy` table with `publishStatus=published`, `publishedAt=now`, `publishedBy=informaticist.id`. Existing PAs on the previous version stay on the old version (effective dates).
- **Success:** the new criteria become live for new PAs against this code+payer.
- **Failure modes:** invalid edit (e.g. group operator without grouping) → form validation; publish conflicts with an active version → operator confirms takeover.

### WF-INF-criteria-accuracy-monitoring — Monitor per-criterion AI accuracy

- **Trigger:** weekly review.
- **Steps:**
  1. `/admin/policies/{id}/quality`.
  2. Shows per-criterion: total evaluations, % auto-passed, % auto-failed, % `needs_info`, % manually-overridden by providers, average confidence.
  3. High override rate signals a bad criterion text or stale evidenceHint.
  4. Informaticist edits → publishes new version.

### WF-INF-trigger-rescrape — Manually trigger payer policy rescrape

- **Trigger:** payer publishes new criteria; informaticist hears about it.
- **Steps:**
  1. `/admin/policies/{id}` → click "Re-ingest from source."
  2. Backend pulls the current policy PDF, runs `phase-3-policy-ingestion`, stages a new draft.
  3. Informaticist reviews the diff against the previous version, publishes if good.

---

## ADM — Org Admin workflows

### WF-ADM-user-management — Add a provider to the org

- **Trigger:** new provider joins the practice.
- **Steps:** admin on `/admin/users` → "Add user" → enters NPI → system fetches `Practitioner` from FHIR → assigns role (provider / MA / biller / informaticist / admin) → invite email sent.

### WF-ADM-payer-config — Configure a payer connection

- **Trigger:** new payer added.
- **Steps:** admin on `/admin/payers` → "Add payer" → selects from supported list (Phase 8: real connectors) → configures org-specific settings (which clinics, which Coverage products, contract effective dates).

### WF-ADM-org-dashboard — View org-level metrics

- **Trigger:** admin on `/admin/dashboard`.
- **Steps:** sees org-wide PA volume, average turnaround time, approval rate, top denied codes, AI extraction accuracy. Phase 10+; placeholder UI in Phase 6.

---

## SYS — System / background workflows

### WF-SYS-cron-simulator-tick — Payer simulator state walker

- **Trigger:** Vercel Cron, every 60s in production-mock, every 10s in dev.
- **Steps:** `lib/payer/simulator.ts` `runSimulatorTick(prisma, now)` selects in-flight PAs whose `nextTransitionAt <= now`, applies the next scripted transition through `statusMachine.transition()`, audit-logs.

### WF-SYS-cron-pendingsubmission-sweep — 60-day expiration sweep

- **Trigger:** Vercel Cron daily at 02:00 UTC.
- **Steps:** select `PriorAuth.status='Pending Submission' AND pendingSubmissionExpiresAt <= now` → call `transition(..., {type: 'sixty_day_timer'})` → status `Expired` (terminal) → audit-log.

### WF-SYS-cron-policy-rescrape — Periodic payer policy refresh

- **Trigger:** weekly cron OR webhook from payer (when they publish updates and the payer supports it).
- **Steps:** for each active payer, fetch their published policy index, diff against last-seen, kick off `phase-3-policy-ingestion` for any changed policies, stage drafts, notify informaticists.
- **Phase:** Phase 7+ (deferred).

### WF-SYS-document-triage-cache-warm — Pre-warm document triage on PA creation

- **Trigger:** new `PriorAuth` row created (event-driven, not cron).
- **Steps:** background job pulls all `DocumentReference`s for the patient + encounter, runs document triage (Phase 6 ticket 6), persists results in `ai_call_cache`. By the time the provider opens the PA detail screen, evidence extraction has its corpus picked.

---

## Cross-cutting workflows

### WF-X-recheck-loop — The upload-and-recheck loop (canonical pattern)

Already covered under `WF-PROV-document-upload` and `WF-MA-pre-screen`. Documenting the canonical pattern here so subagents can reference it:

1. New evidence (FHIR DocumentReference, provider upload, RFI response) lands in `CachedDocumentReference`.
2. Document triage runs (cheap, Haiku) — scores all docs against all criteria.
3. For criteria whose top-K relevant docs changed, evidence extraction reruns (expensive, Sonnet).
4. Faithfulness validator checks every supporting_text is a substring of its source.
5. `CriterionResult` rows updated; `PaEvent type=criterion_evaluated` written for each affected criterion.
6. UI re-renders.

This pattern runs on:
- Provider upload (`WF-PROV-document-upload`)
- RFI response (`WF-PROV-rfi-respond`)
- Park resume (`WF-PROV-park-resume`)
- New chart documents arriving via FHIR webhook (Phase 8+)

### WF-X-fhir-data-sync — When FHIR data changes mid-PA

- **Trigger:** between PA creation and submission, the patient's chart updates in Epic (new lab, new note).
- **Steps:**
  1. We don't poll continuously. Instead: every time the provider returns to the PA detail screen, we revalidate `Encounter` + `DocumentReference` indexes against FHIR.
  2. If new `DocumentReference`s exist, we surface a banner: "3 new documents added since you last viewed. Run recheck?"
  3. Provider clicks → triage + extraction reruns.
- **Failure modes:** Epic is unreachable → use cached data, banner says "Couldn't refresh — showing cached chart from {time}."

### WF-X-mock-fallback — Canned response fallback when AI service is down

- **Trigger:** Next.js → FastAPI call throws `AiUnreachableError`.
- **Steps:** for the three demo scenarios (encounter ids deterministic), a hardcoded canned response map provides expected output. `PaEvent` records `source=canned`. UI behaves identically.
- **Phase:** demo-only; production cuts over to retry + alert in Phase 6-compliance.

### WF-X-encounter-context-switch — Provider switches patient in Epic mid-session

- **Trigger:** provider is on `/pa/{id}` for patient A; switches to patient B in Epic; navigates to a Hyperspace tile that re-launches our app.
- **Steps:**
  1. New launch flow runs (`WF-PROV-launch-ehr`) with new `patient` context.
  2. We invalidate the prior session's patient context in `SmartSession`.
  3. Provider lands on patient B's queue/encounter, NOT patient A's PA.
- **Critical:** never persist patient A's data in a window where patient B's launch comes in. The middleware enforces this.

### WF-X-multi-procedure-pa — PA covering multiple procedures

- **Trigger:** order is for, e.g., bilateral knee MRI (CPT 73721 ×2 with RT/LT modifiers).
- **Steps:** code derivation produces multiple `PriorAuthCode` rows; criteria checklist may differ per code or be shared; submission packet's "request" block lists all codes; payer simulator may approve some and deny others (`Partial Approval` / `Partial Denial` post-submission states).

### WF-X-multi-payer-coverage — Patient with primary + secondary coverage

- **Trigger:** Coverage search returns >1 active Coverage with different `payor`.
- **Steps:** provider picks primary at PA creation; PA flows through primary's policy. Secondary is recorded but doesn't drive the criteria flow this phase. Phase 8+: COB and secondary submission.

### WF-X-mid-flight-policy-change — Policy version changes between Draft and Submit

- **Trigger:** informaticist publishes a new version of policy P; provider has a `Draft` PA on the old version.
- **Steps:**
  1. Existing PA stays on the old policy version (effectiveFrom/To handling in `lib/policies/lookup.ts`).
  2. UI shows a notice: "A newer version of this policy is available. Switch to the new version?" with diff summary.
  3. Provider can stay on old (continues with current evaluations) or migrate to new (triggers re-evaluation against new criteria).
- **Critical:** post-submission PAs are immutable — they stay on whatever version was active at submit.

---

## Edge cases & error workflows

### WF-E-token-revocation — Provider's Epic credentials are revoked mid-session

- App detects 401 with non-refreshable error.
- Force-logs-out via session revocation; redirects to `/launch`.
- Any in-progress unsaved work (e.g. typing a manual override rationale) is preserved in `localStorage` and offered on restoration after re-launch.

### WF-E-fhir-rate-limit — Epic rate-limits us

- 429 from Epic → our FHIR client backs off exponentially (3 attempts).
- If still 429 → user-visible toast "Epic is rate-limiting us — retrying…" → eventually surfaces friendly error if not resolved.

### WF-E-ai-service-down — FastAPI sidecar unreachable

- Code derivation → fall back to manual entry UI.
- Evidence extraction → use canned fallback for demo encounters; for production, downgrade affected criteria to `needs_info` with a clear "AI couldn't analyze" rationale; allow manual override.
- Submission packet → use canned narrative + skeletal layout if service is fully down.

### WF-E-bbox-render-fail — Citation bbox doesn't load

- `DocumentPdfViewer` shows the page without highlight.
- Citation chip shows a small warning indicator.
- `supporting_texts` still rendered as fallback (text-only highlight).

### WF-E-malformed-citation — AI returned a citation that doesn't validate

- Pre-display, `FaithfulnessDetector` checks every `supporting_text` is a substring of its cited source.
- Mismatches → criterion downgraded to `needs_info`, citation discarded, `PaEvent` records `citation_invalid`.
- Provider sees `needs_info` row with "AI's citation didn't match the source — please verify manually."

### WF-E-pa-stuck-state — A PA is stuck in `In Progress` for >14 days

- Daily cron flags these as "stuck"; surfaces in admin dashboard.
- Provider/biller can manually call follow-up workflow.
- Phase 8: integrate with payer status APIs for real polling.

---

## Workflow → ticket mapping (which Phase implements which workflow)

| Workflow | First implemented in |
|---|---|
| WF-PROV-launch-ehr / standalone / token-refresh | Phase 6 (`phase-6-smart-launch`) |
| WF-PROV-encounter-pa-create | Phase 6 (FHIR adapters) + Phase 4 PA creation |
| WF-PROV-code-review | Phase 4 (`phase-4-encounter-intake`) — already shipped |
| WF-PROV-evidence-checklist | Phase 4 (`phase-4-pa-detail`) — already shipped |
| WF-PROV-citation-jump | Phase 4 + Phase 6 (`phase-6-citation-viewer-pdf-only`) |
| WF-PROV-document-upload | Phase 4 (`phase-4-pa-detail`) — already shipped |
| WF-PROV-manual-override | Phase 4 (`phase-4-pa-detail`) — already shipped |
| WF-PROV-park-resume | Phase 2 (`phase-2-statemachine`) + Phase 4 |
| WF-PROV-submission-packet-review | Phase 3 (`phase-3-cover-letter`) + Phase 4 (`phase-4-review-tracker`) — already shipped |
| WF-PROV-submit / tracker-watch / rfi-respond / withdraw | Phase 4 (`phase-4-review-tracker`) — already shipped |
| WF-PROV-queue-browse / audit-timeline | Phase 4 — already shipped |
| WF-MA-pre-screen / managed-parked | Phase 7 (RBAC roles needed) |
| WF-BIL-aging-pa-monitor / approved-pa-export | Phase 10 (reporting) |
| WF-INF-policy-review / accuracy-monitoring / trigger-rescrape | Phase 7 (admin UI) |
| WF-ADM-* | Phase 7 (admin UI) |
| WF-SYS-cron-simulator-tick / pendingsubmission-sweep | Phase 2 — already shipped |
| WF-SYS-cron-policy-rescrape | Phase 7+ |
| WF-SYS-document-triage-cache-warm | Phase 6 (`phase-6-document-triage`) |
| WF-X-* | Throughout — implemented as cross-cutting concerns |
| WF-E-* | Phase 5 (error states) — partially shipped; Phase 6 hardens |

When implementing a ticket, list which workflows it touches in the PR description. Any workflow listed above that doesn't have a clear "first implemented in" is a Phase 6+ planning item that needs a ticket added before build.
