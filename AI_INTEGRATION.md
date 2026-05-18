# AI Integration (Penguin AI SDK)

> **Status:** locked. Penguin SDK docs at `https://ai-docs.penguinai.co/` reviewed. Path B confirmed (Python only). All SDK calls live in the FastAPI sidecar at `services/ai/`. Open SDK questions in `CLAUDE.md` are answered.

## What this doc covers

The four places where the Penguin SDK gets invoked, what each looks like as a prompt + output contract, where the boundary lives in code, and how we evolve prompts over the demo cycle without breaking determinism for the scripted scenarios.

## The four AI tasks

1. **Code derivation** — extract CPT/HCPCS/J/Q + ICD-10 from clinical notes
2. **Evidence extraction** — for each policy criterion, find supporting/contradicting evidence in the chart with citations
3. **Policy ingestion (PDF)** — segment a UHC-style PDF into structured criteria with source citations
4. **Criteria splitting (CSV fallback)** — when a CSV bundles multiple criteria into one text field, split them into discrete `PolicyCriterion` rows

Tasks 1 and 2 run at runtime inside the PA flow. Tasks 3 and 4 run at seed/ingest time (offline).

## SDK boundary

All Penguin SDK calls live in `services/ai/` — a small **FastAPI** service running alongside Next.js. Nothing in the Next.js codebase imports `penguin.*` directly, ever. Next.js calls the AI service over HTTP through a single typed client at `lib/ai/penguinClient.ts`.

```
services/ai/                       # Python (FastAPI) — owns the SDK
  main.py                          # FastAPI app + routes
  penguin_client.py                # create_model, tracer wrappers (single SDK touchpoint)
  code_derivation.py               # task 1
  evidence_extraction.py           # task 2 (uses FaithfulnessDetector)
  policy_ingestion.py              # tasks 3 + 4 (uses penguin.ocr)
  schemas.py                       # Pydantic models — request/response contracts
  prompts/                         # versioned prompts, registered via penguin.prompts.register_prompt
    code_derivation_v1.py
    evidence_extraction_v1.py
    policy_ingestion_v1.py
    criteria_split_v1.py
  cache.py                         # Postgres-backed AI response cache
  tests/

lib/ai/                            # TypeScript (Next.js) — calls FastAPI
  penguinClient.ts                 # HTTP client. Only file that knows AI_SERVICE_URL.
  codeDerivation.ts                # zod schema + thin wrapper
  evidenceExtraction.ts            # zod schema + thin wrapper
  policyIngestion.ts               # zod schema + thin wrapper
  schemas/                         # zod re-validation of FastAPI responses
```

## SDK setup (locked)

**Install (Python service):** Penguin ships as a bundled wheel in the vendor artifacts directory. From `services/ai/`:

```bash
# Mac/laptop CPU torch first
pip install torch --index-url https://download.pytorch.org/whl/cpu
# Then the SDK
pip install "../../penguinai-claude-artifacts-main/packages/penguin_ai_sdk-0.2.0-py3-none-any.whl[cpu]"
```

Pin this in `services/ai/pyproject.toml` so CI installs deterministically. Other deps: `fastapi`, `uvicorn`, `pydantic>=2`, `pymupdf` (for PDF page-dimension lookup), `httpx`, `loguru`.

**Auth:** provider-native. **Locked: AWS Bedrock for LLM, AWS Textract for OCR (single-cloud).** Required env vars in `services/ai/.env`:
- `AWS_REGION=us-east-1` (or wherever the Bedrock inference profile is provisioned)
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (or `AWS_PROFILE` if using `~/.aws/credentials`)
- `S3_OCR_STAGING_BUCKET=<your-bucket-name>` — the bucket Textract uses to stage PDFs during async processing. Same region as Bedrock recommended. Apply a 7-day lifecycle rule so staged PDFs auto-delete.

The AWS credentials need IAM perms for: `bedrock:InvokeModel*` (LLM), `textract:StartDocumentAnalysis` + `textract:GetDocumentAnalysis` (OCR), and `s3:PutObject` + `s3:GetObject` + `s3:DeleteObject` on the staging bucket.

Production swap: instance role on the AI service host instead of static keys; bucket policy locked to the role.

**Bedrock model IDs:** Bedrock on-demand requires **inference profile IDs**, not raw model IDs. Raw IDs trigger `ValidationException`. The SDK's friendly names auto-resolve to profiles (e.g. `claude-sonnet-4-5` → `us.anthropic.claude-sonnet-4-5-20250929-v1:0`), so always pass friendly names.

**Client init (single touchpoint):**
```python
# services/ai/penguin_client.py
from functools import lru_cache
from penguin.core import create_model

@lru_cache(maxsize=4)
def get_model(role: str = "extraction"):
    if role == "extraction" or role == "derivation":
        return create_model(provider="bedrock", model="claude-sonnet-4-5",
                            temperature=0.0, max_tokens=4096)
    if role == "ingestion":
        return create_model(provider="bedrock", model="claude-sonnet-4-5",
                            temperature=0.0, max_tokens=8192, long_context=True)
    if role == "split":
        return create_model(provider="bedrock", model="claude-haiku-4-5",
                            temperature=0.0, max_tokens=2048)
    raise ValueError(f"unknown role: {role}")
```

**Capabilities we use:**
- `model.with_structured_output(PydanticClass)` — every task uses this. Single class only; wrap lists in a container model.
- `model.invoke(messages)` — synchronous call.
- `penguin.ocr.providers.aws.AWSTextractProvider().process_file(path)` — PDF text + bboxes for policy ingestion.
- `penguin.output_guard.hallucination.FaithfulnessDetector` — citation substring check for evidence extraction.
- `penguin.prompts.register_prompt(group, name, content=...)` — prompt versioning. Group name: `pa_workflow`.
- `penguin.core.tracing.PenguinTracer().session(session_id, user_id)` — wraps every PA's AI work for Langfuse export when enabled.

**Context window:** 200K (Claude Sonnet 4.5 on Bedrock). 1M with `long_context=True` (used only for policy ingestion of large PDFs). No chunking needed for demo charts.

**Streaming:** `model.stream(...)` available. Not used in v1; we may add it for code-derivation UX later.

**Recommended models (chosen):**

| Task | Model | Why |
|---|---|---|
| Code derivation | `claude-sonnet-4-5` | Quality matters; output is short; 200K is plenty |
| Evidence extraction | `claude-sonnet-4-5` | Quality matters; one call per criterion (≤12 parallel) |
| Policy ingestion (PDF) | `claude-sonnet-4-5` + `long_context=True` | UHC PDFs can be long; one-time at seed |
| Criteria splitting (CSV fallback) | `claude-haiku-4-5` | Cheap and fast; deterministic structured output |
| Input/output guards | `claude-haiku-4-5` (SDK default) | Defense in depth; guardrails default to Haiku |

**Error model:** `create_model` defaults `max_retries=3`, `request_timeout=900s`. SDK retries transient failures. On final failure we return the call as `needs_info` and log a `PaEvent` with the error.

**Rate limits:** governed by Bedrock. We cap per-PA concurrency at 12 (one per criterion) and per-process concurrency at 32 in the FastAPI service to avoid overrunning Bedrock quotas.

## Task 1 — Code derivation

**Where it runs:** server action when an encounter is loaded into a new PA. Result is shown to the provider for review/correction before any policy lookup.

**Inputs:**
- All clinical notes for the encounter (concatenated with note-type headers)
- Optional: provider's stated indication / order text

**Outputs:**
```ts
type DerivedCodes = {
  procedures: Array<{
    codeType: 'CPT' | 'HCPCS' | 'J' | 'Q';
    code: string;
    modifier?: string;
    description: string;
    confidence: number;
    rationale: string;
  }>;
  diagnoses: Array<{
    codeType: 'ICD10';
    code: string;
    description: string;
    confidence: number;
    rationale: string;
    isPrimary: boolean;
  }>;
};
```

**Prompt sketch (v1):**
```
You are a medical coder. Extract procedure and diagnosis codes from the
clinical documentation below.

Rules:
- Only return codes that are clearly supported by the documentation
- Procedure codes: prefer the most specific CPT/HCPCS that matches the order
- Diagnosis codes: include all clinically relevant ICD-10 codes; mark the
  most clinically relevant as `isPrimary: true`
- For each code, provide a 1-sentence rationale citing the documentation
- Confidence: 0.0–1.0; use <0.7 only if the code is plausible but the
  documentation is incomplete

Return strictly valid JSON matching this schema: <inline JSON schema>

Clinical documentation:
<<<
{notes}
>>>
```

**Why this shape works:** procedures and diagnoses are different domains and benefit from being prompted separately conceptually but returned in one call to save round-trips. Confidence + rationale lets the UI surface uncertainty cleanly. We don't ask for codes outside the well-known sets to avoid hallucinated codes.

**Edge cases to design for:**
- **Multiple procedures.** Botox often has both J0585 (drug) and 64615 (admin). Both should appear. Don't drop "secondary" procedures.
- **Modifiers.** Bilateral, repeat, etc. — model should propose them when documented.
- **No procedure derivable.** If the notes don't support any procedure code, return an empty array, not a hallucinated guess. UI will surface "could not derive — please enter manually."
- **Conflicting dx codes.** Prefer the more specific code; if uncertain, return both with `isPrimary` on the more clinically relevant.

## Task 2 — Evidence extraction (the heart of the system)

**Where it runs:** every time we evaluate a PA's criteria — initial check, after upload, after RFI response.

**Important:** we run this **per criterion**, not all-criteria-at-once. One LLM call per criterion. Reasons:
1. Output structure is much more reliable
2. We can parallelize the calls (criterion N+1 doesn't depend on criterion N)
3. Prompt focus on a single criterion produces sharper citations
4. A failure on one criterion doesn't poison the others

**Inputs (per criterion):**
- The criterion text
- The criterion's evidence hint (if any)
- Required ICD-10s for this criterion (if any)
- Patient corpus: all clinical notes + extracted attachment text, with stable source IDs. Each source's text is presented in Penguin's `full_text` line-numbered format (`"content || N"`) so the LLM can cite by line number — these line numbers map back to OCR bboxes via `OCRResult.find_line_as_bbox()` for any source that came from OCR (uploads, policy PDFs); for plain-text clinical notes the line numbers map to the in-app NoteHighlighter.

**Outputs (canonical evidence-citation contract):**
```ts
type CriterionResult = {
  status: 'passed' | 'failed' | 'needs_info';
  reasoning: string;          // 1-2 sentences (canonical contract field name)
  confidence: number;         // 0.0-1.0
  // One Citation per source the LLM cited (typically 1, can be multiple).
  citations: Array<{
    sourceType: 'clinical_note' | 'attachment' | 'policy_pdf';
    sourceId: string;         // matches a noteId / attachmentId / policyId we passed in
    supportingTexts: string[]; // verbatim OCR / note excerpts
    // Bboxes follow the canonical bbox-format contract. Empty array if the source has no spatial data
    // (clinical notes are text-only, so bboxes is [] there; PDF policy citations have bboxes).
    bboxes: Array<{
      document_name: string;
      page_number: number;    // INTEGER, 1-indexed
      bbox: number[][];       // 8-point normalized arrays
      line_numbers?: number[]; // OCR line numbers from full_text
    }>;
    lineNumbers: number[];    // top-level convenience; redundant with bboxes[].line_numbers
  }>;
};
```

This shape is identical from the AI service → Postgres `Citation` row (via `Json` columns) → API response → React PDFViewer. Zero transformation. See `penguinai-claude-artifacts-main/.claude/contracts/evidence-citation.md` and `bbox-format.md` for the canonical specs.

**Prompt sketch (v1) — line-number citation pattern:**

The corpus we pass in is in Penguin's `full_text` format: each line is `"content || line_number"`. The LLM cites by line number; we look up the bbox via `OCRResult.find_line_as_bbox()` after the call.

```
You evaluate whether a single clinical criterion is satisfied by a patient's
chart. The chart corpus below is line-numbered: each line ends with " || N"
where N is the line number.

Criterion: {criterion.text}
Evidence hint: {criterion.evidenceHint or 'none'}
Required diagnosis codes for this criterion: {criterion.requiredCodes or 'none'}

Rules:
- Decide: passed | failed | needs_info
  * passed: clear evidence in the chart supports the criterion
  * failed: evidence contradicts the criterion or is clearly absent
  * needs_info: chart is ambiguous, partial, or missing key details
- Provide reasoning in 1-2 sentences.
- Provide confidence 0.0–1.0.
- For each citation: identify the source_id (we provided them), the
  line_numbers within that source where you found the evidence, and quote
  the verbatim supporting_texts exactly as they appear in the chart.
- For passed/failed: at least one citation required.
- For needs_info: cite the closest near-miss line(s) if any.
- Use only the source_ids provided. Do not invent sources.
- Do not paraphrase supporting_texts — verbatim only.

Return a Pydantic CriterionEvaluation matching the response schema below.

Chart corpus (line-numbered):
{corpus_with_source_ids}
```

**Why line numbers, not text matching:** the v0.2.0 SDK's recommended pattern. After the LLM returns line_numbers, we call `OCRResult.find_line_as_bbox(line_number=N, page_number=P)` to get the canonical bbox in one shot — no fuzzy matching, no false positives. For text-only clinical notes (which don't have OCR bboxes), we still record the line number for highlighting in the in-app note viewer.

**Why per-criterion:** one LLM call per criterion. Output structure is more reliable, calls parallelize, citations stay focused, and a failure on one criterion doesn't poison the others.

**Citation enforcement:** two layers, both built into the SDK.
1. `OCRResult.find_line_as_bbox()` returns `None` if the LLM-cited line number doesn't exist. That citation is dropped.
2. `penguin.output_guard.hallucination.FaithfulnessDetector` validates that each `supporting_text` actually appears in the cited source. Pure Python, fast.

If any citation is dropped or fails faithfulness, the criterion result downgrades to `needs_info` with a `citation_invalid` reason on the `PaEvent`. This replaces the hand-rolled fuzzy-matcher we'd planned originally.

**Confidence calibration:**
- For the demo we use the model's self-reported confidence directly with the bands defined in `POLICIES.md`.
- Long-term we'd calibrate with held-out evals, but that's well past hackathon scope.

## Task 3 — Policy ingestion (PDF)

**Where it runs:** offline, at seed/ingest time. Idempotent.

**Pipeline (per PDF):**
1. **OCR via Penguin.** `AWSTextractProvider(s3_bucket=settings.s3_ocr_staging_bucket).process_file(pdf_path)` returns an `OCRResult` with `lines: List[OCRLine]` and a `full_text` string in `"content || line_number"` format. Each line has `page_number`, `line_number`, `bounding_box` (4 points already normalized 0–1), and `confidence`. Textract auto-uploads the PDF to the staging bucket, kicks off async processing, polls until complete, then returns the normalized result. Single-cloud setup with Bedrock — no Azure resource needed.
2. **Page dimensions.** Textract returns coordinates already normalized 0-1, so no per-page width/height pre-computation is needed for OCR. PyMuPDF (`fitz`) is still used for **PDF generation** in the submission packet (Task 5) and for **page-image rasterization** for the PDFViewer (Phase 4).
3. **Section identification** (single LLM call, structured output via `with_structured_output(SectionSpans)` where `SectionSpans` is a container model wrapping a list): which line-number ranges are "Indications," "Coverage Criteria," "Documentation Requirements," "Applicable Codes," etc.
4. **Code list extraction** from the "Applicable Codes" section. Wrap in `CodeList(items: List[ApplicableCode])`.
5. **Criteria extraction** from the "Coverage Criteria" / "Indications" section. Wrap in `CriteriaList(items: List[IngestedCriterion])`. Each criterion's prompt uses the line-number citation pattern: the LLM returns `line_numbers: List[int]` and `page_numbers: List[int]` per criterion.
6. **Bbox materialization.** For each criterion, call `result.ocr_result_to_bbox_format(line_numbers=criterion.line_numbers, page_number=criterion.page_numbers[0], document_name=pdf_filename)` and `strip_page_dimensions()` to produce the canonical bbox shape stored on the `PolicyCriterion.sourceBboxes` JSON field.
7. **Optional:** an LLM-generated `evidenceHint` per criterion to help Task 2.
8. **Insert** into `policy_drafts` (not the live `Policy` table) for human review before publishing.

> The `long_context=True` flag is set on the model used for this task — UHC PDFs can run long, and one extra-long PDF should not break the pipeline.

> **Reference impl:** see `penguinai-claude-artifacts-main/.claude/skills/ai-engineering-guide/templates/document_pipeline.py` and `usage/03-DOCUMENT-PROCESSING.md` for end-to-end OCR → LLM extraction → bbox flow.

**Output schema:**
```ts
type IngestedPolicy = {
  title: string;
  policyType: 'NCD' | 'LCD' | 'MedicalPolicy';
  externalId?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  applicableCodes: Array<{
    codeType: string;
    code: string;
    modifier?: string;
    posCodes: string[];
  }>;
  criteria: Array<{
    ordinal: number;
    text: string;
    evidenceHint?: string;
    requiredCodes: string[];
    group?: string;
    groupOperator?: 'ALL' | 'ANY';
    sourcePage: number;
    sourceStartOffset: number;
    sourceEndOffset: number;
  }>;
};
```

## Task 4 — Criteria splitting (CSV fallback)

**Where it runs:** during CMS NCD/LCD CSV ingest, only when a single CSV row contains multiple bundled criteria in a free-text column.

**Input:** the bundled criteria text + the parent policy metadata.

**Output:** array of split criteria matching the same shape used by Task 3.

**Approach:** straight LLM call, no special handling. Output validated against zod schema before insert.

## Task 5 — Cover letter narrative generation

**Where it runs:** when the provider clicks "Review submission packet" on the Ready-for-Submission screen. Output is one paragraph of natural-language clinical narrative that goes onto page 1 of the submission packet between the structured patient block and the structured request block.

**Inputs:**
- Patient summary (first name + last initial, DOB, sex, payer, plan)
- Provider summary (name, specialty, NPI)
- Procedure code(s) being requested with descriptions
- Primary diagnosis with description
- Brief summary of supporting evidence (1-line per passed criterion)
- The clinical setting (place of service, encounter date)

**Output:**
```ts
type NarrativeParagraph = {
  paragraph_text: string;       // 3-5 sentences, professional clinical tone
  prompt_version: string;
  model: string;
  trace_id?: string;
  cached: boolean;
};
```

**Prompt sketch (v1):**
```
You write the narrative paragraph for a prior authorization request cover letter.
The paragraph appears on page 1 between a structured patient demographics block
and a structured procedure request block.

Patient: {patient_summary}
Provider: {provider_summary}
Procedure(s): {codes_with_descriptions}
Primary diagnosis: {diagnosis_with_description}
Clinical setting: {place_of_service}, encounter dated {encounter_date}
Supporting clinical findings (one per passed criterion):
{criterion_summaries}

Write a 3-5 sentence paragraph in professional clinical tone that:
- Opens with the provider's request (e.g. "I am requesting prior authorization for...")
- States the clinical indication briefly
- References the supporting findings without restating each criterion verbatim
- Closes with confidence in medical necessity

Rules:
- Third person, professional clinical voice
- No bullet points, no numbered lists — prose only
- Do not invent clinical facts beyond what's in the inputs
- Do not include patient identifiers other than the first name + last initial

Return strictly valid JSON matching: {"paragraph_text": str}
```

**Why hybrid:** the structured patient/request blocks on either side of the paragraph stay templated and deterministic — payer-friendly and machine-parseable. The narrative paragraph in the middle reads like a real letter from a real clinician, which is what makes the packet compelling rather than mechanical. Cost: one LLM call per packet generation; cache makes re-generations free.

**Model:** `claude-haiku-4-5` via a new `get_model("narrative")` role in `services/ai/penguin_client.py` (aliases to Haiku). The narrative is short and well-bounded; Haiku is plenty.

**Cache key:** `(task="cover_letter", prompt_version, model, sha256(canonical criteria results + codes + patient summary))`. A recheck-then-regenerate produces a fresh narrative because criteria result hashes change.

## Patterns we'll use throughout

- **Strict structured outputs.** Every call uses `model.with_structured_output(PydanticModel)` on the Python side. Single Pydantic class only — wrap lists in a container model. The TS adapters re-validate the FastAPI response with zod before returning to callers (defense in depth across the HTTP hop). Anything that doesn't validate gets one retry; if the second attempt fails, the call returns `needs_info` (or, for code derivation, an empty result) and writes a `PaEvent` with the error.
- **Idempotency / AI cache.** Each AI call is keyed by `(task, prompt_version, model, sha256(canonical_input))` — **model is part of the key** so swapping models (e.g. Sonnet 4.5 → 4.6, or Sonnet → Haiku) doesn't serve stale results. The Python service reads/writes the `ai_call_cache` Postgres table. Repeated calls with identical input return cached results. This makes demos deterministic and lets us hot-reload the UI without reburning model time.
- **Prompt versioning.** Prompts live in `services/ai/prompts/*_vN.py` and are registered with `penguin.prompts.register_prompt("pa_workflow", "<task>_vN", content=...)` at FastAPI startup. The Merkle hash from the SDK is stamped onto every cached entry; bumping a prompt version invalidates the cache for that task.
- **Tracing.** Every PA-driven request to the AI service runs inside `PenguinTracer().session(session_id=pa.id, user_id=provider.id)`. Trace IDs are returned to Next.js and stored on the corresponding `PaEvent`. If Langfuse env vars aren't set, this is a no-op.
- **No PHI to logs.** Prompts and inputs are not logged at info/debug level by default. Audit trail records *that* an AI call happened and *what task,* not the full prompt and patient content. Optional input/output guards (`CompositeInputGuard`, `SafetyDetector` with `enable_redaction=True`) can be enabled in non-demo deploys to redact PII before traces ship to Langfuse.
- **Latency budget.**
  - Code derivation: target <5s
  - Per-criterion evidence extraction: target <3s; up to ~12 criteria run in parallel
  - PDF policy ingest: offline, no latency target
- **Cost guardrails.** Cap concurrent AI calls per PA at 12 (one per criterion typical) and per FastAPI process at 32 (Bedrock quota safety). Fail closed on rate limit: SDK already retries 3x; on final failure we re-queue with backoff and surface as `needs_info`.

## Demo determinism

For the three demo scenarios, we want the AI outputs to be stable across runs (no flaky demos). Two-pronged approach:

1. **Cache responses for the seed corpus.** Pre-run all four AI tasks against the demo encounters at seed time, persist results in a `ai_call_cache` table keyed by input hash + task + prompt version. Live runtime reads cache first, hits the SDK only on a miss. For demos, the cache is always warm.
2. **Fallback canned responses for the demo scenarios.** As an additional belt-and-suspenders measure, ship hardcoded "expected" results for each scenario that get used if the SDK is unreachable. The UI behaves identically.

This means the demo is robust even with no internet — important when conference WiFi is bad.

## SDK questions — resolved

All twelve resolved against `https://ai-docs.penguinai.co/`. See `CLAUDE.md` "Resolved (Penguin SDK questions)" for the full list with sources. Highlights:

- Python only → committed to FastAPI sidecar (Path B)
- Native structured outputs via Pydantic
- 200K context (1M optional via `long_context=True`)
- Built-in OCR replaces `pdfplumber`
- Built-in `FaithfulnessDetector` replaces our hand-rolled citation validator
- Built-in `PenguinTracer` + Langfuse for observability (off by default in the demo)

## Implementation sequence

When build starts, AI features land in this order so we can demo something at every step:

1. FastAPI sidecar scaffolding (`services/ai/main.py` + `penguin_client.py`) and the TS HTTP adapter (`lib/ai/penguinClient.ts`)
2. Code derivation (Task 1) — earliest visible AI value
3. Evidence extraction for one hard-coded criterion (Task 2 minimal)
4. Evidence extraction across many criteria with citations
5. Citation validation + UI highlighting
6. Manual override flow
7. Policy ingestion (Task 3) — only after the live runtime is solid
8. Caching + canned-response fallback for demo determinism
