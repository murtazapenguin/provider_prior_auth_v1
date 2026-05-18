# Phase 3 — AI Integration

Goal: real Penguin SDK calls replace the Phase 2 stubs for code derivation and evidence extraction. AI cache + canned-response fallback are in place so the demo is deterministic and survives a dead WiFi.

This phase has a sequential setup step (lock the Penguin client + the FastAPI handlers) and then two parallel agents (one per AI task). Policy ingestion is **not** on the demo critical path — it's a deferred ticket from Phase 1 that lands here when the UHC PDF arrives.

Phase exit criteria are in `tasks/STATUS.md`.

---

## phase-3-penguin-client — Real Penguin client + FastAPI route shells

- **Type:** inline (orchestrator)
- **Goal:** replace the `NotImplementedError` stubs in `services/ai/penguin_client.py` with the real `create_model` lazy initializer per `AI_INTEGRATION.md` "SDK setup", and stand up the four FastAPI route shells (`/derive-codes`, `/extract-evidence-criterion`, `/ingest-policy`, `/split-criteria`) with request/response Pydantic models.
- **Why it matters:** both AI agents need a working SDK to call against and a contract to ship to.
- **Owns:** `services/ai/penguin_client.py`, `services/ai/main.py` (route registration), `services/ai/schemas.py`, `services/ai/cache.py`.
- **Depends on:** Phase 0 (FastAPI scaffolding), Phase 0 (Prisma schema includes `ai_call_cache`).
- **Contract:**
  - `get_model(role)` returns the right Claude model per role per `AI_INTEGRATION.md` table. `role` ∈ `{"derivation", "extraction", "ingestion", "split"}`.
  - All four routes are wired but return `501 Not Implemented` until the agent tickets land.
  - `services/ai/cache.py` exposes `get(task, prompt_version, input)` and `put(task, prompt_version, input, response, trace_id)`. Hash is `sha256(json.dumps(input, sort_keys=True))`.
  - Every request runs inside `PenguinTracer().session(session_id=request.pa_id, user_id=request.provider_id)` when those fields are present.
  - All routes auth-gated by `AI_SERVICE_TOKEN`.
- **Verify:** orchestrator hits `/derive-codes` with a valid request and gets a `501` (proves auth + routing); hits with a bad token and gets `401`.

---

## phase-3-code-derivation — Code derivation (Agent G)

- **Type:** agent (general-purpose)
- **Goal:** implement Task 1 (procedure + diagnosis code extraction from clinical notes) per `AI_INTEGRATION.md`.
- **Why it matters:** the first AI value the provider sees in the flow. Wrong codes ripple into the whole PA.
- **Owns:** `services/ai/code_derivation.py`, `services/ai/prompts/code_derivation_v1.py`, `services/ai/tests/test_code_derivation.py`, `lib/ai/codeDerivation.ts` (TS wrapper that POSTs to `/derive-codes` and validates with zod).

### Subagent prompt

```
Goal: Implement Task 1 from AI_INTEGRATION.md — derive CPT/HCPCS/J/Q + ICD-10 from clinical notes using Penguin SDK.

Why this matters: First AI value the provider sees. Wrong derivation ripples into the entire PA flow.

Context (already done):
- Penguin client at /Users/murtaza/Documents/provider_pa/services/ai/penguin_client.py — call get_model("derivation").
- FastAPI route shell at services/ai/main.py POST /derive-codes returns 501 — replace with your handler.
- AI_INTEGRATION.md "Task 1" defines the inputs, outputs, prompt sketch, and edge cases.
- Cache helper at services/ai/cache.py.
- DEMO_SCENARIOS.md "Expected derived codes" lists the expected output for each demo encounter — your test must verify these.

Your scope:
- /Users/murtaza/Documents/provider_pa/services/ai/code_derivation.py (handler + prompt registration)
- /Users/murtaza/Documents/provider_pa/services/ai/prompts/code_derivation_v1.py
- /Users/murtaza/Documents/provider_pa/services/ai/tests/test_code_derivation.py
- /Users/murtaza/Documents/provider_pa/lib/ai/codeDerivation.ts (TS wrapper)
- /Users/murtaza/Documents/provider_pa/lib/ai/schemas/codeDerivation.ts (zod re-validation)

Your contract:
- Pydantic request: { encounter_id: str, notes: List[Note], indication?: str, pa_id?: str, provider_id?: str }
  where Note = { id: str, note_type: str, author_role: str, text: str }
- Pydantic response: { procedures: List[ProcedureCode], diagnoses: List[DiagnosisCode], prompt_version: str, trace_id?: str, cached: bool }
  Use a single Pydantic container model — with_structured_output requires it.
- Use model.with_structured_output() for the LLM call. Wrap procedures+diagnoses in a single DerivedCodes model.
- Cache key: sha256 of canonicalized {notes, indication}. On hit, set cached=true and skip the LLM.
- Register the prompt with penguin.prompts.register_prompt("pa_workflow", "code_derivation_v1", content=...) at module import time.
- Wrap the LLM call in PenguinTracer().session() when pa_id is provided.
- TS wrapper validates with zod and surfaces typed errors (AiUnreachableError, AiInvalidResponseError already defined in lib/ai/penguinClient.ts).

Tests must verify:
- Head CT encounter → returns CPT 70450 + ICD-10 R51.9 (or G43.909) per DEMO_SCENARIOS.md
- Knee MRI encounter → returns CPT 73721 + appropriate ICD-10
- Botox encounter → returns HCPCS J0585 + ICD-10 G43.7xx
- Two consecutive runs of the same input return cached=true on the second
- Requests are gated by AI_SERVICE_TOKEN

Constraints:
- Do not touch other AI handlers.
- Do not bypass the cache — the demo's determinism depends on it.
- AWS credentials should already be available via the standard provider chain — do not embed them.

When done:
- Files changed
- pytest output
- For each demo encounter, the actual codes returned (so the orchestrator can confirm they match DEMO_SCENARIOS.md)
```

- **Verify:** orchestrator runs the Python tests; runs the TS wrapper from a Next.js debug route against each demo encounter and confirms outputs.

---

## phase-3-evidence-extraction — Evidence extraction (Agent H)

- **Type:** agent (general-purpose)
- **Goal:** implement Task 2 (per-criterion evidence with citations + `FaithfulnessDetector` validation) per `AI_INTEGRATION.md`.
- **Why it matters:** the heart of the system. Citations have to be verbatim and faithful.
- **Owns:** `services/ai/evidence_extraction.py`, `services/ai/prompts/evidence_extraction_v1.py`, `services/ai/tests/test_evidence_extraction.py`, `lib/ai/evidenceExtraction.ts`, `lib/ai/schemas/evidenceExtraction.ts`.

### Subagent prompt

```
Goal: Implement Task 2 from AI_INTEGRATION.md — per-criterion evidence extraction using the canonical evidence-citation contract and line-number citation pattern.

Why this matters: The heart of the system. Citations have to be verbatim and resolvable to bboxes or the UI can't highlight them. Hallucinated quotes are the worst-case demo failure.

Required reading (artifacts):
- penguinai-claude-artifacts-main/.claude/contracts/evidence-citation.md — canonical response shape
- penguinai-claude-artifacts-main/.claude/contracts/bbox-format.md — canonical bbox shape (8-point normalized)
- penguinai-claude-artifacts-main/.claude/skills/ai-engineering-guide/usage/03-DOCUMENT-PROCESSING.md — full_text "content || line_number" format, OCRResult helpers, line-number-based bbox retrieval
- penguinai-claude-artifacts-main/.claude/skills/ai-engineering-guide/templates/llm_extractor.py — reference impl

Required reading (our planning docs):
- AI_INTEGRATION.md "Task 2" — locked output schema and prompt
- DEMO_SCENARIOS.md — predicted outcomes per criterion

Context (already done):
- Penguin client + cache + tracing scaffolding at services/ai/.
- FaithfulnessDetector available from `from penguin.output_guard.hallucination import FaithfulnessDetector, Citation`.
- Phase 2 lib/ai/evidenceExtraction.ts has a canned-response stub that the matchEngine already calls. You're replacing the implementation but must keep the same TS contract (so Phase 2 callers don't break).

Your scope:
- /Users/murtaza/Documents/provider_pa/services/ai/evidence_extraction.py
- /Users/murtaza/Documents/provider_pa/services/ai/prompts/evidence_extraction_v1.py
- /Users/murtaza/Documents/provider_pa/services/ai/tests/test_evidence_extraction.py
- /Users/murtaza/Documents/provider_pa/lib/ai/evidenceExtraction.ts (REPLACE the stub; keep its existing exported function signature)
- /Users/murtaza/Documents/provider_pa/lib/ai/schemas/evidenceExtraction.ts

Your contract:
- One LLM call per criterion. Never batch criteria into a single call.
- Pydantic request: { criterion: { id, text, evidence_hint?, required_codes }, corpus: List[Source], pa_id?, provider_id? }
  Source = { id, kind: 'clinical_note'|'attachment'|'policy_pdf', text, line_numbered_text }
  where line_numbered_text is the text formatted as "content || line_number" per line.
- Pydantic response (canonical evidence-citation shape):
  {
    status: 'passed'|'failed'|'needs_info',
    reasoning: str,                # canonical contract field name (not 'rationale')
    confidence: float,
    citations: List[Citation],     # see below
    prompt_version: str,
    trace_id?: str,
    cached: bool,
    citation_validation: 'all_valid'|'some_invalid'|'none_returned'
  }
  Citation = {
    source_type: str,
    source_id: str,
    supporting_texts: List[str],   # verbatim OCR/note excerpts
    bboxes: List[CanonicalBbox],   # canonical bbox-format; empty for plain notes (no spatial data)
    line_numbers: List[int]        # OCR line numbers; redundant with bboxes[].line_numbers when bboxes present
  }
  CanonicalBbox = { document_name: str, page_number: int, bbox: List[List[float]], line_numbers?: List[int] }
- Use `model.with_structured_output(CriterionEvaluation)` where CriterionEvaluation is a single container Pydantic model. NEVER pass a List[...] to with_structured_output — the SDK accepts only a single class.
- Prompt the LLM in line-number-citation style: corpus passed as line-numbered text; LLM returns line_numbers per citation. After LLM return, materialize bboxes via `OCRResult.ocr_result_to_bbox_format(line_numbers=..., page_number=..., document_name=...)` then `strip_page_dimensions()` for any source that came from OCR. For plain text notes (no OCR), bboxes is [] but line_numbers is still populated for in-app highlighting.
- After bbox materialization, instantiate `FaithfulnessDetector` and validate that every supporting_text is a substring of its cited source's text. Drop invalid citations; if any were dropped, downgrade status to 'needs_info' and set citation_validation='some_invalid'.
- Cache key: sha256 of canonicalized { criterion, corpus } (sort sources by id, sort field keys). The Python service reads/writes the ai_call_cache Postgres table.
- Wrap in `PenguinTracer().session(session_id=pa_id, user_id=provider_id)` when pa_id is present. No-op when Langfuse env vars are absent.

The TS lib/ai/evidenceExtraction.ts wrapper:
- Keeps the existing exported function `extractEvidence(criterion, corpus, opts?)` signature so lib/policies/matchEngine.ts (Phase 2) does not need to change.
- Calls /extract-evidence-criterion via penguinClient, validates response with zod against the canonical shape, returns the TS Citation[] shape that matchEngine expects.
- Drops the canned-response branching from the stub — that lives in the cache + canned fallback layer (next ticket).

Tests must verify:
- Head CT: each of the 3 criteria returns 'passed' with at least one citation; supporting_texts are exact substrings of the seeded notes.
- Knee MRI: "Failure of conservative therapy" returns 'needs_info' on first pass (only ortho note in corpus); 'passed' when the PT discharge upload text is added to the corpus.
- Botox: "amitriptyline ≥8 weeks" returns 'needs_info'; "≥15 headache days/month" returns 'passed' with citations to both today's neurology note AND the headache diary.
- Hallucinated-citation test: stub the LLM response with a supporting_text that's not in the corpus; assert the result is downgraded to 'needs_info' with citation_validation='some_invalid'.
- Line-number test: stub the LLM response with line_numbers that don't exist in the OCRResult; assert those citations are dropped (find_line_as_bbox returns None).

Constraints:
- FORBIDDEN LIBRARIES (per CLAUDE.md): no openai, anthropic, langchain (direct), boto3 for Bedrock. Penguin only.
- Do not import the SDK in TypeScript.
- Do not change the matchEngine; only the AI module beneath it.
- Do not log full prompts at info/debug — the audit trail records that an AI call happened, not its full content.
- Cite EXACTLY — never paraphrase. The validator catches paraphrasing but enforce in the prompt too.

When done:
- Files changed
- pytest output (the five tests above)
- Three lines per demo scenario showing the supporting_texts the model produced (orchestrator will eyeball against the seeded notes)
```

- **Verify:** orchestrator runs both Python and TS test suites. Then reruns `scripts/smoke-scenario-1.ts` from Phase 2 with the real AI in the loop — Head CT still lands on Approved, Knee MRI now correctly produces a missing-item, Botox produces the needs_info on amitriptyline.

---

---

## phase-3-cover-letter — Submission packet generation (Agent I)

- **Type:** agent (general-purpose)
- **Goal:** generate a single PDF "submission packet" the provider reviews before clicking final Submit. Page 1 = cover letter (templated structure + LLM-generated narrative paragraph). Page 2 = criteria checklist with each passed criterion's pass marker, AI confidence, and citation excerpts. Pages 3+ = supporting clinical documents (cited notes, provider uploads).
- **Why it matters:** this is what a real payer would actually receive. Without it, "submit" sends a tracking id and nothing else — not a real demonstrable workflow.
- **Owns:** `services/ai/submission_packet.py`, `services/ai/prompts/cover_letter_v1.py`, `services/ai/tests/test_submission_packet.py`, `lib/ai/submissionPacket.ts`, `lib/ai/schemas/submissionPacket.ts`. Schema addition: `Attachment.kind String` discriminator (coordinate with orchestrator before adding).

### Subagent prompt

```
Goal: Build the submission-packet generator for a PA — a single PDF combining a hybrid LLM-generated cover letter, a criteria checklist with citations, and the supporting clinical documents.

Why this matters: This is what the payer simulator actually receives. The demo's "submit" beat lands hollow without it.

Required reading:
- /Users/murtaza/Documents/provider_pa/AI_INTEGRATION.md "Task 5 — Cover letter narrative generation" (locked spec)
- /Users/murtaza/Documents/provider_pa/ARCHITECTURE.md API surface (new POST /api/pa/[id]/submission-packet endpoint) and Attachment model (new kind discriminator)
- penguinai-claude-artifacts-main/.claude/skills/ai-engineering-guide/usage/03-DOCUMENT-PROCESSING.md (PyMuPDF patterns; we use it for both reading and writing PDFs — the kit recommends fitz for all PDF ops)
- penguinai-claude-artifacts-main/.claude/agents/ai-integrator.md (production rules)

Penguin SDK rule (CLAUDE.md "Forbidden libraries"):
- LLM narrative paragraph: penguin.core only (no openai/anthropic/raw boto3 for Bedrock).
- PDF rendering + concatenation: PyMuPDF (fitz) only — same lib penguin.ocr uses internally. No reportlab, weasyprint, pdfkit, etc.
- Cache + tracing wrappers: penguin.core.tracing.PenguinTracer, services/ai/cache.py.

Context (already done):
- Phase 3 evidence extraction returns canonical citations with supporting_texts + bboxes + line_numbers per evidence-citation contract.
- PriorAuth has criteria results, attachments, and codes available via GET /api/pa/[id].
- PyMuPDF (fitz) is already installed in services/ai/ for OCR.

Your scope:
- /Users/murtaza/Documents/provider_pa/services/ai/submission_packet.py (handler + builder)
- /Users/murtaza/Documents/provider_pa/services/ai/prompts/cover_letter_v1.py (LLM prompt for narrative paragraph)
- /Users/murtaza/Documents/provider_pa/services/ai/tests/test_submission_packet.py
- /Users/murtaza/Documents/provider_pa/lib/ai/submissionPacket.ts (TS wrapper)
- /Users/murtaza/Documents/provider_pa/lib/ai/schemas/submissionPacket.ts (zod)

Schema change (coordinate with orchestrator BEFORE editing):
- Add `kind String @default("upload")` to Attachment in prisma/schema.prisma. Values: "upload" (provider drops a doc), "submission_packet" (assembled PDF), "rfi_response" (Phase 5+).
- Add @@index([priorAuthId, kind, uploadedAt]).
- Migration name: 0003_attachment_kind.
- Update ARCHITECTURE.md Attachment model in the same change.

Your contract:
- Pydantic request: { pa_id: str, regenerate: bool, provider_id?: str }
- Pydantic response: { pdf_url: str, attachment_id: str, generated_at: str, narrative_paragraph: str, prompt_version: str, model: str, trace_id?: str, cached: bool }
- Algorithm:
    1. Load the PA: codes, patient, provider, payer, criteria results (passed only — failed/needs_info should not appear in a packet about to be submitted), citations.
    2. Generate the narrative paragraph via Penguin (Task 5 in AI_INTEGRATION.md). Use model.with_structured_output(NarrativeParagraph) where NarrativeParagraph has one field: paragraph_text (str). Use get_model("narrative") which returns claude-haiku-4-5. Cache key includes pa_id + criteria result hashes + prompt_version + model.
    3. Build page 1 (cover letter) using PyMuPDF: header (provider name + NPI + date), patient block (first name + last initial + DOB + payer + plan + member id), the LLM-generated narrative paragraph, the request block (every PriorAuthCode with description), provider signature line.
    4. Build page 2 (criteria checklist): for each PASSED criterion — criterion text, ✓ marker, AI confidence band, supporting_texts excerpts, source attribution ("From: <note name>, line <N>" or "<doc name>, page <P>"). For criteria that were marked passed via manual override, include the provider's override rationale verbatim.
    5. Append pages 3+: in this order — every cited clinical note (full text rendered as PDF pages via fitz Document.new_page + page.insert_text), then every provider upload (if PDF, append as-is via fitz Document.insert_pdf; if text/markdown, render as PDF first via the same insert_text path).
    6. Save to public/submission-packets/{paId}.pdf (local for demo; S3 in production).
    7. Persist as Attachment row with kind="submission_packet", filename=`pa-${paId}-packet.pdf`, mimeType="application/pdf", storageUrl=relative path, uploadedBy="system".
    8. If regenerate=true, the previous submission_packet attachment for this PA stays in the DB for audit but is superseded by uploadedAt ordering — the API always returns the latest.

The TS wrapper lib/ai/submissionPacket.ts:
- Exports `generateSubmissionPacket(paId, opts?): Promise<{pdfUrl, attachmentId, generatedAt, narrativeParagraph}>`.
- Calls /generate-submission-packet via penguinClient, validates with zod.
- Includes a canned-response fallback path for the three demo scenarios per phase-3-canned-fallback (so the packet still generates with placeholder narrative if FastAPI is unreachable).

Tests must verify:
- All three demo scenarios generate a packet end-to-end. PDF opens cleanly (use fitz to verify page count > 0 and text extractable from page 1).
- Page 1 contains the patient first name, the procedure code, and the narrative paragraph.
- Page 2 lists every passed criterion with at least one supporting_text excerpt.
- For Knee MRI scenario: the appended pages include the PT discharge text the provider uploaded (not just the original ortho note).
- For Botox scenario: the appended pages include the manual override rationale.
- regenerate=true produces a new attachment row; the old one is still in the DB but the API returns the new one.

Constraints:
- LLM only via penguin.core (no openai/anthropic/raw boto3 for Bedrock) — same forbidden-libraries rule as evidence extraction.
- PDF generation only via PyMuPDF (fitz). No reportlab, weasyprint, etc.
- Cache key: (task="cover_letter", prompt_version, model, sha256(canonicalized criteria results + codes + patient summary)).
- Wrap in PenguinTracer().session() when provider_id present.
- Patient identifiers in the cover letter narrative: first name + last initial only (no full last name, no DOB, no member id). Structured patient block above/below the paragraph has the full info.

When done:
- Files changed
- Schema migration name + column added
- pytest output
- For each demo scenario, attach the generated PDF path so the orchestrator can open it manually
```

- **Verify:** orchestrator opens each generated PDF (`public/submission-packets/<paId>.pdf`), confirms cover letter reads naturally, criteria checklist matches the in-app checklist, appended documents include everything cited. Confirms `grep -rn "from openai\|from anthropic\|import reportlab\|import weasyprint" services/ai/` returns 0 hits.

## phase-3-canned-fallback — Canned response fallback layer

- **Type:** inline (orchestrator)
- **Goal:** wrap the TS AI clients (`lib/ai/codeDerivation.ts`, `lib/ai/evidenceExtraction.ts`) with a fallback layer that returns hard-coded results for the three demo scenarios when the FastAPI service throws `AiUnreachableError`.
- **Why it matters:** belt-and-suspenders for live demos on bad WiFi. The cache (Phase 3 main) handles "AI is up but slow"; canned fallback handles "AI is unreachable entirely".
- **Owns:** `lib/ai/cannedResponses.ts`, edits to `lib/ai/codeDerivation.ts` and `lib/ai/evidenceExtraction.ts` to fall back when `AiUnreachableError` is thrown.
- **Depends on:** `phase-3-code-derivation`, `phase-3-evidence-extraction`.
- **Contract:**
  - `cannedResponses.ts` exports a typed map keyed by `(task, encounterId, criterionId?)`.
  - The fallback only triggers on `AiUnreachableError` (not on `AiInvalidResponseError` — that should fail loudly).
  - When the fallback fires, the result includes `source: 'canned'` so the audit log can mark it.
  - The map covers every (encounter, criterion) the three demo scenarios touch — and only those. If the map is queried for an unknown key, throw — we want to know if a non-demo path tried to use the fallback.
- **Verify:** orchestrator stops the FastAPI service mid-demo and confirms each scenario still completes through the UI without errors.

---

## phase-3-policy-ingestion — Policy ingestion (deferred)

- **Type:** agent (general-purpose) — runs only when the UHC PDF arrives
- **Goal:** Task 3 from `AI_INTEGRATION.md`. Penguin OCR → section identification → criteria extraction → write to `policy_drafts`.
- **Why it matters:** demonstrates the AI policy ingestion pipeline. NOT on the demo critical path.
- **Owns:** `services/ai/policy_ingestion.py`, `services/ai/prompts/policy_ingestion_v1.py`, `services/ai/tests/test_policy_ingestion.py`, `lib/ai/policyIngestion.ts`, `scripts/ingest-uhc-pdf.ts`.
- **Depends on:** UHC PDF delivery + this phase's other tickets.
- **Contract:** see Phase 1 ticket `phase-1-uhc-ingest`. Implementation lands here; the script wrapper lands in Phase 1's deferred ticket.
- **Verify:** orchestrator runs `pnpm tsx scripts/ingest-uhc-pdf.ts <path>` against the delivered PDF and reads the resulting draft policy.

---

## Phase 3 exit checklist

**Step 1 — Orchestrator quick checks:**
- [ ] `services/ai/tests/` passes; `__tests__/lib/ai/` passes
- [ ] `services/ai/tests/test_submission_packet.py` passes for all three demo scenarios
- [ ] Three submission-packet PDFs exist at `public/submission-packets/` and open cleanly (fitz can parse them)
- [ ] AI cache populated; second run of the same input is detectably faster (no LLM call)

**Step 2 — Integration-tester gate (per `ORCHESTRATION.md`):**
- [ ] All three demo scenarios produce the expected pass/fail/needs_info outcomes from `DEMO_SCENARIOS.md` against the hand-curated policies, with the real Penguin SDK in the loop
- [ ] integration-tester runs the canned-fallback drill (kills FastAPI mid-run); all three scenarios still complete with `source: 'canned'` events in the audit trail
- [ ] integration-tester verifies bbox shape matches the canonical `bbox-format` contract — 8-point normalized arrays, integer page_number, document_name matches a `files[]` entry, no empty bboxes
- [ ] integration-tester verifies citation `supporting_texts` are exact substrings of their cited source (faithfulness check)
- [ ] integration-tester opens each submission-packet PDF and verifies: page 1 has the expected codes/patient/narrative paragraph; page 2 lists every passed criterion with citation excerpts; pages 3+ include all cited notes + provider uploads

**Other:**
- [ ] Policy ingestion ticket (formerly deferred) annotated in `tasks/STATUS.md` — active now that UHC PDFs are available

When both steps pass, the orchestrator updates `tasks/STATUS.md` and Phase 4 begins automatically.
