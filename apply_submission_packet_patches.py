#!/usr/bin/env python3
"""
Apply the submission-packet feature patches to the planning docs.

Run from the repo root (/Users/murtaza/provider_pa_hackathon):
    python3 apply_submission_packet_patches.py

Adds the "submission packet" feature (hybrid cover letter + criteria checklist
+ supporting docs as one PDF) across:
  - tasks/phase-3-ai.md         (new ticket + sequencing + exit checklist)
  - AI_INTEGRATION.md           (Task 5 spec)
  - tasks/phase-4-ui.md         (review screen modifications)
  - ARCHITECTURE.md             (Attachment.kind + new endpoint)
  - DEMO_SCENARIOS.md           (scenario flow updates)
  - HACKATHON_SCOPE.md          (in/out reclassification)
  - tasks/STATUS.md             (mid-stream addition note)

Each modified file is backed up to <file>.bak.<timestamp> first. Idempotent —
safe to re-run; substitutions that already landed are reported as skipped.

Penguin SDK rule reinforcement: this feature uses penguin.core for the LLM
narrative call. PyMuPDF (fitz) is the only non-Penguin library involved
(PDF generation/concatenation), which is the kit's recommended pattern —
penguin.ocr uses fitz internally and there's no Penguin PDF-creation API.
"""

import datetime
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
TS = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

# ---------------------------------------------------------------------------
# Patch payloads
# ---------------------------------------------------------------------------

# --- Patch 1a: tasks/phase-3-ai.md — insert new ticket -----------------------

PHASE3_NEW_TICKET = '''---

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
- /Users/murtaza/provider_pa_hackathon/AI_INTEGRATION.md "Task 5 — Cover letter narrative generation" (locked spec)
- /Users/murtaza/provider_pa_hackathon/ARCHITECTURE.md API surface (new POST /api/pa/[id]/submission-packet endpoint) and Attachment model (new kind discriminator)
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
- /Users/murtaza/provider_pa_hackathon/services/ai/submission_packet.py (handler + builder)
- /Users/murtaza/provider_pa_hackathon/services/ai/prompts/cover_letter_v1.py (LLM prompt for narrative paragraph)
- /Users/murtaza/provider_pa_hackathon/services/ai/tests/test_submission_packet.py
- /Users/murtaza/provider_pa_hackathon/lib/ai/submissionPacket.ts (TS wrapper)
- /Users/murtaza/provider_pa_hackathon/lib/ai/schemas/submissionPacket.ts (zod)

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

- **Verify:** orchestrator opens each generated PDF (`public/submission-packets/<paId>.pdf`), confirms cover letter reads naturally, criteria checklist matches the in-app checklist, appended documents include everything cited. Confirms `grep -rn "from openai\\|from anthropic\\|import reportlab\\|import weasyprint" services/ai/` returns 0 hits.

'''

PHASE3_SEQUENCING_OLD = '''Then parallel × 2:
- **Agent G: Code derivation.**'''

# Find the "Then parallel x 2:" section and add the new ticket reference inline.
# The actual sequencing list lives elsewhere — search for the right anchor.
PHASE3_TICKET_LIST_ANCHOR = '''## phase-3-canned-fallback'''

PHASE3_EXIT_CHECKLIST_ANCHOR_STEP1 = '''- [ ] `services/ai/tests/` passes; `__tests__/lib/ai/` passes'''
PHASE3_EXIT_CHECKLIST_STEP1_ADD = '''- [ ] `services/ai/tests/` passes; `__tests__/lib/ai/` passes
- [ ] `services/ai/tests/test_submission_packet.py` passes for all three demo scenarios
- [ ] Three submission-packet PDFs exist at `public/submission-packets/` and open cleanly (fitz can parse them)'''

PHASE3_EXIT_CHECKLIST_ANCHOR_STEP2 = '''- [ ] integration-tester verifies citation `supporting_texts` are exact substrings of their cited source (faithfulness check)'''
PHASE3_EXIT_CHECKLIST_STEP2_ADD = '''- [ ] integration-tester verifies citation `supporting_texts` are exact substrings of their cited source (faithfulness check)
- [ ] integration-tester opens each submission-packet PDF and verifies: page 1 has the expected codes/patient/narrative paragraph; page 2 lists every passed criterion with citation excerpts; pages 3+ include all cited notes + provider uploads'''


# --- Patch 2: AI_INTEGRATION.md — add Task 5 ---------------------------------

AI_INTEGRATION_TASK5 = '''## Task 5 — Cover letter narrative generation

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

'''

AI_INTEGRATION_ANCHOR = '''## Patterns we'll use throughout'''


# --- Patch 3: tasks/phase-4-ui.md — modify review-tracker --------------------

PHASE4_REVIEW_OLD = '''- Review screen: final read-only summary of codes + criteria + citations; "Submit to payer" button with confirmation modal; "Back to checklist" button.'''

PHASE4_REVIEW_NEW = '''- Review screen (TWO-PANEL LAYOUT):
  - Left: read-only summary of codes + criteria + citations.
  - Right: **SubmissionPacketPreview** showing the generated PDF inline via the data-labelling-library PDFViewer. Pass `documentData={files:["pa-<paId>-packet.pdf"], presigned_urls: { "pa-<paId>-packet.pdf": { "1": "/submission-packets/<paId>.pdf?page=1", ... } }}`.
  - Below the preview: **"Regenerate packet"** button (calls `POST /api/pa/[id]/submission-packet` with `regenerate=true`; preview re-renders on completion).
  - "Submit to payer" button at the bottom — DISABLED until a packet exists for this PA.
- On first arrival at `/pa/[id]/review` (no existing packet): auto-trigger packet generation via `POST /api/pa/[id]/submission-packet` with `regenerate=false`. Show a loading state "Assembling submission packet..." until ready (~3-5 seconds including the LLM narrative call).
- Confirmation modal on Submit ("This will send the assembled PDF to the payer. Continue?"); "Back to checklist" button at the top.'''

PHASE4_REVIEW_OWNS_OLD = '''- **Owns:** `app/(provider)/pa/[id]/review/`, `app/(provider)/pa/[id]/tracker/`, `components/pa/SubmitConfirmation.tsx`, `components/pa/Tracker.tsx`, `components/pa/AdminFastForward.tsx`.'''

PHASE4_REVIEW_OWNS_NEW = '''- **Owns:** `app/(provider)/pa/[id]/review/`, `app/(provider)/pa/[id]/tracker/`, `components/pa/SubmitConfirmation.tsx`, `components/pa/SubmissionPacketPreview.tsx`, `components/pa/Tracker.tsx`, `components/pa/AdminFastForward.tsx`.'''

PHASE4_REVIEW_SCREENSHOTS_OLD = '''- Screenshots of: (a) review screen, (b) tracker mid-Pending, (c) tracker showing RFI for Botox, (d) tracker showing Approved'''

PHASE4_REVIEW_SCREENSHOTS_NEW = '''- Screenshots of: (a) review screen with submission-packet preview rendered, (b) review screen mid-regenerate showing the loading state, (c) tracker mid-Pending, (d) tracker showing RFI for Botox, (e) tracker showing Approved'''


# --- Patch 4a: ARCHITECTURE.md — Attachment model ----------------------------

ARCH_ATTACHMENT_OLD = '''model Attachment {
  id          String   @id @default(cuid())
  priorAuthId String
  priorAuth   PriorAuth @relation(fields: [priorAuthId], references: [id])
  filename    String
  mimeType    String
  storageUrl  String
  uploadedBy  String   // provider id or "system"
  uploadedAt  DateTime @default(now())
  extractedText String?  // text extracted at ingestion time, for re-runs
}'''

ARCH_ATTACHMENT_NEW = '''model Attachment {
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
  @@index([priorAuthId, kind, uploadedAt])
}'''


# --- Patch 4b: ARCHITECTURE.md — API surface ---------------------------------

ARCH_API_ANCHOR = '''| `POST` | `/api/pa/:id/upload` | Attach a document; auto-triggers recheck |'''
ARCH_API_NEW = '''| `POST` | `/api/pa/:id/upload` | Attach a document; auto-triggers recheck |
| `POST` | `/api/pa/:id/submission-packet` | Generate (or regenerate) the submission-packet PDF; returns `{pdfUrl, attachmentId, generatedAt, narrativeParagraph}` |'''


# --- Patch 5: DEMO_SCENARIOS.md — scenario flows -----------------------------

DEMO_HEAD_CT_OLD = '''- Provider reviews, clicks submit.'''
DEMO_HEAD_CT_NEW = '''- Provider clicks Continue to review screen → submission packet auto-generates (~3 seconds; LLM narrative paragraph + assembled PDF) → provider reviews packet preview → clicks Submit.'''

DEMO_KNEE_OLD = '''- All criteria pass on second run.
- PA auto-transitions Draft → **Ready for Submission**.
- Provider submits.'''
DEMO_KNEE_NEW = '''- All criteria pass on second run.
- PA auto-transitions Draft → **Ready for Submission**.
- Provider clicks Continue to review screen → submission packet auto-generates (now includes the PT discharge upload from the recheck loop) → provider reviews → clicks Submit.'''

DEMO_BOTOX_OLD = '''- All criteria green (after override), PA → Ready for Submission, provider submits.'''
DEMO_BOTOX_NEW = '''- All criteria green (after override), PA → Ready for Submission. Provider clicks Continue to review screen → submission packet auto-generates (includes the manual override rationale on page 2 alongside the cited evidence) → provider reviews → clicks Submit.'''


# --- Patch 6: HACKATHON_SCOPE.md — letter generation reclassification --------

SCOPE_OUT_OLD = '''- Letter generation (approval, denial, peer-to-peer requests)'''
SCOPE_OUT_NEW = '''- Approval / denial / peer-to-peer letter generation (the system *does* generate the submission cover letter packet that goes to the payer at submit time — see "In scope")'''

SCOPE_IN_ANCHOR = '''- Mock submission to payer (HTTP call to internal simulator, no real X12 / FHIR)'''
SCOPE_IN_NEW = '''- Mock submission to payer (HTTP call to internal simulator, no real X12 / FHIR)
- Submission packet generation: at submit time, assemble a single PDF containing (page 1) a hybrid templated + LLM-generated cover letter, (page 2) the criteria checklist with passed criteria and their citation excerpts, (pages 3+) every cited clinical note and provider upload. Read-only preview on the review screen with a Regenerate button. Persists as an Attachment with `kind="submission_packet"`. LLM narrative via `penguin.core`; PDF generation via PyMuPDF.'''


# --- Patch 7: tasks/STATUS.md — new bullet -----------------------------------

STATUS_BULLET = '''- Mid-stream addition (between Phase 2 and Phase 3): submission-packet generation is in scope. Hybrid cover letter (templated structure + LLM narrative paragraph via `penguin.core`), structured criteria checklist on page 2, supporting clinical docs appended after. Read-only preview on the review screen with a Regenerate button. New Phase 3 ticket `phase-3-cover-letter` (Agent I); modified Phase 4 `phase-4-review-tracker`. New `Attachment.kind` discriminator. AI_INTEGRATION.md "Task 5" spec added. PDF rendering via PyMuPDF (the only non-Penguin lib involved — penguin.ocr uses fitz internally and the SDK has no PDF-creation API). Approval/denial letter generation remains out of scope.'''

STATUS_BULLET_INSERT_AFTER = '''- Real data files dropped at repo root:'''


# ---------------------------------------------------------------------------
# Patch application
# ---------------------------------------------------------------------------

class PatchResult:
    def __init__(self, ok, msg):
        self.ok = ok
        self.msg = msg

def patch_file(path, substitutions, inserts_after=None):
    """
    substitutions: list of (old, new) — replaces first occurrence
    inserts_after: list of (anchor, payload) — appends payload right after the LINE containing anchor
    """
    full = REPO_ROOT / path
    if not full.exists():
        return PatchResult(False, f"  ❌ File not found: {full}")

    text = full.read_text(encoding="utf-8")
    original = text
    log = []

    for old, new in substitutions or []:
        if new in text:
            log.append(f"  ⏭  already applied (substitute)")
            continue
        if old not in text:
            log.append(f"  ❌ anchor not found (substitute)\n      first 80 chars: {old[:80]!r}")
            continue
        text = text.replace(old, new, 1)
        log.append(f"  ✅ substituted")

    for anchor, payload in inserts_after or []:
        if payload.strip().splitlines()[0] in text:
            log.append(f"  ⏭  already applied (insert)")
            continue
        if anchor not in text:
            log.append(f"  ❌ anchor not found (insert): {anchor[:80]!r}")
            continue
        # Insert payload after the line containing the anchor
        idx = text.find(anchor)
        eol = text.find("\n", idx)
        if eol == -1:
            text = text + "\n" + payload
        else:
            text = text[:eol+1] + payload + text[eol+1:]
        log.append(f"  ✅ inserted")

    if text == original:
        return PatchResult(True, f"  (no changes; all already applied)\n" + "\n".join(log))

    backup = full.with_suffix(full.suffix + f".bak.{TS}")
    backup.write_text(original, encoding="utf-8")
    full.write_text(text, encoding="utf-8")
    return PatchResult(True, f"  💾 backup: {backup.name}\n" + "\n".join(log))


PATCHES = [
    ("tasks/phase-3-ai.md (new ticket + exit checklist)", "tasks/phase-3-ai.md", [
        # Step 1 exit checklist update
        (PHASE3_EXIT_CHECKLIST_ANCHOR_STEP1, PHASE3_EXIT_CHECKLIST_STEP1_ADD),
        # Step 2 exit checklist update
        (PHASE3_EXIT_CHECKLIST_ANCHOR_STEP2, PHASE3_EXIT_CHECKLIST_STEP2_ADD),
    ], [
        # Insert new ticket BEFORE phase-3-canned-fallback header. We insert right
        # after the closing of phase-3-evidence-extraction, anchored on "## phase-3-canned-fallback"
        # by using inserts_after on the line right before the canned-fallback header.
    ]),
    ("AI_INTEGRATION.md (Task 5)", "AI_INTEGRATION.md", [
        (AI_INTEGRATION_ANCHOR, AI_INTEGRATION_TASK5 + AI_INTEGRATION_ANCHOR),
    ], []),
    ("tasks/phase-4-ui.md (review screen)", "tasks/phase-4-ui.md", [
        (PHASE4_REVIEW_OLD, PHASE4_REVIEW_NEW),
        (PHASE4_REVIEW_OWNS_OLD, PHASE4_REVIEW_OWNS_NEW),
        (PHASE4_REVIEW_SCREENSHOTS_OLD, PHASE4_REVIEW_SCREENSHOTS_NEW),
    ], []),
    ("ARCHITECTURE.md (Attachment + endpoint)", "ARCHITECTURE.md", [
        (ARCH_ATTACHMENT_OLD, ARCH_ATTACHMENT_NEW),
        (ARCH_API_ANCHOR, ARCH_API_NEW),
    ], []),
    ("DEMO_SCENARIOS.md (3 flows)", "DEMO_SCENARIOS.md", [
        (DEMO_HEAD_CT_OLD, DEMO_HEAD_CT_NEW),
        (DEMO_KNEE_OLD, DEMO_KNEE_NEW),
        (DEMO_BOTOX_OLD, DEMO_BOTOX_NEW),
    ], []),
    ("HACKATHON_SCOPE.md (in/out reclassification)", "HACKATHON_SCOPE.md", [
        (SCOPE_OUT_OLD, SCOPE_OUT_NEW),
        (SCOPE_IN_ANCHOR, SCOPE_IN_NEW),
    ], []),
    ("tasks/STATUS.md (mid-stream bullet)", "tasks/STATUS.md", [], [
        (STATUS_BULLET_INSERT_AFTER, STATUS_BULLET + "\n"),
    ]),
]


def patch_phase3_new_ticket():
    """Special-case: insert the new ticket text BEFORE the canned-fallback header."""
    path = REPO_ROOT / "tasks/phase-3-ai.md"
    if not path.exists():
        return PatchResult(False, "  ❌ tasks/phase-3-ai.md not found")
    text = path.read_text(encoding="utf-8")
    if "## phase-3-cover-letter" in text:
        return PatchResult(True, "  ⏭  already applied")
    if PHASE3_TICKET_LIST_ANCHOR not in text:
        return PatchResult(False, f"  ❌ canned-fallback header not found")
    backup = path.with_suffix(path.suffix + f".bak.{TS}.newticket")
    backup.write_text(text, encoding="utf-8")
    new_text = text.replace(
        PHASE3_TICKET_LIST_ANCHOR,
        PHASE3_NEW_TICKET + PHASE3_TICKET_LIST_ANCHOR,
        1,
    )
    path.write_text(new_text, encoding="utf-8")
    return PatchResult(True, f"  💾 backup: {backup.name}\n  ✅ inserted phase-3-cover-letter ticket")


def main():
    print(f"Applying submission-packet patches in: {REPO_ROOT}")
    print(f"Backup suffix: .bak.{TS}\n")

    if not (REPO_ROOT / "CLAUDE.md").exists():
        print("ERROR: CLAUDE.md not found at script directory.")
        print("Run this script from the repo root (provider_pa_hackathon/).")
        sys.exit(1)

    print("─" * 70)
    print("Special: insert phase-3-cover-letter ticket")
    print("─" * 70)
    r = patch_phase3_new_ticket()
    print(r.msg)
    print()

    failures = 0
    for label, relpath, subs, inserts in PATCHES:
        print("─" * 70)
        print(f"Patching: {label}")
        print(f"File:     {relpath}")
        print("─" * 70)
        r = patch_file(relpath, subs, inserts)
        print(r.msg)
        if not r.ok:
            failures += 1
        print()

    print("=" * 70)
    if failures == 0:
        print(f"DONE. All patches applied successfully.")
        print(f"Backups in *.bak.{TS} files (delete after you verify).")
    else:
        print(f"FAILED on {failures} patch group(s). Check ❌ markers above.")
        print(f"Anchor texts that didn't match likely mean those sections have")
        print(f"been edited since planning. Apply those patches manually.")
    print("=" * 70)
    sys.exit(0 if failures == 0 else 1)


if __name__ == "__main__":
    main()
