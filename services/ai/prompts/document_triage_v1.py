"""Document-triage prompt — version 1 (Phase 6).

Registered at import time via penguin.prompts.register_prompt.  Wrapped in
try/except so unit tests / offline environments can still import this module.

HARD RULES (CLAUDE.md / AI_INTEGRATION.md):
- Do NOT log full prompt content at info/debug level.  The audit trail
  records that an AI call happened; it does not include the patient content.
- Inclusion bias: when uncertain, the LLM should err toward
  `recommended_for_extraction=true` — false negatives lose evidence
  downstream; false positives only cost a bit more in extraction.  Recall
  ≥ 0.95 is the harder eval constraint (see TESTING.md "AI quality" row
  for document_triage_eval.py).
"""

DOCUMENT_TRIAGE_PROMPT_VERSION = "document_triage_v1"

DOCUMENT_TRIAGE_SYSTEM_PROMPT = """\
You are a clinical reviewer triaging documents in a patient's chart.

For ONE prior-authorization criterion at a time, you are given a list of
chart documents (with metadata and a short snippet of OCR'd text from each).
Your job is to score each document's relevance to the criterion so a more
expensive downstream extraction step only runs on the documents that
plausibly contain evidence.

CRITICAL RULES — read carefully before responding:

1. ONE SCORE PER DOCUMENT: For every document in the input list, produce
   one RelevanceScore with the document's `document_id` exactly as supplied.
   Do NOT skip documents — even when the snippet is uninformative, return a
   score (you should default to a HIGH score in that case — see rule 5).

2. SCORE RANGE: `score` is a float in [0.0, 1.0].
   - 0.9-1.0 : clearly directly relevant (e.g. doc snippet mentions the
               criterion's clinical condition or finding)
   - 0.6-0.9 : likely relevant (related specialty / topic; snippet hints
               at the criterion)
   - 0.3-0.6 : possibly relevant (general clinical doc that COULD contain
               relevant info beyond the snippet)
   - 0.0-0.3 : almost certainly not relevant (e.g. a billing summary, a
               dental visit when the criterion is about migraines)

3. RECOMMENDED_FOR_EXTRACTION: Set true when the document is plausibly
   useful for evaluating this criterion.  When in doubt, set true.
   Inclusion bias: it is far better to include an unhelpful document in
   the extraction step than to skip one that contains the only evidence.

4. REASONING: One short sentence (10-30 words) explaining why this document
   is or is not relevant.  Reference the criterion, doc_type, author_role,
   or snippet content — do NOT paraphrase patient details.

5. SPARSE SNIPPETS:  When the snippet is empty, garbled, or shorter than a
   typical sentence (under ~30 chars of usable content), default to
   `score >= 0.5` and `recommended_for_extraction=true`.  The full document
   may still contain evidence even when the snippet doesn't capture it.

6. DETERMINISM: The same input always produces the same output.  Do not
   inject randomness or year-/date-relative reasoning ("this is recent")
   unless the criterion explicitly demands recency.

OUTPUT FORMAT: a single `RelevanceScores` object whose `scores` field is a
list with exactly one entry per input document.  The order does not have
to match the input order, but every document_id must appear exactly once.
"""

DOCUMENT_TRIAGE_USER_TEMPLATE = """\
Criterion ID: {criterion_id}
Criterion: {criterion_text}
Evidence hint: {evidence_hint}
Required diagnosis codes: {required_codes}

Documents to score ({n_docs} total):
{documents_block}
"""


def _format_doc(doc: dict, index: int) -> str:
    """Format one document for the prompt.

    The snippet is what the caller provided (~500 chars max — TS-side
    caller is responsible for the slice).  We do NOT re-truncate here.
    """
    snippet = (doc.get("snippet") or "").strip()
    return (
        f"[{index + 1}] document_id={doc['id']}  fhir_id={doc.get('fhir_id', 'n/a')}\n"
        f"    doc_type={doc.get('doc_type', 'Unknown')}  "
        f"author_role={doc.get('author_role', 'Unknown')}  "
        f"authored_at={doc.get('authored_at', 'unknown')}\n"
        f"    snippet: {snippet if snippet else '<empty>'}"
    )


def build_user_message(
    *,
    criterion_id: str,
    criterion_text: str,
    evidence_hint: str | None,
    required_codes: list[str],
    documents: list[dict],
) -> str:
    """Build the user message for ONE criterion's triage call.

    Args:
        criterion_id: stable criterion identifier (passed back in scores)
        criterion_text: the policy criterion being triaged against
        evidence_hint: optional hint from policy ingestion (string or None)
        required_codes: ICD-10 / procedure codes attached to the criterion
        documents: list of doc-meta dicts with keys
            {id, fhir_id, doc_type, authored_at, author_role, snippet}
    """
    documents_block = "\n\n".join(_format_doc(d, i) for i, d in enumerate(documents))
    return DOCUMENT_TRIAGE_USER_TEMPLATE.format(
        criterion_id=criterion_id,
        criterion_text=criterion_text,
        evidence_hint=evidence_hint or "none",
        required_codes=", ".join(required_codes) if required_codes else "none",
        n_docs=len(documents),
        documents_block=documents_block,
    )


# Register the prompt with the Penguin prompt store at import time.
# Wrapped in try/except so tests and offline environments can still import this module.
try:
    import penguin.prompts as _penguin_prompts  # noqa: PLC0415
    _penguin_prompts.register_prompt(
        "pa_workflow",
        DOCUMENT_TRIAGE_PROMPT_VERSION,
        content=DOCUMENT_TRIAGE_SYSTEM_PROMPT,
    )
except Exception:
    pass
