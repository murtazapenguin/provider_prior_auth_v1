"""Task 1 — Code derivation.

Derives CPT / HCPCS (J, Q) + ICD-10 procedure and diagnosis codes from
clinical notes using the Penguin SDK structured-output pattern.

This is the ONLY place in services/ai/ that orchestrates Task 1. The
FastAPI route in modules/derive_codes/routes.py delegates here.

HARD RULE: penguin.* imports are gated inside functions. This file may be
imported without the SDK installed, but calling derive_codes() will raise
if the SDK is missing (no fallback — see CLAUDE.md).
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from pydantic import BaseModel, Field

from services.ai.cache import get_cached, hash_input, set_cached
from services.ai.config import get_settings
from services.ai.penguin_client import get_model, get_tracer_session

if TYPE_CHECKING:
    import asyncpg

logger = logging.getLogger(__name__)

# ─── Prompt registration ──────────────────────────────────────────────────────
# Must happen at import time so the prompt Merkle hash is stable before any
# request hits the handler. Raises on missing SDK (no fallback).

from services.ai.prompts.code_derivation_v1 import (  # noqa: E402
    PROMPT_CONTENT,
    PROMPT_VERSION,
    register as _register_prompt,
)

_register_prompt()  # logs a warning internally if penguin.prompts is unavailable


# ─── Request / Response models (local — not the flat common/schemas.py shape) ─

class Note(BaseModel):
    id: str
    note_type: str
    author_role: str
    text: str


class DeriveCodesRequest(BaseModel):
    encounter_id: str
    notes: list[Note]
    indication: str | None = None
    pa_id: str | None = None
    provider_id: str | None = None


class ProcedureCode(BaseModel):
    code_type: str = Field(description="CPT, HCPCS, J, or Q")
    code: str = Field(description="The procedure code string")
    modifier: str | None = Field(default=None, description="Optional modifier e.g. LT, RT, 50")
    description: str = Field(description="Human-readable procedure description")
    confidence: float = Field(ge=0.0, le=1.0)
    rationale: str = Field(description="1-sentence citation from the documentation")


class DiagnosisCode(BaseModel):
    code_type: str = Field(default="ICD10")
    code: str = Field(description="ICD-10-CM code")
    description: str = Field(description="Human-readable diagnosis description")
    confidence: float = Field(ge=0.0, le=1.0)
    rationale: str = Field(description="1-sentence citation from the documentation")
    is_primary: bool = Field(description="True for the single most clinically relevant diagnosis")


class DerivedCodes(BaseModel):
    """Container model — with_structured_output requires a single class."""
    procedures: list[ProcedureCode]
    diagnoses: list[DiagnosisCode]


class DeriveCodesResponse(BaseModel):
    procedures: list[ProcedureCode]
    diagnoses: list[DiagnosisCode]
    prompt_version: str
    trace_id: str | None = None
    cached: bool = False


# ─── Helper: build the prompt messages ───────────────────────────────────────

def _build_prompt_messages(notes: list[Note], indication: str | None) -> list[dict]:
    """Return the [system, human] message list for the LLM call."""
    # Concatenate notes with labeled headers
    note_blocks: list[str] = []
    for note in notes:
        header = f"[{note.note_type.upper()} | Author: {note.author_role}]"
        note_blocks.append(f"{header}\n{note.text}")
    combined_notes = "\n\n---\n\n".join(note_blocks)

    indication_section = (
        f"\nProvider-stated indication / order text:\n{indication}\n"
        if indication
        else ""
    )

    human_message = (
        f"{PROMPT_CONTENT}\n\n"
        f"{indication_section}\n"
        f"Clinical documentation:\n<<<\n{combined_notes}\n>>>"
    )

    return [{"role": "user", "content": human_message}]


# ─── Cache key ────────────────────────────────────────────────────────────────

def _cache_input(notes: list[Note], indication: str | None) -> str:
    """Canonical cache key — excludes session metadata (encounter_id, pa_id, provider_id)."""
    payload = {
        "notes": [n.model_dump() for n in notes],
        "indication": indication,
    }
    return hash_input(payload)


# ─── Main handler ─────────────────────────────────────────────────────────────

async def derive_codes(
    request: DeriveCodesRequest,
    db_pool: "asyncpg.Pool | None",
) -> DeriveCodesResponse:
    """Derive CPT/HCPCS/ICD-10 codes from clinical notes.

    1. Check Postgres cache — return immediately on hit.
    2. Build prompt, call model.with_structured_output(DerivedCodes).ainvoke().
    3. Persist result to cache.
    4. Return typed response.
    """
    settings = get_settings()
    model_name = settings.penguin_llm_model
    input_hash = _cache_input(request.notes, request.indication)

    # ── Cache read ──────────────────────────────────────────────────────────
    if db_pool is not None:
        cached = await get_cached(db_pool, "code_derivation", PROMPT_VERSION, model_name, input_hash)
        if cached is not None:
            logger.debug("code_derivation cache HIT encounter=%s", request.encounter_id)
            return DeriveCodesResponse(
                procedures=[ProcedureCode(**p) for p in cached["procedures"]],
                diagnoses=[DiagnosisCode(**d) for d in cached["diagnoses"]],
                prompt_version=PROMPT_VERSION,
                trace_id=cached.get("trace_id"),
                cached=True,
            )

    # ── LLM call ────────────────────────────────────────────────────────────
    from penguin.core import HumanMessage  # noqa: PLC0415

    base_model = get_model("derivation")
    structured_model = base_model.with_structured_output(DerivedCodes)
    messages = _build_prompt_messages(request.notes, request.indication)

    trace_id: str | None = None
    context = (
        get_tracer_session(request.pa_id, request.provider_id or "")
        if request.pa_id
        else __import__("contextlib").nullcontext()
    )

    with context as session:
        if session is not None and hasattr(session, "trace_id"):
            trace_id = session.trace_id

        logger.info(
            "code_derivation LLM call encounter=%s prompt_version=%s",
            request.encounter_id,
            PROMPT_VERSION,
        )
        result: DerivedCodes = await structured_model.ainvoke(
            [HumanMessage(content=messages[0]["content"])]
        )

    # ── Cache write ─────────────────────────────────────────────────────────
    response_payload = {
        "procedures": [p.model_dump() for p in result.procedures],
        "diagnoses": [d.model_dump() for d in result.diagnoses],
        "trace_id": trace_id,
    }

    if db_pool is not None:
        await set_cached(
            db_pool,
            "code_derivation",
            PROMPT_VERSION,
            model_name,
            input_hash,
            response_payload,
            traced_to=trace_id,
        )

    return DeriveCodesResponse(
        procedures=result.procedures,
        diagnoses=result.diagnoses,
        prompt_version=PROMPT_VERSION,
        trace_id=trace_id,
        cached=False,
    )
