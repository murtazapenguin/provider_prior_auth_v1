"""Cover letter narrative prompt — version 1.

Used by the submission packet generator to produce the LLM-generated narrative
paragraph that appears on page 1 of the submission PDF.

HARD RULE: Do not log full prompt content at info/debug level.
"""

COVER_LETTER_PROMPT_VERSION = "cover_letter_v1"

COVER_LETTER_SYSTEM_PROMPT = """\
You are a clinical documentation specialist helping a provider write a concise medical
necessity narrative for a prior authorization submission.

CRITICAL RULES — read carefully before responding:

1. NARRATIVE: Write exactly ONE paragraph (3–5 sentences) explaining why the requested
   procedure or medication is medically necessary for this patient.

2. PATIENT IDENTIFIERS: Use first name + last initial ONLY (e.g. "Jordan A.").
   Do NOT include full last name, date of birth, member ID, or any other PHI in the
   paragraph. Structured demographic blocks above and below the paragraph carry full info.

3. CLINICAL GROUNDING: Base the narrative on the criteria results provided. For each
   passed criterion, weave the clinical evidence into the narrative. For manual overrides,
   reference the provider's rationale verbatim.

4. POLICY ALIGNMENT: Explicitly reference the requested procedure code(s) and the
   documented medical necessity. Avoid vague statements like "patient needs this."

5. TONE: Professional, factual, third-person. Suitable for direct submission to a payer.

6. LENGTH: One tight paragraph. No bullet points. No headers. No more than 5 sentences.
"""

COVER_LETTER_USER_TEMPLATE = """\
Please write the medical necessity narrative paragraph for this prior authorization.

PATIENT: {patient_first_name} {patient_last_initial}.
REQUESTED PROCEDURE(S): {procedure_codes_and_descriptions}
PAYER: {payer_name}

CRITERIA RESULTS (passed + manual overrides only):
{criteria_summary}

Write the narrative paragraph now.
"""


def build_user_message(
    patient_first_name: str,
    patient_last_initial: str,
    procedure_codes_and_descriptions: str,
    payer_name: str,
    criteria_summary: str,
) -> str:
    """Build the user message for the cover letter narrative LLM call."""
    return COVER_LETTER_USER_TEMPLATE.format(
        patient_first_name=patient_first_name,
        patient_last_initial=patient_last_initial,
        procedure_codes_and_descriptions=procedure_codes_and_descriptions,
        payer_name=payer_name,
        criteria_summary=criteria_summary,
    )


def format_criteria_summary(criteria_results: list[dict]) -> str:
    """Format criteria results (passed + manual_override) for the LLM prompt.

    Each row is rendered as:
      [PASSED] Criterion text
        Evidence: <supporting_text excerpt>
    or:
      [OVERRIDE] Criterion text
        Provider rationale: <rationale verbatim>

    Criteria with status 'failed' or 'needs_info' are excluded.
    Criteria are sorted by criterion_id for stable ordering.
    """
    rows: list[str] = []
    for result in sorted(criteria_results, key=lambda r: r.get("criterion_id", "")):
        status = result.get("status", "")
        if status not in ("passed", "manual_override"):
            continue

        criterion_text = result.get("criterion_text", "")
        if status == "manual_override":
            rationale = result.get("rationale", "")
            rows.append(f"[OVERRIDE] {criterion_text}\n  Provider rationale: {rationale}")
        else:
            # Pull first supporting_text from first citation if available.
            # Support both snake_case (Python) and camelCase (asyncpg row) keys.
            citations = result.get("citations", [])
            excerpt = ""
            if citations:
                cit = citations[0]
                texts = cit.get("supporting_texts") or cit.get("supportingTexts") or []
                if texts:
                    excerpt = texts[0][:200]  # Truncate to avoid token explosion.
            if excerpt:
                rows.append(f"[PASSED] {criterion_text}\n  Evidence: {excerpt}")
            else:
                rows.append(f"[PASSED] {criterion_text}")

    return "\n\n".join(rows) if rows else "No passed criteria recorded."
