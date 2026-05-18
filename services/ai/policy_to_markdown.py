"""AI-extracted policy dict → reviewable markdown file.

Phase 7 onboarding pipeline:
  1. AI extracts criteria + applicable_codes from a UHC policy PDF
     (`services/ai/policy_ingestion.py:ingest_policy`).
  2. THIS module converts that result into a markdown file with YAML
     frontmatter — one file per policy under `policies/uhc/`.
  3. A human reviews/edits the .md file in their IDE, commits to git.
  4. `prisma/seed/uhcPolicies.ts` parses the .md file into Prisma rows.

The markdown shape is the contract between this module and the seed
loader. Keep them aligned.

HARD RULES:
- Pure function; no I/O, no DB writes, no network calls.
- No PHI / full-policy-text logging.
"""

from __future__ import annotations

import os
import re
from typing import Any


def _kebab_case(s: str) -> str:
    """Convert a string to kebab-case ASCII for safe filenames + ids."""
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s or "untitled"


def _yaml_escape_str(s: str) -> str:
    """Quote a string for YAML if it contains characters that would be misparsed.

    Conservative: quote if the string contains any of: : # ' " - * { } [ ] , & ! % ? @ \\ |
    or leading/trailing whitespace, or is empty, or looks like a YAML keyword.
    """
    if s == "":
        return '""'
    if s.lower() in ("null", "true", "false", "yes", "no", "on", "off"):
        return f'"{s}"'
    if s != s.strip():
        return f'"{s}"'
    if re.search(r"""[:#'"\-*{}\[\],&!%?@\\|>]""", s):
        # Escape any embedded double quotes
        escaped = s.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return s


def derive_policy_id(external_id: str, payer: str = "uhc") -> str:
    """Derive a stable policy id from the external id (kebab-case PDF basename).

    Example: derive_policy_id("cardiac-stress-test") → "policy-uhc-cardiac-stress-test"
    """
    return f"policy-{payer}-{_kebab_case(external_id)}"


def policy_to_markdown(
    *,
    ingestion_result: dict[str, Any],
    pdf_path: str,
    payer_id: str = "payer-uhc",
    policy_type: str = "MedicalPolicy",
    effective_from: str,
    title: str | None = None,
    policy_version: str = "ai-ingested-v1",
) -> str:
    """Render the ingestion result as a markdown string.

    Args:
        ingestion_result: The dict returned by
            `services.ai.policy_ingestion.ingest_policy`. Must contain
            `criteria: list[dict]` and `applicable_codes: list[dict]`
            (Phase 7 v2 extraction).
        pdf_path: Absolute or repo-relative path to the source PDF; used
            for `externalId` (filename stem) and `sourceUrl`.
        payer_id: Payer FK in the `Payer` table. Default `payer-uhc`.
        policy_type: One of "MedicalPolicy" / "NCD" / "LCD".
        effective_from: ISO date string (e.g. "2024-01-01"); the seed
            loader expects ISO.
        title: Human-readable policy title. If None, derived from filename.
        policy_version: Stamped on every AI-ingested policy so the seed
            loader can distinguish them from hand-curated rows.

    Returns:
        Markdown string suitable for writing to
        `policies/uhc/{external-id}.md`.
    """
    # ── External id + filename derivation ────────────────────────────────────
    pdf_basename = os.path.basename(pdf_path)
    external_id = _kebab_case(os.path.splitext(pdf_basename)[0])
    policy_id = derive_policy_id(external_id, payer="uhc")
    if title is None:
        # Title-case the kebab-case external id.
        title = " ".join(w.capitalize() for w in external_id.split("-")) or "Untitled Policy"

    # Source URL is a repo-relative path; we strip a leading absolute prefix
    # if present so the markdown is portable across machines.
    if "UHC/" in pdf_path:
        source_url = pdf_path[pdf_path.index("UHC/"):]
    else:
        source_url = pdf_basename

    # ── Frontmatter (YAML) ───────────────────────────────────────────────────
    lines: list[str] = ["---"]
    lines.append(f"id: {policy_id}")
    lines.append(f"payerId: {payer_id}")
    lines.append(f"policyType: {policy_type}")
    lines.append(f"externalId: {external_id}")
    lines.append(f"title: {_yaml_escape_str(title)}")
    lines.append(f"effectiveFrom: {effective_from}")
    lines.append("effectiveTo: null")
    lines.append(f"sourceUrl: {source_url}")
    lines.append("publishStatus: draft")
    lines.append(f"policyVersion: {policy_version}")

    codes = ingestion_result.get("applicable_codes") or []
    if not codes:
        # Emit the key with an empty list so reviewers see where to add.
        lines.append("codes: []")
    else:
        lines.append("codes:")
        for code in codes:
            code_type = str(code.get("code_type", "")).upper()
            code_value = str(code.get("code", "")).upper()
            modifier = code.get("modifier")
            pos_codes = code.get("pos_codes") or []
            # Flow-style YAML for compactness, one code per line.
            mod_part = f', modifier: "{modifier}"' if modifier else ""
            pos_part = f", posCodes: {pos_codes}" if pos_codes else ", posCodes: []"
            lines.append(f'  - {{ codeType: {code_type}, code: "{code_value}"{mod_part}{pos_part} }}')

    lines.append("---")
    lines.append("")

    # ── Body (criteria) ──────────────────────────────────────────────────────
    lines.append(f"# {title}")
    lines.append("")

    criteria = ingestion_result.get("criteria") or []
    if not criteria:
        lines.append("> NOTE: AI extracted zero criteria. Either the document has none,")
        lines.append("> or extraction failed. Re-run ingestion or hand-author criteria below.")
        lines.append("")
    else:
        for idx, criterion in enumerate(criteria, start=1):
            ordinal = criterion.get("ordinal", idx)
            text = (criterion.get("text") or "").strip()
            lines.append(f"## Criterion {ordinal}")
            lines.append(text or "(no text extracted)")
            lines.append("")

            evidence_hint = criterion.get("evidence_hint")
            if evidence_hint:
                lines.append("### Evidence hint")
                lines.append(evidence_hint.strip())
                lines.append("")

            upload_hint = criterion.get("upload_hint")
            if upload_hint:
                lines.append("### Upload hint")
                lines.append(upload_hint.strip())
                lines.append("")

    return "\n".join(lines).rstrip() + "\n"
