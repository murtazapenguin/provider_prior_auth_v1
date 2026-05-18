"""Evidence extraction prompt — version 1.

Registered at FastAPI startup via penguin.prompts.register_prompt.

HARD RULE: Do not log full prompt content at info/debug level.
The audit trail records that an AI call happened; it does not include
the full prompt or patient content.
"""

EVIDENCE_EXTRACTION_PROMPT_VERSION = "evidence_extraction_v1"

EVIDENCE_EXTRACTION_SYSTEM_PROMPT = """\
You are a clinical reviewer evaluating whether a single prior-authorization criterion \
is satisfied by a patient's chart.

CRITICAL RULES — read carefully before responding:

1. VERDICT: You must return one of:
   - "passed"     : clear, specific evidence in the chart satisfies the criterion
   - "failed"     : the chart explicitly contradicts the criterion or clearly lacks
                    what it requires, even after close reading
   - "needs_info" : the chart is ambiguous, partial, or missing information —
                    use this when you cannot confidently say passed OR failed

2. REASONING: One to two sentences. State what you found (or didn't find) and why
   it does or does not satisfy the criterion.

3. CONFIDENCE: A float 0.0–1.0 reflecting how certain you are about the verdict.
   Use < 0.7 only if genuinely uncertain.

4. CITATIONS — YOU MUST:
   - Return AT LEAST ONE citation when status is "passed" or "failed".
   - For "needs_info", cite the closest near-miss lines if any exist.
   - For each citation, identify the source_id (from the corpus header lines),
     list the line_numbers within that source where you found the evidence,
     and reproduce the supporting_texts VERBATIM — character-for-character as
     they appear in the corpus. Do NOT paraphrase, summarize, or combine lines.
   - Use only source_ids that appear in the corpus. Do not invent source_ids.
   - Multiple citations are allowed if evidence spans multiple sources.

5. LINE NUMBERS: The corpus uses the format "content || N" where N is the line
   number within that source. Cite the N values in line_numbers. These map
   directly to bounding boxes in the document viewer.

6. VERBATIM RULE: supporting_texts entries must be exact substrings of the cited
   source text. A validator will check every entry against the original. Any
   paraphrase will be rejected and downgrade the verdict to needs_info.
"""

EVIDENCE_EXTRACTION_USER_TEMPLATE = """\
Criterion ID: {criterion_id}
Criterion: {criterion_text}
Evidence hint: {evidence_hint}
Required diagnosis codes: {required_codes}

Chart corpus (line-numbered, format: "content || line_number"):
{corpus_with_source_ids}
"""


def build_user_message(
    criterion_id: str,
    criterion_text: str,
    evidence_hint: str | None,
    required_codes: list[str],
    corpus_with_source_ids: str,
) -> str:
    """Build the user message for a single criterion evaluation."""
    return EVIDENCE_EXTRACTION_USER_TEMPLATE.format(
        criterion_id=criterion_id,
        criterion_text=criterion_text,
        evidence_hint=evidence_hint or "none",
        required_codes=", ".join(required_codes) if required_codes else "none",
        corpus_with_source_ids=corpus_with_source_ids,
    )


def format_corpus(sources: list[dict]) -> str:
    """Format a list of sources into the line-numbered corpus string.

    Each source is preceded by a header line identifying its ID and kind.
    Lines within each source are formatted as "content || N".
    """
    parts: list[str] = []
    for src in sources:
        src_id = src["id"]
        kind = src.get("kind", "clinical_note")
        # Use pre-formatted line_numbered_text if provided; otherwise build it.
        line_text = src.get("line_numbered_text") or _build_line_numbered_text(src.get("text", ""))
        parts.append(f"--- SOURCE {src_id} (kind={kind}) ---")
        parts.append(line_text)
    return "\n".join(parts)


def _build_line_numbered_text(raw_text: str) -> str:
    """Convert plain text to 'content || line_number' format (1-indexed)."""
    lines = raw_text.splitlines()
    return "\n".join(f"{line} || {i + 1}" for i, line in enumerate(lines))
