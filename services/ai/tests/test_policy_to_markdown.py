"""Unit tests for services.ai.policy_to_markdown.

The converter is the contract between AI extraction and the markdown
review surface. The seed loader (prisma/seed/uhcPolicies.ts) must be
able to round-trip what this function emits.
"""

from __future__ import annotations

from services.ai.policy_to_markdown import (
    derive_policy_id,
    policy_to_markdown,
)


def test_derive_policy_id_kebab():
    assert derive_policy_id("Cardiac Stress Test") == "policy-uhc-cardiac-stress-test"
    assert derive_policy_id("botulinum-toxins-a-and-b-cs") == "policy-uhc-botulinum-toxins-a-and-b-cs"


def test_markdown_frontmatter_required_fields():
    result = {
        "criteria": [
            {"ordinal": 1, "text": "Patient must have chest pain."},
        ],
        "applicable_codes": [
            {"code_type": "CPT", "code": "93016", "modifier": None, "pos_codes": []},
        ],
    }
    md = policy_to_markdown(
        ingestion_result=result,
        pdf_path="/abs/path/UHC/medical-policies/cardiac-stress-test.pdf",
        effective_from="2024-01-01",
    )
    # Required frontmatter keys present.
    assert "id: policy-uhc-cardiac-stress-test" in md
    assert "payerId: payer-uhc" in md
    assert "policyType: MedicalPolicy" in md
    assert "externalId: cardiac-stress-test" in md
    assert "effectiveFrom: 2024-01-01" in md
    assert "effectiveTo: null" in md
    assert "sourceUrl: UHC/medical-policies/cardiac-stress-test.pdf" in md
    assert "publishStatus: draft" in md
    assert "policyVersion: ai-ingested-v1" in md
    # Codes are emitted with the expected flow-style shape.
    assert 'codeType: CPT, code: "93016"' in md
    # Body has the title + criterion.
    assert "# Cardiac Stress Test" in md
    assert "## Criterion 1" in md
    assert "Patient must have chest pain." in md


def test_markdown_emits_empty_codes_list_when_no_codes():
    result = {
        "criteria": [{"ordinal": 1, "text": "Some criterion."}],
        "applicable_codes": [],
    }
    md = policy_to_markdown(
        ingestion_result=result,
        pdf_path="/abs/path/UHC/medical-policies/general-guideline.pdf",
        effective_from="2024-01-01",
    )
    assert "codes: []" in md  # explicit empty marker for reviewers


def test_markdown_emits_multiple_codes_with_modifiers_and_pos():
    result = {
        "criteria": [{"ordinal": 1, "text": "X."}],
        "applicable_codes": [
            {"code_type": "CPT", "code": "93016", "modifier": None, "pos_codes": []},
            {"code_type": "CPT", "code": "93017", "modifier": "26", "pos_codes": ["11", "22"]},
            {"code_type": "HCPCS", "code": "J0585", "modifier": None, "pos_codes": []},
        ],
    }
    md = policy_to_markdown(
        ingestion_result=result,
        pdf_path="/abs/path/UHC/medical-policies/x.pdf",
        effective_from="2024-01-01",
    )
    assert 'codeType: CPT, code: "93016", posCodes: []' in md
    assert 'codeType: CPT, code: "93017", modifier: "26", posCodes: [' in md
    assert "'11'" in md or '"11"' in md or '11' in md  # pos code present
    assert 'codeType: HCPCS, code: "J0585"' in md


def test_markdown_body_renders_evidence_and_upload_hints():
    result = {
        "criteria": [
            {
                "ordinal": 1,
                "text": "Patient must have N-of-Y trial of agents.",
                "evidence_hint": "Look for trial dates in HPI.",
                "upload_hint": "Upload pharmacy printout.",
            },
            {
                "ordinal": 2,
                "text": "Second criterion text.",
                # no hints
            },
        ],
        "applicable_codes": [
            {"code_type": "CPT", "code": "12345", "modifier": None, "pos_codes": []},
        ],
    }
    md = policy_to_markdown(
        ingestion_result=result,
        pdf_path="/abs/path/UHC/medical-policies/some.pdf",
        effective_from="2024-01-01",
    )
    assert "### Evidence hint" in md
    assert "Look for trial dates in HPI." in md
    assert "### Upload hint" in md
    assert "Upload pharmacy printout." in md
    # Second criterion has no hint subsections.
    assert "Second criterion text." in md
    # Section ordering: first criterion's body before second.
    assert md.index("## Criterion 1") < md.index("## Criterion 2")


def test_markdown_explicit_title_overrides_filename_derivation():
    result = {"criteria": [], "applicable_codes": []}
    md = policy_to_markdown(
        ingestion_result=result,
        pdf_path="/abs/path/foo.pdf",
        effective_from="2024-01-01",
        title="My Real Policy Title",
    )
    assert "title: My Real Policy Title" in md
    assert "# My Real Policy Title" in md


def test_markdown_handles_zero_criteria_with_reviewer_note():
    result = {"criteria": [], "applicable_codes": []}
    md = policy_to_markdown(
        ingestion_result=result,
        pdf_path="/abs/path/empty.pdf",
        effective_from="2024-01-01",
    )
    assert "AI extracted zero criteria" in md
