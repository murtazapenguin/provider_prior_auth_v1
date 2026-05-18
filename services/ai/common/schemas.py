"""Canonical Pydantic request/response models for the four AI tasks.

Evidence citation shapes match penguinai-claude-artifacts-main/.claude/contracts/
evidence-citation.md and bbox-format.md — zero-transform rule.
"""

from typing import Any

from pydantic import BaseModel, Field


# ─── Shared Evidence Contract ─────────────────────────────────────────────────

class BboxObject(BaseModel):
    document_name: str
    page_number: int
    bbox: list[list[float]]
    line_numbers: list[int] = Field(default_factory=list)


class EvidenceCitation(BaseModel):
    # Source attribution — Phase 3 embeds these directly (Phase 2 used a side channel).
    source_type: str = Field(default="clinical_note")
    source_id: str = Field(default="")
    supporting_texts: list[str]
    reasoning: str | None = None
    confidence: float
    bboxes: list[BboxObject]
    line_numbers: list[int] = Field(default_factory=list)


# ─── Code Derivation ──────────────────────────────────────────────────────────

class DeriveCodesRequest(BaseModel):
    pa_id: str
    notes: list[dict[str, Any]]


class DerivedCode(BaseModel):
    code_type: str
    code: str
    modifier: str | None = None
    description: str
    is_primary: bool
    confidence: float
    reasoning: str | None = None


class DeriveCodesResponse(BaseModel):
    codes: list[DerivedCode]
    model: str
    prompt_version: str
    cached: bool = False


# ─── Evidence Extraction ──────────────────────────────────────────────────────

class SourceItem(BaseModel):
    """A single source document or note in the evaluation corpus."""
    id: str
    kind: str = Field(default="clinical_note")  # 'clinical_note' | 'attachment' | 'policy_pdf'
    text: str
    line_numbered_text: str | None = None  # Pre-formatted 'content || N'; built server-side if omitted.


class CriterionMeta(BaseModel):
    """Criterion metadata passed by the caller."""
    id: str
    text: str
    evidence_hint: str | None = None
    required_codes: list[str] = Field(default_factory=list)


class ExtractEvidenceRequest(BaseModel):
    criterion: CriterionMeta
    corpus: list[SourceItem]
    pa_id: str | None = None
    provider_id: str | None = None


class ExtractEvidenceResponse(BaseModel):
    criterion_id: str
    status: str
    # 'rationale' is the TS-surface name (matchEngine reads aiResult.rationale).
    # 'reasoning' is the canonical contract name used inside the Python layer.
    # Both carry the same value; the route handler sets both fields.
    rationale: str | None = None
    reasoning: str | None = None
    confidence: float
    citations: list[EvidenceCitation]
    model: str
    prompt_version: str
    cached: bool = False
    trace_id: str | None = None
    citation_validation: str = Field(
        default="none_returned",
        description="'all_valid' | 'some_invalid' | 'none_returned'",
    )


# ─── Policy Ingestion ────────────────────────────────────────────────────────

class IngestPolicyRequest(BaseModel):
    policy_id: str
    source_url: str
    payer_short_code: str


class IngestedCriterion(BaseModel):
    ordinal: int
    text: str
    evidence_hint: str | None = None
    group: str | None = None
    group_operator: str | None = None
    source_bboxes: list[BboxObject] = Field(default_factory=list)
    source_line_numbers: list[int] = Field(default_factory=list)


class IngestPolicyResponse(BaseModel):
    policy_id: str
    criteria: list[IngestedCriterion]
    model: str
    prompt_version: str
    cached: bool = False
