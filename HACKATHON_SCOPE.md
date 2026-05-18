# Hackathon Scope

This document is the contract for what we're building this week. If something isn't on the "in scope" list, it's not getting built — even if it's discussed elsewhere in the planning docs as part of the long-term vision.

## In scope (must ship)

### Core flow
- Single-org, single-tenant deployment
- Mock EHR ingestion: load encounter + clinical notes from JSON fixtures (no real EHR connection)
- Code derivation: AI extracts CPT / HCPCS / J / Q codes and ICD-10 diagnosis codes from notes; provider can correct/override
- Eligibility & coverage step: identifies the patient's payer + plan + benefit category from seeded patient profile (no real eligibility check)
- PA-required determination: lookup against ingested policy data
- Evidence extraction: AI pulls clinical evidence from notes/uploads, matches against policy criteria, returns pass/fail with citations
- Provider checklist UI: shows criteria, what passed, what's missing, with citations to source notes
- Upload-and-recheck loop: provider uploads a document, system re-runs evidence extraction
- Park-for-later flow: "Pending Submission" state with 60-day auto-expire
- Mock submission to payer (HTTP call to internal simulator, no real X12 / FHIR)
- Submission packet generation: at submit time, assemble a single PDF containing (page 1) a hybrid templated + LLM-generated cover letter, (page 2) the criteria checklist with passed criteria and their citation excerpts, (pages 3+) every cited clinical note and provider upload. Read-only preview on the review screen with a Regenerate button. Persists as an Attachment with `kind="submission_packet"`. LLM narrative via `penguin.core`; PDF generation via PyMuPDF.
- Simulated payer adjudication: status transitions on a configurable timer (Pending → In Progress → Approved/Denied/RFI/Partial)
- Full status model with all transitions (see `WORKFLOW.md`)
- Provider withdrawal post-submission

### Three demo scenarios working end-to-end
- Head CT (PCP) — happy path, single code
- Knee MRI (Ortho) — missing-evidence loop with re-check
- Botox for Migraines (Neuro) — complex criteria, evidence extraction across multiple note types

### Policy support
- CMS NCD/LCD ingestion from CSV (provided)
- UHC medical policies from PDF (provided) — AI ingestion pipeline
- ICD-10, CPT, HCPCS Level II reference data loaded from CSV (provided)

### UI
- Designed from scratch using Penguin's design system + colors (assets to be provided)
- Screens: encounter intake, code review, eligibility/coverage view, criteria checklist, document upload, ready-for-submission review, post-submission tracker, work queue

### Architectural design quality
- Adapter interfaces for EHR ingestion and payer submission so real implementations can be swapped in
- Audit trail: every state transition, AI decision, and document touch is logged

## Out of scope (explicitly not building)

- Appeal process for denied PAs
- Real EHR integration (SMART on FHIR, HL7, etc.)
- Real payer connectivity (X12 278, Da Vinci PAS, payer portals, fax)
- Real eligibility check (270/271)
- HL7 Da Vinci CRD / DTR / PAS conformance — designed-for, not implemented
- Reauthorization / renewal flow
- Concurrent (inpatient) review
- Retrospective authorization
- Multi-tenant org separation (single org for now)
- SSO / OAuth / production auth — mocked sign-in only
- Patient-facing notifications / portal
- Approval / denial / peer-to-peer letter generation (the system *does* generate the submission cover letter packet that goes to the payer at submit time — see "In scope")
- Reporting / analytics dashboards
- Bulk actions across multiple PAs
- PHI redaction beyond what synthetic data already provides
- Live policy search (e.g., real-time payer policy API queries) — all policies are pre-ingested
- Penguin AI SDK fine-tuning or training
- Mobile-specific layouts

## Mocks vs. real

| Component | This week | Future |
|---|---|---|
| EHR data | JSON fixtures loaded at seed | SMART on FHIR adapter |
| Eligibility | Seeded patient profile | Real 270/271 EDI or FHIR Coverage |
| Payer policies | Pre-ingested CSV + PDF | Live payer policy API or scheduled refresh |
| PA submission | HTTP to internal simulator | X12 278 / FHIR PAS adapter |
| Payer adjudication | Timer-based state simulator | Real payer responses (X12 278R, FHIR) |
| Auth | Single hardcoded provider user | SSO / SAML / SMART on FHIR launch |
| Audit log | Postgres table | SIEM forwarder, retention policy |

## MVP definition

The hackathon demo passes if a stakeholder can sit down, pick one of the three scenarios from a launcher, and watch the system go from "encounter loaded" to "PA submitted and approved by simulated payer" in under 60 seconds, with the criteria checklist clearly showing which evidence supported each criterion (with clickable citations back to source notes).

For the missing-evidence scenario (knee MRI), the demo extends with: provider uploads conservative-therapy documentation, system re-runs in <10s, checklist updates to all-green, provider submits.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| ~~Penguin SDK doesn't support PDF ingestion natively~~ — resolved | The SDK ships `penguin.ocr.providers.aws.AWSTextractProvider` returning normalized line-level text + bboxes (0-1 normalized natively). We use it directly with an S3 staging bucket (`S3_OCR_STAGING_BUCKET`). Single-cloud setup with Bedrock. |
| Evidence extraction quality is too low for some criteria | Build prompt iteration into the loop early; have a manual-override "mark as met" with a reason field |
| Policy criteria text is too unstructured to ingest cleanly from PDF | Hand-curate the UHC criteria for the three demo scenarios as a fallback; ingestion pipeline still designed but only used for additional policies |
| Status simulator timing feels artificial in demo | Make timing configurable; include a "fast-forward" button for stakeholder demos |
| Code derivation gets the wrong code | Always show derived codes to the provider for confirmation before proceeding |
| Penguin SDK is Python-only, slowing build | Run as a small FastAPI service alongside Next.js; clean HTTP boundary |

## Post-hackathon roadmap (not committed)

- SMART on FHIR launch from EHR
- Real X12 278 submission via clearinghouse
- HL7 Da Vinci CRD/DTR/PAS conformance
- Multi-tenant org model
- Reauthorization & expiration tracking on the payer side
- Appeal workflow
- Concurrent review (inpatient)
- Reporting and analytics
- Letter generation
- Patient-facing status notifications
