# Policies: Representation, Ingestion, and Matching

Policies are the heart of this app. Everything else (UI, status, AI extraction) exists to serve policy matching: did this clinical encounter satisfy the criteria this payer requires for this code?

This doc covers (1) how policies are represented in the data model, (2) the two ingestion pipelines (CMS structured CSV vs. UHC PDF), (3) the matching engine that joins clinical evidence to criteria, and (4) the playbook for adding a new policy after launch.

## What "policy" means here

A **Policy** is a payer's published rule for when a code is covered, what evidence is required, and any modifiers that apply. Examples:

- **CMS NCD 220.4** — Magnetic Resonance Imaging (national, applies to all Medicare patients)
- **CMS LCD L34577** — MRI of Lower Extremities (regional, varies by MAC)
- **UHC Medical Policy 2024T0xxxx** — OnabotulinumtoxinA (Botox) for chronic migraine

A policy contains:
- Metadata (payer, type, effective dates, source URL/text)
- Applicable code list (which CPT/HCPCS/J/Q codes it governs, optionally with modifiers and POS scoping)
- One or more **criteria** — discrete clinical conditions that must be satisfied for the code to be covered

A **criterion** is a single human-readable rule, e.g.:
> "Documentation of failed conservative therapy (PT, NSAIDs, or activity modification) for at least 6 weeks prior to imaging."

Criteria can be grouped with logical operators ("ALL of the following," "ANY of the following").

## Policy data model recap

Tables (full schema in `ARCHITECTURE.md`):

- `Policy` — header row with metadata
- `PolicyCode` — applicable code list (joined many-to-one to Policy)
- `PolicyCriterion` — individual criteria (joined many-to-one to Policy)

Why this shape:
- Lets us answer "is PA required for code X under payer Y, plan Z, POS P?" with a single indexed lookup.
- Lets us iterate criteria by ordinal for the UI checklist.
- Supports criteria grouping (ALL/ANY) without explosion in row count.

The key insight: **criteria are the unit of evidence extraction**. Each `PolicyCriterion` produces exactly one `CriterionResult` per PA. The AI's job is to fill in that result.

## Ingestion pipeline 1: CMS NCD/LCD/Article CSVs

The user dropped real CMS data at `CMS/`. Five CSVs, all populated. Schemas are real (no longer assumed):

| File | Rows | Key fields |
|---|---:|---|
| `lcd_policies.csv` | 199,868 | `lcd_id, lcd_version, title, indication (HTML), diagnoses_support (HTML), coding_guidelines (HTML), doc_reqs (HTML), summary_of_evidence` |
| `ncd_policies.csv` | 12,414 | `NCD_id, NCD_vrsn_num, indctn_lmtn (HTML), itm_srvc_desc, NCD_efctv_dt, ncd_keyword, benefit_category_codes/descriptions` |
| `articles.csv` | 114,735 | `article_id, article_version, title, description (HTML), other_comments (HTML), keywords, status` |
| `coverage_code_mappings.csv` | 555,082 | `policy_type (lcd/ncd/article), policy_id, mapping_type (cpt/hcpcs/icd10), code_value, description` |
| `policy_contractor_mappings.csv` | 47,010 | `policy_type, policy_id, contractor_id, contractor_name, state_id, state_name` |

**Important shape note:** much of the actual coverage criteria for CPT/HCPCS codes lives in `articles`, not the LCD itself. Our policy match engine queries all three policy types via `coverage_code_mappings`.

Pipeline:

1. **Bulk-load reference tables** — `coverage_code_mappings` and `policy_contractor_mappings` ingest as-is into helper tables (`CmsCodeMapping`, `CmsContractorMapping`). Index `CmsCodeMapping` on `(mapping_type, code_value)` after import — this is the hot lookup path.
2. **Parse policy CSVs** — `lcd_policies`, `ncd_policies`, `articles` each map to `Policy` rows. `policy_type` column distinguishes them.
3. **Strip HTML** from `indication / diagnoses_support / coding_guidelines / doc_reqs / description / other_comments` columns before AI ingestion. Use `beautifulsoup4` (Python). The stripped plaintext goes into `Policy.sourceText`.
4. **Normalize codes via the mapping CSV.** For each policy row, query `coverage_code_mappings` by `(policy_type, policy_id)` to populate `PolicyCode`. Handle ranges (`range_flag='Y'`) by expanding the range. Handle modifiers from the description if present.
5. **Split criteria.** The HTML-stripped policy text is one big block of indications + limitations + documentation requirements. Run a small AI pass (Task 4 from `AI_INTEGRATION.md`, `criteria_split_v1`) to split it into discrete `PolicyCriterion` rows with ordinals. The Phase 3 ingester adds `evidenceHint` per criterion.
6. **Insert** — wrap in a transaction so a partial ingest doesn't leave orphan rows.

This pipeline runs at seed time, not at runtime. We re-run it when CMS publishes updates.

**For the demo critical path** we hand-curate the Knee MRI scenario's policy from one of the relevant article rows (verified covers for CPT 73721: `article 53252, 57807, 58559`). The AI pipeline is built and tested but not relied on for the demo.

## Ingestion pipeline 2: UHC medical policy PDFs

UHC's medical policies are unstructured PDFs with their own house format (introduction, indications, criteria, exclusions, references). Higher AI lift, but the pattern is well-defined.

Pipeline:

1. **PDF → OCR.** From the FastAPI sidecar, `AWSTextractProvider(s3_bucket=settings.s3_ocr_staging_bucket).process_file(pdf_path)` — AWS Textract is our committed provider (single-cloud with Bedrock). The provider auto-uploads the PDF to the staging bucket, runs async OCR, and returns an `OCRResult` with `lines: List[OCRLine]` (each carrying `content`, `page_number`, `line_number`, `bounding_box` already normalized 0-1, `confidence`) and a `full_text` formatted as `"content || line_number"` per line. Bounding boxes are pixel-accurate citation handles for free, no per-page normalization step needed.
2. **Page dimensions** (skipped for OCR). Textract returns already-normalized 0-1 coordinates, so this step is a no-op for the OCR path. PyMuPDF is still used downstream for the submission packet (Task 5) and for page-image rasterization in the PDFViewer.
3. **Section segmentation.** One LLM call with `with_structured_output(SectionSpans)`: identify the line ranges for "Indications" / "Coverage Criteria" / "Documentation Requirements" / "Applicable Codes". Other sections (Background, References) are kept as `sourceText` for the policy header but not parsed into criteria.
4. **Code extraction.** From the "Applicable Codes" section, extract a `CodeList(items: List[ApplicableCode])` with code, code type, modifier, POS scoping.
5. **Criteria extraction.** Prompt the LLM to return a `CriteriaList(items: List[IngestedCriterion])`. Each criterion includes its source `line_numbers` and `page_numbers` (line-number citation pattern from the v0.2.0 SDK):
   ```json
   {
     "ordinal": 1,
     "text": "Diagnosis of chronic migraine (≥15 headache days/month for ≥3 months)",
     "evidenceHint": "Look for ICD-10 G43.7xx and headache day counts in neurology or PCP notes",
     "group": null,
     "groupOperator": null,
     "line_numbers": [82, 83, 84],
     "page_numbers": [4, 4, 4]
   }
   ```
6. **Bbox materialization.** For each criterion, call `result.ocr_result_to_bbox_format(line_numbers=..., page_number=..., document_name=...)` then `strip_page_dimensions()` to produce the canonical bbox JSON. Store on `PolicyCriterion.sourceBboxes` (Json column). The UI reads this and passes directly to PDFViewer as `boundingBoxes`.
7. **Human review (recommended even in hackathon).** Before going live, dump the parsed criteria for each policy and eyeball them. AI extraction is good but not perfect, and a wrong criterion at policy ingest time taints every PA that ever uses it. For the demo scenarios we hand-validate the criteria so the demo path is independent of ingestion quality.
8. **Insert** into `policy_drafts` (not the live `Policy` table) for human review before publishing.

> **Reference impl:** `penguinai-claude-artifacts-main/.claude/skills/ai-engineering-guide/templates/document_pipeline.py` and `usage/03-DOCUMENT-PROCESSING.md`. For the line-number bbox utility, port the helpers from `penguinai-claude-artifacts-main/platform-backend-kit/utils/line_number_bbox_utils.py` into `services/ai/utils/bbox.py`.

We run this pipeline once per policy. After ingest, the policy is just data.

## Adding a new policy after launch

To support the "extensible policy library" goal:

1. Drop the source file (CSV row, PDF, free text) into `policies/incoming/`.
2. Run `pnpm policies:ingest <file>`. The script auto-detects type (CSV vs PDF vs text) and routes through the right pipeline.
3. The script emits a draft `Policy` + criteria into a `policy_drafts` table (not the live `Policy` table) — so a human can review before activation.
4. Reviewer opens an admin screen, edits if needed, clicks "Publish."
5. Publishing copies the rows into the live `Policy` table and the policy is now in effect for any new PAs.

This is overkill for the hackathon demo, but the planning doc mentions it because the user asked for "a way to add more guidelines policies that we support" — so we want the architecture to absorb it without a refactor.

## The matching engine

This is where a PA gets evaluated against the criteria of an applicable policy.

### Inputs
- A `PriorAuth` with confirmed codes (CPT/HCPCS/J/Q + ICD-10) and a known coverage tuple (payer, plan, POS)
- The patient's `ClinicalNote`s for the encounter
- Any `Attachment`s the provider has uploaded
- The `Policy` (and its `PolicyCriterion`s) that govern this code

### Algorithm
1. **Resolve applicable policy.** Lookup: `PolicyCode` where `code = X AND (payerId = Y AND (plan match OR plan-agnostic) AND (POS match OR POS-agnostic))`. Pick the most specific match. If multiple policies apply (rare, but happens with overlapping NCD/LCD), evaluate all and merge results — most restrictive wins on missing criteria, most permissive wins on PA-required determination.
2. **For each criterion, run evidence extraction.** Concatenate all clinical notes + attachment-extracted text into a corpus, prompt the AI:
   ```
   Criterion: <text>
   Evidence hint: <evidenceHint>
   Patient corpus: <notes + attachments>
   Required ICD-10s for this criterion: <list>
   
   Determine whether the criterion is satisfied. Return:
   - status: passed | failed | needs_info
   - rationale: 1-2 sentences explaining why
   - confidence: 0.0-1.0
   - citations: array of {sourceId, excerpt, charRange}
   ```
3. **Apply group operators.** If criteria are grouped with `ALL` / `ANY`, fold individual results into group-level pass/fail.
4. **Aggregate to PA-level result.** All groups pass ⇒ `Ready for Submission`. Any group fails ⇒ `Draft` with missing items list. `needs_info` is treated as a fail for state-machine purposes but rendered differently in the UI ("we couldn't tell — please clarify").
5. **Persist.** Write `CriterionResult` rows + child `Citation` rows. Write a `PaEvent` for the recheck.

### Confidence handling
- High confidence (>0.85) and `passed` → green check on UI, no provider action.
- Medium confidence (0.5–0.85) and `passed` → yellow check, "AI is fairly sure — review citation."
- Low confidence (<0.5) or `needs_info` → red, treated as failed.
- Provider can always override: a "manual override" action sets a criterion to `passed` with a free-text rationale; this is logged in the audit trail and surfaced in the post-submission record.

### Citations
Every `passed` and `failed` result must produce at least one citation. For `passed`, the citation is the supporting evidence excerpt. For `failed`, the citation is "best near miss" if any (e.g., note mentions PT but no duration), or null if no relevant text was found at all. The UI lets the provider click a citation to jump to the source note with the excerpt highlighted.

## Tunable knobs

- **Confidence thresholds** for green/yellow/red — start with values above, tune from demo feedback.
- **Corpus assembly** — for very long charts we may need to chunk and select; for the demo, full-corpus is fine.
- **Evidence hint usage** — first version always feeds hints; ablation later if hints hurt more than help.
- **Manual override audit** — can be required for terminal-state-bound PAs, optional otherwise.

## What we ingest at seed time

For the hackathon demo seed:

- ICD-10 full code set CSV → `CodeReference` (codeType=ICD10)
- CPT codes CSV → `CodeReference` (codeType=CPT)
- HCPCS Level II codes CSV → `CodeReference` (codeType=HCPCS)
- CMS NCD/LCD CSV → `Policy` + `PolicyCode` + `PolicyCriterion` (CSV pipeline)
- UHC medical policies PDF → `Policy` + `PolicyCode` + `PolicyCriterion` (PDF pipeline)

For the three demo scenarios specifically, we hand-validate the policies they touch (Head CT, Knee MRI, Botox J0585) so a single bad ingestion doesn't break a demo.

## What "PA not required" looks like in this model

When a code has no applicable policy entries for the patient's coverage, the determination is "no PA required" and the PA flow short-circuits. This is itself a recorded result — we still create a `PriorAuth` row in a special `not_required` status (or simply skip creating one, depending on UI affordance) so we have an audit trail of the determination. Decision pending UI design — defaulting to "create the row, mark `not_required`, terminal" so the work shows in the recently-completed queue.
