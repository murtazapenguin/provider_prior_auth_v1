# Phase 1 — Data + Reference Ingestion

Goal: every row the demo needs is loadable from `pnpm db:seed`. Reference codes, three demo patients with encounters and notes, three hand-curated demo policies. Real CMS / UHC ingest pipelines are sketched but not on the demo critical path.

This phase parallelizes well — two agents own non-overlapping seed scripts and Prisma fixtures.

Phase exit criteria are in `tasks/STATUS.md`.

---

## phase-1-seed-orchestrator — `prisma/seed.ts` skeleton

- **Type:** inline
- **Goal:** create the seed script entry point that calls into per-domain loaders.
- **Why it matters:** both subagents land their loaders into modules that this script imports. Without this skeleton, integration is messy.
- **Owns:** `prisma/seed.ts`.
- **Depends on:** Phase 0.
- **Contract:**
  - `pnpm db:seed` runs `prisma/seed.ts`.
  - Calls `loadCodeReferences()`, `loadDemoFixtures()`, `loadDemoPolicies()` in order, wrapped in a single transaction with progress logging.
  - Exits cleanly on success; non-zero on failure.
  - Idempotent — re-running drops + reseeds (use `prisma.$transaction` and per-table `deleteMany` at the top). **`aiCallCache` is NEVER wiped by default** — preserving it across rehearsals keeps demo determinism without paying LLM cost. To deliberately reset the cache, accept a `--reset-ai-cache` CLI flag that adds `aiCallCache` to the `deleteMany` list. See `tasks/phase-5-polish.md` `phase-5-runbook` for the runbook entry.
- **Verify:** orchestrator runs `pnpm db:seed` twice in a row (proves idempotency + cache survives); then `pnpm db:seed --reset-ai-cache` (proves the opt-in wipe works).

---

## phase-1-reference-data — Reference code data loader (Agent A)

- **Type:** agent (Explore + general-purpose)
- **Goal:** load ICD-10, CPT, and HCPCS Level II reference data from CSVs into the `CodeReference` table.
- **Why it matters:** code derivation, policy lookup, and UI label rendering all join against this table.
- **Owns:** `prisma/seed/codeReference.ts`, `prisma/fixtures/codes/icd10.csv`, `prisma/fixtures/codes/cpt.csv`, `prisma/fixtures/codes/hcpcs.csv` (or a README pointing at where they live if too large to commit).
- **Depends on:** `phase-1-seed-orchestrator`.

### Subagent prompt (use this verbatim minus context substitutions)

```
Goal: Load ICD-10 / CPT / HCPCS Level II reference codes into the CodeReference Prisma model from the user-provided files at the repo root.

Why this matters: Every downstream module joins against CodeReference for description text and validation. The demo fails if J0585, 70450, or 73721 are missing.

Required reading:
- /Users/murtaza/Documents/provider_pa/ARTIFACTS_MAP.md "Real data files" — schema for each CSV
- /Users/murtaza/Documents/provider_pa/CLAUDE.md "Real data files" — file paths

Context (already done):
- Prisma schema is at /Users/murtaza/Documents/provider_pa/prisma/schema.prisma; the CodeReference model lives there.
- The seed orchestrator at /Users/murtaza/Documents/provider_pa/prisma/seed.ts will call your exported loadCodeReferences() function.
- The user's data files are at the repo root and MUST NOT be edited:
  * /Users/murtaza/Documents/provider_pa/ICD-10 – Full Code Set/icd10_codes.csv (98,187 rows, columns: order_number, code, billable, short_description, long_description) — primary ICD-10 source
  * /Users/murtaza/Documents/provider_pa/CPT Codes/cpt-codes.csv (21 rows only — known small sample) — load as-is
  * No HCPCS file is provided. Backfill the demo HCPCS code J0585 from /Users/murtaza/Documents/provider_pa/CMS/coverage_code_mappings.csv (filter mapping_type='hcpcs' and code_value='J0585'); the description field on that table is the AMA short description.
- The other ICD-10 files (icd10_index, icd10_drug, icd10_neoplasm, icd10_tabular_rules, icd10_conversion) are NOT on the demo critical path — skip them for v1.

Your scope: ONLY /Users/murtaza/Documents/provider_pa/prisma/seed/codeReference.ts.

Your contract:
- Export `loadCodeReferences(prisma): Promise<{ icd10: number; cpt: number; hcpcs: number }>` returning row counts.
- Stream rows in batches of 1000 via prisma.createMany — ICD-10 is ~98K rows.
- Use long_description for the description field; fall back to short_description if long is empty.
- Skip rows with empty code or description; log a warning with count.
- Idempotent — caller wraps in deleteMany; you assume the table is empty when called.
- For the three demo codes (70450, 73721, J0585), fail loudly with a descriptive error if any one is missing after load.
- For the J0585 backfill from CMS/coverage_code_mappings.csv: load any hcpcs and j-code rows seen there, deduplicated by code_value. There may be a few thousand of these — fine to load all.

Constraints:
- Do not modify the Prisma schema.
- Do not import the Penguin SDK directly into TypeScript.
- Do not edit any file under /Users/murtaza/Documents/provider_pa/{CMS,UHC,CPT Codes,ICD-10 – Full Code Set,penguinai-claude-artifacts-main}/ — those are read-only references.
- Stream-read the CSVs (csv-parse async iterator); don't load the full 98K rows into memory at once.

When done:
- Files changed
- Row counts logged from a manual `pnpm db:seed` run (icd10, cpt, hcpcs)
- Confirmation that all three demo codes resolve via prisma.codeReference.findFirst with their descriptions
```

- **Verify:** orchestrator runs `pnpm db:seed`, then queries each of the three demo codes through Prisma Studio.

---

## phase-1-demo-fixtures — Patients + encounters + notes (Agent B, part 1)

- **Type:** agent (general-purpose)
- **Goal:** seed the three synthetic patients, their coverages, encounters, clinical notes, and orders for the three demo scenarios as defined in `DEMO_SCENARIOS.md`.
- **Why it matters:** the demo launcher loads these by id. If the fixtures are wrong, every scenario breaks.
- **Owns:** `prisma/seed/fixtures.ts`, `prisma/fixtures/patients.json`, `prisma/fixtures/coverages.json`, `prisma/fixtures/encounters/{head_ct,knee_mri,botox}.json`, `prisma/fixtures/additional_uploads/{pt_discharge_sam_rodriguez.txt,amitriptyline_intolerance_note.txt}`.
- **Depends on:** `phase-1-seed-orchestrator`.

### Subagent prompt

```
Goal: Seed the three demo scenarios from DEMO_SCENARIOS.md — synthetic patients, coverages, encounters, clinical notes, and orders.

Why this matters: This is the demo. Wrong notes mean wrong code derivation and broken evidence extraction.

Context (already done):
- Prisma schema with Patient, Coverage, Encounter, ClinicalNote, Provider, Payer, Order is at /Users/murtaza/Documents/provider_pa/prisma/schema.prisma.
- DEMO_SCENARIOS.md (the authoritative spec) lists the patient profiles, encounter setups, expected codes, and note types for each of the three scenarios.
- ORCHESTRATION.md and CLAUDE.md are repo conventions you should follow.

Your scope: ONLY files under /Users/murtaza/Documents/provider_pa/prisma/seed/fixtures.ts and /Users/murtaza/Documents/provider_pa/prisma/fixtures/.

Your contract:
- Export `loadDemoFixtures(prisma): Promise<{ patients: number; encounters: number; notes: number }>`.
- Use deterministic ids (e.g., "patient-jordan-avery", "encounter-head-ct") — the demo launcher will URL these, so they must be predictable.
- Notes (`ClinicalNote`) must be realistic enough that AI code derivation could plausibly extract the expected codes from them. Use the descriptions in DEMO_SCENARIOS.md (HPI, PE, plan sections etc.) to write the body text. Mark each note with the right `noteType` and `authorRole`.
- For Knee MRI: load the ortho consult note. Do NOT load the PT discharge summary at seed time — that's the upload the demo provider does mid-flow. Stash the PT discharge text in `prisma/fixtures/additional_uploads/pt_discharge_sam_rodriguez.txt` so the upload UI loads it from there.
- For Botox: load today's neurology note + headache diary + the prior PCP note. The neurology note's amitriptyline language must match what DEMO_SCENARIOS.md scenario 3 specifies — "trialed amitriptyline 6 weeks then discontinued for moderate sedation" (subthreshold to UHC's "at least two months" criterion, with intentionally soft "intolerance" language). Stash the optional amitriptyline-clarification note in `additional_uploads/`.
- Provider records: one PCP, one orthopedic surgeon, one neurologist. NPI numbers can be synthetic (10 digits, "MOCK" prefix in description if needed).
- Payer records: "Medicare (CMS)" with shortCode "CMS" and "United Healthcare" with shortCode "UHC". **Coverage**: all three demo patients are now on UHC Choice Plus per the updated DEMO_SCENARIOS.md (Sam Rodriguez was moved off Medicare; see "Payer note" in DEMO_SCENARIOS.md). Still create the "Medicare (CMS)" Payer row — Phase 1 CMS ingest needs it — but no demo Coverage points at it.

Constraints:
- Synthetic data only. Don't reuse real patient identifiers.
- Don't write the policies — that's a sibling agent.
- Don't write the PriorAuth rows — those get created at runtime.

When done:
- Files changed
- Row counts after a manual `pnpm db:seed` run
- For each scenario: confirm Prisma can find the encounter by id and that it has the expected number of ClinicalNotes
```

- **Verify:** orchestrator runs `pnpm db:seed`, opens Prisma Studio, walks each of the three encounters and confirms the notes match `DEMO_SCENARIOS.md`.

---

## phase-1-demo-policies — Hand-curated demo policies (Agent B, part 2 — sequential after fixtures)

- **Type:** agent (general-purpose)
- **Goal:** create three hand-curated `Policy` rows (one per demo scenario) plus their `PolicyCode` and `PolicyCriterion` rows. These bypass the AI ingestion pipeline so the demo critical path is independent of CSV/PDF delivery.
- **Why it matters:** Phase 2's policy match engine and Phase 3's evidence extraction need policies to match against. Hand-curating these three keeps the demo robust.
- **Owns:** `prisma/seed/demoPolicies.ts`, `prisma/fixtures/policies/{head_ct_uhc,knee_mri_lcd,botox_uhc}.json`.
- **Depends on:** `phase-1-demo-fixtures` (so Payer rows exist).

### Subagent prompt

```
Goal: Hand-curate three Policy + PolicyCode + PolicyCriterion records — one per demo scenario from DEMO_SCENARIOS.md.

Why this matters: These three policies drive the demo. The Botox policy is verbatim from a real UHC PDF; the Head CT and Knee MRI policies are honestly synthesized in the style of an eviCore UM policy because the actual eviCore criteria aren't in the dataset (the relevant UHC PDFs are admin-only). DEMO_SCENARIOS.md documents this explicitly.

Required reading:
- /Users/murtaza/Documents/provider_pa/DEMO_SCENARIOS.md (especially the "Expected policy hit" sections — UPDATED to reflect actual data)
- /Users/murtaza/Documents/provider_pa/UHC/medical-policies/botulinum-toxins-a-and-b-cs.pdf (the real Botox source — read pages 4–6 for the chronic migraine criteria; criterion text on the demo policy must match this PDF verbatim where possible)
- /Users/murtaza/Documents/provider_pa/POLICIES.md "matching engine" section
- /Users/murtaza/Documents/provider_pa/ARTIFACTS_MAP.md "Real data files" — confirms why Knee MRI / Head CT are synthesized

Context (already done):
- Demo fixtures (patients, encounters, payers) loaded by /Users/murtaza/Documents/provider_pa/prisma/seed/fixtures.ts. Payer ids are deterministic ("payer-cms", "payer-uhc").
- All three demo patients are now on UHC Choice Plus (Sam Rodriguez was moved off Medicare per DEMO_SCENARIOS.md "Payer note") — coverage records reflect this.

Your scope: ONLY /Users/murtaza/Documents/provider_pa/prisma/seed/demoPolicies.ts and /Users/murtaza/Documents/provider_pa/prisma/fixtures/policies/.

Your contract:
- Export `loadDemoPolicies(prisma): Promise<{ policies: number; codes: number; criteria: number }>`.
- Three policies, all under payerId="payer-uhc", with deterministic ids:
  - "policy-uhc-evicore-head-ct" (CPT 70450, hand-curated eviCore-style)
  - "policy-uhc-evicore-knee-mri" (CPT 73721, hand-curated eviCore-style)
  - "policy-uhc-botox-chronic-migraine" (HCPCS J0585, **verbatim from the UHC PDF**; sourceUrl points at the local PDF path)
- PolicyCode rows: each policy maps to its CPT or HCPCS code. Include POS scoping ([] = any) per the schema.
- PolicyCriterion rows:
  - For the two synthesized eviCore policies, write 3 criteria each per DEMO_SCENARIOS.md. In the criterion text or evidenceHint, note "[Synthesized for demo — eviCore-style; not verbatim from a real public policy]" so any reviewer downstream knows.
  - For the Botox policy, write 3 criteria per DEMO_SCENARIOS.md. Criterion text must be verbatim or near-verbatim from the source PDF. The amitriptyline scenario depends on the criterion 2 wording stating "trial of at least two months" exactly — the AI must be able to detect that 6 weeks doesn't meet this threshold.
- Set `evidenceHint` for each criterion (1–2 sentences, per AI_INTEGRATION.md).
- Mark `policyType="MedicalPolicy"` for all three.
- For the Botox policy specifically: also populate `sourceText` with the HTML-stripped chronic-migraine section from the PDF (so future AI ingestion has a comparison baseline) and set `sourceUrl` to a `file://...` path pointing at the local PDF.

Constraints:
- These are HAND-CURATED — do not call any AI to generate them.
- Do NOT invent criteria for Botox — match the source PDF.
- Mark `policyType` correctly: "MedicalPolicy" for all three.

When done:
- Files changed
- Row counts after `pnpm db:seed`
- For each policy: list every criterion text written, so the orchestrator can sanity-check vs DEMO_SCENARIOS.md (and for Botox, vs the source PDF)
```

- **Verify:** orchestrator opens each of the three policies in Prisma Studio, reads each criterion, and confirms it matches the scenario's "Expected criteria" list.

---

## phase-1-cms-ingest — CMS NCD/LCD/Article CSV ingester

- **Type:** agent (general-purpose)
- **Goal:** ingest the five CSVs at `CMS/` into Postgres so the policy lookup engine can query CMS coverage by code. NOT on the demo critical path — the Knee MRI demo policy is hand-curated — but a working ingester powers everything beyond the demo.
- **Why it matters:** the user's "extensible policy library" promise. Without this, every new procedure means hand-curation.
- **Owns:** `prisma/seed/cmsIngest.ts`, `scripts/ingest-cms.ts`, additions to `prisma/schema.prisma` for `CmsCodeMapping` + `CmsContractorMapping` helper tables.
- **Depends on:** `phase-1-demo-policies` (so `Payer` rows exist), `phase-0-schema`.

### Subagent prompt

```
Goal: Bulk-load CMS data from CMS/*.csv into Postgres. Not on the demo critical path — the demo's Knee MRI policy is hand-curated — but the ingest powers any post-demo extensibility.

Why this matters: The "extensible policy library" promise. After this lands, adding a new procedure to the system means querying CMS coverage by code, not hand-curation.

Required reading:
- /Users/murtaza/Documents/provider_pa/POLICIES.md "Ingestion pipeline 1: CMS NCD/LCD/Article CSVs" — pipeline shape and HTML-stripping rule
- /Users/murtaza/Documents/provider_pa/ARTIFACTS_MAP.md "CMS/" — schema details and demo-procedure → policy_id verifications

Context (already done):
- Five CSVs at /Users/murtaza/Documents/provider_pa/CMS/ with the schemas listed in ARTIFACTS_MAP.md.
- Postgres + Prisma schema authored at /Users/murtaza/Documents/provider_pa/prisma/schema.prisma. Payer "Medicare (CMS)" exists with deterministic id "payer-cms".

Your scope:
- /Users/murtaza/Documents/provider_pa/prisma/seed/cmsIngest.ts (bulk loader)
- /Users/murtaza/Documents/provider_pa/scripts/ingest-cms.ts (CLI wrapper for re-ingestion)
- Schema additions to /Users/murtaza/Documents/provider_pa/prisma/schema.prisma (only `CmsCodeMapping` and `CmsContractorMapping` — coordinate the migration with the orchestrator)

Your contract:
- New tables: CmsCodeMapping (policy_type, policy_id, mapping_type, code_value, description, range_flag, last_updated) with @@index([mappingType, codeValue]); CmsContractorMapping (policy_type, policy_id, contractor_id, contractor_name, state_id, state_name).
- Bulk-load `coverage_code_mappings.csv` (~555K rows) and `policy_contractor_mappings.csv` (~47K rows) using prisma.$executeRawUnsafe('COPY ...') for speed — do NOT use createMany row-by-row.
- For `lcd_policies.csv`, `ncd_policies.csv`, `articles.csv`: per row, create a `Policy` row with policyType in {'LCD','NCD','Article'}, externalId = the source id, title, sourceText = HTML-stripped indication+other_comments, sourceUrl from a stable CMS URL pattern. Use Cheerio (or `node-html-parser`) to strip HTML.
- Populate `PolicyCode` for each policy from the CmsCodeMapping rows that match (policy_type, policy_id).
- Do NOT split criteria here — that's Task 4 (criteria_split_v1) in services/ai, run on demand for any policy queried by the match engine. Leave PolicyCriterion empty for CMS-ingested policies; the live runtime backfills.
- Idempotent — wrap in a transaction; on rerun, deleteMany on these specific source ids before re-inserting.
- Export `loadCmsPolicies(prisma): Promise<{ lcds: number; ncds: number; articles: number; codeMappings: number; contractorMappings: number }>`.
- The CLI wrapper at scripts/ingest-cms.ts accepts --dir flag (default CMS/) so we can re-run against an updated drop later.

Tests verify:
- coverage_code_mappings has rows for code_value=70450, 73721, J0585 (the demo procedure codes).
- A sample LCD lookup by code (e.g., findCmsCodeMapping where mapping_type='cpt' and code_value='73721') returns the article ids 53252, 57807, 58559 (per the verified data in ARTIFACTS_MAP.md).
- HTML stripping leaves no `<` or `>` characters in Policy.sourceText.

Constraints:
- Do not call the AI service.
- Do not modify Citation, CriterionResult, or any policy criterion.
- Do not modify the demo policies seeded by phase-1-demo-policies.
- Memory budget: COPY-loading 555K rows should be I/O-bound, not memory-bound. Stream-read the CSVs.

When done:
- Files changed
- Row counts after a fresh `pnpm db:seed`
- Three sample lookups: 70450, 73721, J0585 — list every policy_id returned for each
```

- **Verify:** orchestrator runs `pnpm db:seed`, then queries `CmsCodeMapping` for each demo code, confirms expected article ids, spot-checks one Policy.sourceText for clean HTML stripping.

---

## phase-1-uhc-ingest — UHC PDF ingester

- **Type:** agent (general-purpose)
- **Goal:** ingest selected UHC PDFs (from `UHC/medical-policies/` and `UHC/clinical-guidelines/`) using the AI pipeline. NOT on the demo critical path — the Botox UHC policy for the demo is hand-curated — but a working ingester demonstrates the AI policy pipeline end-to-end.
- **Why it matters:** showcase the OCR → criteria extraction → bbox citation flow. Also gives us a path to ingest the rest of the UHC catalogue post-hackathon.
- **Owns:** `services/ai/policy_ingestion.py`, `services/ai/prompts/policy_ingestion_v1.py`, `scripts/ingest-uhc-pdf.ts`, `prisma/seed/uhcIngest.ts`.
- **Depends on:** Phase 3 (so the AI service is wired) — but the PDFs are already at `UHC/medical-policies/` so we can start prep work in Phase 1.
- **Contract:**
  - Pipeline per `POLICIES.md` "Ingestion pipeline 2" and `AI_INTEGRATION.md` Task 3.
  - CLI wrapper accepts a single PDF or a glob: `pnpm tsx scripts/ingest-uhc-pdf.ts UHC/medical-policies/botulinum-toxins-a-and-b-cs.pdf`.
  - Inserts go into a `policy_drafts` table for human review before publishing into live `Policy`. The demo uses the live `Policy` table populated by hand-curation only.
  - `services/ai/policy_ingestion.py` uses `AWSTextractProvider(s3_bucket=settings.s3_ocr_staging_bucket)`, `with_structured_output(SectionSpans / CodeList / CriteriaList)` (single-class container models), and the `ocr_result_to_bbox_format` + `strip_page_dimensions` helpers from `penguin.ocr.bbox_converter`.
- **Verify:** orchestrator runs the script on `UHC/medical-policies/botulinum-toxins-a-and-b-cs.pdf` (the Botox policy), opens the resulting draft in Prisma Studio, eyeballs ~5 criteria against the source PDF for sensibility. Then runs on a second PDF (e.g., `UHC/medical-policies/synagis-palivizumab.pdf`) to confirm generality.

---

## Phase 1 exit checklist

- [ ] `pnpm db:seed` runs cleanly and is idempotent
- [ ] CodeReference table has all three demo codes (70450, 73721, J0585)
- [ ] Three demo encounters loadable via Prisma; each has the expected note types
- [ ] Three hand-curated policies loadable via Prisma; each criterion matches `DEMO_SCENARIOS.md`
- [ ] CMS / UHC ingesters are deferred (or completed if files arrived) — annotated in `tasks/STATUS.md`

When the first four are checked, the orchestrator updates `tasks/STATUS.md` and Phase 2 begins.
