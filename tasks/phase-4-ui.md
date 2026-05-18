# Phase 4 — UI

Goal: every provider-facing screen built and wired to the API. Four agents in parallel, one per screen group. The orchestrator owns `components/ui/` (the design-system primitives — agents do not touch this directory, per the hard rule in `CLAUDE.md`).

Phase exit criteria are in `tasks/STATUS.md`.

---

## phase-4-ui-primitives — Shared UI primitives + AppShell (orchestrator)

- **Type:** inline (orchestrator)
- **Goal:** lock the design-system primitives that all four agents will compose. Includes Button, Card, Badge, StatusPill, Pill, Input, Textarea, Dropzone, Modal, Toast, Spinner, NoteHighlighter (for clinical-note citation excerpts), AppShell (header + nav + content slot).
- **Why it matters:** if every agent invents its own primitives, the UI looks inconsistent and Phase 5 polish is a nightmare.
- **Owns:** `components/ui/*`, `app/(provider)/layout.tsx` (uses AppShell).
- **Depends on:** Phase 0 design tokens.
- **Contract:**
  - Each component has a `*.stories.tsx` (or a single `app/_dev/components/page.tsx` showing every primitive in every state) so agents can see what's available.
  - StatusPill accepts every status from `CLAUDE.md` "Status model" and renders the right color + display string.
  - NoteHighlighter takes `{ sourceText, lineNumbers: number[], supportingTexts: string[] }` and renders the text with the cited lines / substrings highlighted. Used for clinical-note citations (no spatial bbox available); PDF citations use the PDFViewer instead (see `phase-4-pdfviewer`).
  - All components accept `className` for one-off overrides, but the public API is variant-driven.
  - Hard rule (re-stated in the file header): feature work does not edit `components/ui/*`. Changes here go through the orchestrator.
- **Verify:** orchestrator visits `/_dev/components` and eyeballs every primitive against the Penguin-branded design tokens.

---

## phase-4-pdfviewer — Drop in the data-labelling-library PDFViewer (orchestrator)

- **Type:** inline (orchestrator)
- **Goal:** copy the Penguin `data-labelling-library` PDFViewer into the Next.js app and wrap it in a `components/pa/PolicyPdfViewer.tsx` that takes our canonical evidence-citation shape and passes through.
- **Why it matters:** rendering policy-PDF citations with bbox highlights would otherwise be a multi-week build. The library already does it; we adopt directly per `ARTIFACTS_MAP.md`.
- **Owns:** `frontend/lib/pdf-viewer/` (copy of `penguinai-claude-artifacts-main/data-labelling-library/`), `components/pa/PolicyPdfViewer.tsx`, peer-dep installs.
- **Depends on:** Phase 0.
- **Contract:**
  - Run from repo root: `cp -r penguinai-claude-artifacts-main/data-labelling-library frontend/lib/pdf-viewer`.
  - Install peer deps: `pnpm add @mui/material @emotion/react @emotion/styled @mui/icons-material lucide-react`.
  - `components/pa/PolicyPdfViewer.tsx` (Client Component) accepts:
    ```ts
    type Props = {
      documentData: { files: string[]; presigned_urls: Record<string, Record<string, string>> };
      boundingBoxes: Array<{ document_name: string; page_number: number; bbox: number[][]; line_numbers?: number[] }>;
      className?: string;
      onPageChange?: (page: number) => void;
    };
    ```
    Pass `boundingBoxes` directly (zero-transform — our `Citation.bboxes` JSON column already matches this shape).
  - Set `userInterfaces={{ docNavigation: true, zoom: true, showFilename: true }}` — disable annotation/search until Phase 5.
  - Required parent height: wrap callsite in `<div className="h-full">` with explicit height chain (per `penguinai-claude-artifacts-main/.claude/patterns/pdfviewer-component.md`).
- **Verify:** orchestrator wires up a one-off page at `/_dev/pdfviewer` that loads a sample PDF + sample bboxes from the demo seed and confirms the bbox highlight renders on the right page at the right position.

---

## phase-4-page-images — PDF page-image generation for policy PDFs (orchestrator)

- **Type:** inline (orchestrator)
- **Goal:** at policy-ingest time, render each page of the source PDF to a PNG and store it locally (or in object storage if we add it later) so the PDFViewer has something to display. Update `Policy.sourceText` adjacent fields with a `pageImages Json` column matching the canonical `pdfviewer-data` shape: `{ files: string[], presigned_urls: { [filename]: { [page]: url } } }`.
- **Why it matters:** the PDFViewer renders `<img src=...>` per page — it can't read the raw PDF. We must pre-render to PNG.
- **Owns:** `services/ai/policy_ingestion.py` (page-image step added), Prisma `Policy` model gets `pageImages Json?` column, an API route `GET /api/policies/[id]/pdfviewer-data` that returns the canonical shape.
- **Depends on:** Phase 3 policy ingestion (deferred ticket); for the demo, hand-prerender pages for the three demo policies.
- **Contract:**
  - For each PDF policy ingested, render pages at 150 DPI via PyMuPDF: `pix = page.get_pixmap(matrix=fitz.Matrix(150/72, 150/72)); pix.save(...)`.
  - Hackathon: store under `public/policy-pdfs/{policyId}/page_{n}.png`. Production: S3 + presigned URLs. Either way the API returns the canonical `pdfviewer-data` shape.
  - For the three demo policies (which are hand-curated and have no source PDF), `pageImages` is `null` and the PA detail screen falls back to NoteHighlighter for the criterion source — that is, the policy criterion's text itself, not a bbox. This is fine for the demo.
- **Verify:** orchestrator hits `/api/policies/{id}/pdfviewer-data` for any policy with a real PDF and confirms the response matches the contract; renders successfully in the PolicyPdfViewer.

---

## phase-4-mock-auth — Mock provider session

- **Type:** inline (orchestrator)
- **Goal:** seed a single hardcoded provider session cookie per `HACKATHON_SCOPE.md`. All Phase 4 screens read the current provider from this cookie.
- **Owns:** `lib/auth/session.ts`, `app/api/_auth/login-as-demo-provider/route.ts` (sets the cookie), `middleware.ts` (route guard).
- **Depends on:** Phase 1 (provider rows seeded).
- **Contract:**
  - `getCurrentProvider()` returns the seeded provider; throws if no cookie.
  - Visiting any `(provider)` route without the cookie redirects to `/login` (a one-button page that POSTs to the route above).
- **Verify:** orchestrator clears cookies, visits `/queue`, gets redirected to `/login`, clicks "Sign in as demo provider", lands back at `/queue`.

---

## phase-4-encounter-intake — Encounter intake + code review (Agent I)

- **Type:** agent (general-purpose)
- **Goal:** the screen at `/encounter/[id]` that loads an encounter, shows derived codes, lets the provider correct/confirm, and creates the PA.
- **Why it matters:** the entry point. If this screen is wrong, no scenario starts cleanly.
- **Owns:** `app/(provider)/encounter/[id]/`, `components/pa/CodeReview.tsx`, `components/pa/EncounterSummary.tsx`.

### Subagent prompt

```
Goal: Build the encounter intake + code review screen at /encounter/[id].

Why this matters: Entry point for every demo scenario. If derived codes don't show or can't be corrected, the demo dies.

Context (already done):
- Phase 2 API: GET /api/encounters/:id returns the encounter + notes; POST /api/pa creates a PA from an encounter; POST /api/pa/:id/codes overrides derived codes.
- Phase 3 AI: code derivation runs server-side at PA creation time. The PA detail endpoint returns the derived codes with confidence + rationale.
- components/ui/* has Button, Card, Pill, Badge, Input, Spinner — use them, do not create new primitives.
- DEMO_SCENARIOS.md describes what the screen should look like for each scenario.

Your scope:
- /Users/murtaza/Documents/provider_pa/app/(provider)/encounter/[id]/
- /Users/murtaza/Documents/provider_pa/components/pa/CodeReview.tsx
- /Users/murtaza/Documents/provider_pa/components/pa/EncounterSummary.tsx

Your contract:
- Server Component for the page; Client Component for the interactive code-review form.
- Layout: left panel = patient + encounter summary + collapsible note list; right panel = derived codes (procedures + diagnoses), each with confidence pill (green ≥0.85, yellow 0.5-0.85, red <0.5), rationale tooltip, "edit" affordance.
- Provider can: edit a code, mark a code as primary, remove a code, add a code (typeahead against /api/codes/search if it exists; otherwise plain input). Submitting calls POST /api/pa/:id/codes which writes a PaEvent.
- "Continue" button creates the PA and routes to /pa/:paId.
- Loading states and error states with toasts.
- No new primitives in components/ui — use Button, Card, Pill, Badge, Input, Spinner from there.

Constraints:
- Do not edit components/ui/.
- Do not call lib/ai or services/ai directly — only API routes.
- Do not invent new statuses or actions.

When done:
- Files changed
- Screenshots of all three demo scenarios on the screen (orchestrator will compare to DEMO_SCENARIOS.md)
```

- **Verify:** orchestrator walks each demo scenario through the screen end-to-end.

---

## phase-4-pa-detail — PA detail + criteria checklist + upload (Agent J)

- **Type:** agent (general-purpose)
- **Goal:** the screen at `/pa/[id]` — checklist of criteria with pass/fail/needs_info indicators, citation click-throughs into source notes, document upload with auto-recheck, manual override.
- **Why it matters:** the most important UX in the app. Knee MRI's upload-and-recheck loop and Botox's manual override both happen here.
- **Owns:** `app/(provider)/pa/[id]/page.tsx`, `app/(provider)/pa/[id]/upload-action.ts`, `components/pa/Checklist.tsx`, `components/pa/CriterionCard.tsx`, `components/pa/CitationViewer.tsx`, `components/pa/UploadDropzone.tsx`, `components/pa/ManualOverrideModal.tsx`. Reuses `components/pa/PolicyPdfViewer.tsx` and `components/ui/NoteHighlighter.tsx` from earlier tickets.

### Subagent prompt

```
Goal: Build the PA detail screen — criteria checklist with citations, upload-and-recheck, and manual override.

Why this matters: This is the most important screen in the app. The upload-and-recheck loop (Knee MRI) and the manual override (Botox) both live here.

Context (already done):
- Phase 2 API: GET /api/pa/:id (returns PA + criteria results + citations + events); POST /api/pa/:id/recheck; POST /api/pa/:id/upload (multipart); POST /api/pa/:id/criteria/:cid/override.
- Phase 3 AI: recheck triggers evidence extraction across ALL criteria. Citation responses follow the canonical evidence-citation contract (supporting_texts[], reasoning, confidence, bboxes[], line_numbers[]).
- components/pa/PolicyPdfViewer.tsx is wired (phase-4-pdfviewer ticket). It expects {documentData, boundingBoxes} in the canonical shape — pass Citation.bboxes directly, no transformation.
- components/ui/NoteHighlighter.tsx is wired (phase-4-ui-primitives). For clinical-note citations (no spatial bboxes), pass {sourceText, lineNumbers, supportingTexts}.
- WORKFLOW.md "The upload-and-recheck loop" describes the expected interaction.
- DEMO_SCENARIOS.md describes scenario 2 (upload PT discharge) and scenario 3 (manual override on amitriptyline).

Required reading (artifacts):
- penguinai-claude-artifacts-main/.claude/patterns/pdfviewer-component.md — PDFViewer integration patterns, height-chain requirement
- penguinai-claude-artifacts-main/.claude/contracts/evidence-citation.md — citation shape you'll consume

Your scope:
- /Users/murtaza/Documents/provider_pa/app/(provider)/pa/[id]/page.tsx (Server Component)
- /Users/murtaza/Documents/provider_pa/app/(provider)/pa/[id]/upload-action.ts (Server Action for uploads)
- /Users/murtaza/Documents/provider_pa/components/pa/Checklist.tsx (Client Component)
- /Users/murtaza/Documents/provider_pa/components/pa/CriterionCard.tsx
- /Users/murtaza/Documents/provider_pa/components/pa/CitationViewer.tsx
- /Users/murtaza/Documents/provider_pa/components/pa/UploadDropzone.tsx
- /Users/murtaza/Documents/provider_pa/components/pa/ManualOverrideModal.tsx

Your contract:
- Layout: header with status pill + provider/patient summary; main = checklist; right rail = audit timeline (read from PaEvents).
- Each CriterionCard shows: status icon (green/yellow/red), criterion text, AI reasoning, confidence, citations (clickable — opens CitationViewer modal). The CitationViewer picks the right viewer based on the citation:
  - `source_type === 'policy_pdf'` (criterion source) OR any citation with non-empty `bboxes[]` → render with `PolicyPdfViewer` and pass `bboxes` directly.
  - `source_type === 'clinical_note'` or `'attachment'` → render with `NoteHighlighter` (no spatial data; highlight by line number + supporting_texts substrings).
- Failed/needs_info criteria expose two affordances: "Upload supporting document" (opens UploadDropzone) and "Manual override" (opens ManualOverrideModal — requires a free-text rationale).
- After upload: optimistic UI shows "rechecking…" with a spinner; on completion, the checklist re-renders with new results. The "rechecking" state must show across ALL criteria, since recheck re-runs all of them.
- After manual override: the criterion immediately renders as "passed (override)" with the rationale shown.
- "Park for later" button → POST /api/pa/:id/park (status → Pending Submission), routes to /queue.
- "Submit" button (visible only when all criteria green) → routes to /pa/:id/review.
- All actions write PaEvents which appear in the timeline.

Constraints:
- Do not edit components/ui/.
- Do not call AI services directly — go through the API.
- Use Server Actions for uploads (Next.js multipart).
- Confidence colors per POLICIES.md "Confidence handling".

When done:
- Files changed
- Screenshots of: (a) Knee MRI first-pass with the missing item, (b) Knee MRI after upload with all green, (c) Botox with the needs_info on amitriptyline, (d) Botox after manual override
```

- **Verify:** orchestrator walks Knee MRI end-to-end: ortho note loaded → "needs_info" on conservative therapy → upload PT discharge → all green. Then Botox: needs_info on amitriptyline → manual override → all green.

---

## phase-4-review-tracker — Ready-for-submission review + post-submission tracker (Agent K)

- **Type:** agent (general-purpose)
- **Goal:** `/pa/[id]/review` (final review before submit) and `/pa/[id]/tracker` (post-submission status timeline with simulator transitions).
- **Why it matters:** the submit moment is the demo's payoff. The tracker is what the provider watches to see the simulated approval land.
- **Owns:** `app/(provider)/pa/[id]/review/`, `app/(provider)/pa/[id]/tracker/`, `components/pa/SubmitConfirmation.tsx`, `components/pa/SubmissionPacketPreview.tsx`, `components/pa/Tracker.tsx`, `components/pa/AdminFastForward.tsx`.

### Subagent prompt

```
Goal: Build the final review screen and the post-submission tracker.

Why this matters: Submit is the payoff. The tracker is what the audience watches as the simulator advances Pending → In Progress → Approved.

Context (already done):
- Phase 2 API: POST /api/pa/:id/submit; GET /api/pa/:id (status + events + tracking id); POST /api/simulator/fast-forward (admin); POST /api/pa/:id/withdraw; POST /api/pa/:id/cancel.
- WORKFLOW.md "Status simulator behavior" defines the timing: 30s Pending→In Progress; 90s In Progress→outcome.
- DEMO_SCENARIOS.md scenario 3 ends in RFI then re-approval — your tracker must handle the RFI state with a "respond" action that calls POST /api/pa/:id/rfi/respond (an upload + note).

Your scope:
- /Users/murtaza/Documents/provider_pa/app/(provider)/pa/[id]/review/page.tsx
- /Users/murtaza/Documents/provider_pa/app/(provider)/pa/[id]/tracker/page.tsx
- /Users/murtaza/Documents/provider_pa/components/pa/SubmitConfirmation.tsx
- /Users/murtaza/Documents/provider_pa/components/pa/Tracker.tsx
- /Users/murtaza/Documents/provider_pa/components/pa/AdminFastForward.tsx

Your contract:
- Review screen (TWO-PANEL LAYOUT):
  - Left: read-only summary of codes + criteria + citations.
  - Right: **SubmissionPacketPreview** showing the generated PDF inline via the data-labelling-library PDFViewer. Pass `documentData={files:["pa-<paId>-packet.pdf"], presigned_urls: { "pa-<paId>-packet.pdf": { "1": "/submission-packets/<paId>.pdf?page=1", ... } }}`.
  - Below the preview: **"Regenerate packet"** button (calls `POST /api/pa/[id]/submission-packet` with `regenerate=true`; preview re-renders on completion).
  - "Submit to payer" button at the bottom — DISABLED until a packet exists for this PA.
- On first arrival at `/pa/[id]/review` (no existing packet): auto-trigger packet generation via `POST /api/pa/[id]/submission-packet` with `regenerate=false`. Show a loading state "Assembling submission packet..." until ready (~3-5 seconds including the LLM narrative call).
- Confirmation modal on Submit ("This will send the assembled PDF to the payer. Continue?"); "Back to checklist" button at the top.
- Tracker: large status pill, expected-next-state line ("Payer reviewer should pick this up in ~30 seconds"), live timeline of PaEvents (poll the API every 2s while in Pending or In Progress; stop polling on terminal status).
- RFI state: clear callout with the payer's RFI message, "Respond" affordance that opens an upload + note modal and POSTs to /api/pa/:id/rfi/respond, then resumes polling.
- AdminFastForward: small floating button bottom-right (visible in dev only — check NODE_ENV) that POSTs to /api/simulator/fast-forward.
- After approval: tracker shows the approval details + payerExpiresAt; "Back to queue" button.

Constraints:
- Do not edit components/ui/.
- Polling interval: 2s. Stop polling immediately on terminal status. Pause polling when the tab is hidden (visibilitychange).
- All status reads come from the API; do not derive status client-side.

When done:
- Files changed
- Screenshots of: (a) review screen with submission-packet preview rendered, (b) review screen mid-regenerate showing the loading state, (c) tracker mid-Pending, (d) tracker showing RFI for Botox, (e) tracker showing Approved
```

- **Verify:** orchestrator runs all three scenarios through the screen with the simulator at default timing, then again with fast-forward.

---

## phase-4-queue-launcher — Work queue + scenario launcher (Agent L)

- **Type:** agent (general-purpose)
- **Goal:** `/queue` (provider work queues) and `/demo` (scenario launcher).
- **Why it matters:** queue is the home screen; launcher is what the demo'er clicks to start each scenario.
- **Owns:** `app/(provider)/queue/`, `app/demo/`, `components/pa/QueueTable.tsx`, `components/demo/ScenarioCard.tsx`.

### Subagent prompt

```
Goal: Build the work queue dashboard and the demo scenario launcher.

Why this matters: Queue is the provider's home; launcher is what the demo'er clicks first. Both must be polished.

Context (already done):
- Phase 2 API: GET /api/queue?bucket={action_needed|parked|in_flight|recent}&limit&cursor returns paginated PA summaries.
- WORKFLOW.md "Provider work queues" defines the four buckets and which statuses go in each.
- Phase 1 fixtures: three demo encounters with deterministic ids ("encounter-head-ct", "encounter-knee-mri", "encounter-botox").

Your scope:
- /Users/murtaza/Documents/provider_pa/app/(provider)/queue/page.tsx
- /Users/murtaza/Documents/provider_pa/app/demo/page.tsx
- /Users/murtaza/Documents/provider_pa/components/pa/QueueTable.tsx
- /Users/murtaza/Documents/provider_pa/components/demo/ScenarioCard.tsx

Your contract:
- Queue: tabs for the four buckets (Action needed, Parked, In flight, Recently completed); each tab is a sortable table (patient, code, payer, status pill, last update, days-until-expiration for Parked); rows link to /pa/:id (or /pa/:id/tracker for in-flight).
- Each bucket lazy-loads its own data when the tab is selected. Cursor-based pagination.
- Empty states for each bucket with a friendly illustration prompt and a CTA back to /demo.
- Demo launcher: three large ScenarioCards (Head CT, Knee MRI, Botox) showing the patient summary, what the scenario demonstrates, expected demo time, and a "Start" button. "Start" POSTs to /api/encounters with the seeded encounter id, then routes to /encounter/:id.
- Header on /demo: "Demo scenario launcher — these load synthetic data and walk through a scripted PA flow."

Constraints:
- Do not edit components/ui/.
- Use the StatusPill primitive for every status — never roll your own colors.
- The launcher is intentionally minimal; visual polish comes in Phase 5.

When done:
- Files changed
- Screenshots: queue with each bucket non-empty, demo launcher
```

- **Verify:** orchestrator clicks through each scenario from `/demo`, walks the full flow, returns to `/queue` and confirms the PA appears in the right bucket throughout.

---

## phase-4-integration — Cross-screen integration pass (orchestrator)

- **Type:** inline (orchestrator)
- **Goal:** run all three demo scenarios end-to-end through the live UI; fix any cross-screen issues. Verify that the audit timeline on `/pa/[id]` correctly reflects events created by the encounter screen and the tracker.
- **Owns:** any cross-cutting fix — usually small.
- **Verify:** rehearse each demo scenario twice; record timing.

---

## Phase 4 exit checklist

- [ ] Each agent's screens shipped and screenshots reviewed against `DEMO_SCENARIOS.md`
- [ ] All three demo scenarios run end-to-end through the live UI
- [ ] PolicyPdfViewer renders sample bboxes correctly on `/_dev/pdfviewer` (zero-transform: `Citation.bboxes` JSON passed directly)
- [ ] Click-through citations work — clinical-note citations highlight via NoteHighlighter; PDF citations highlight via PolicyPdfViewer
- [ ] Upload-and-recheck loop works for Knee MRI; manual override works for Botox; RFI loop works for Botox
- [ ] Queue correctly bucketizes PAs throughout each scenario
- [ ] Components in `components/ui/` were not modified by feature work (grep confirms)

When all seven are checked, the orchestrator updates `tasks/STATUS.md` and Phase 5 begins.
