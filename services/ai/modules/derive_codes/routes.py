"""Derive-codes route — delegates to services.ai.code_derivation."""

from fastapi import APIRouter, Depends, Request

from services.ai.code_derivation import DeriveCodesRequest, DeriveCodesResponse, derive_codes
from services.ai.common.deps import require_token

router = APIRouter(tags=['derive-codes'])


@router.post('/derive-codes', response_model=DeriveCodesResponse, dependencies=[Depends(require_token)])
async def derive_codes_route(request: Request, body: DeriveCodesRequest) -> DeriveCodesResponse:
    """Derive CPT/HCPCS/ICD-10 codes from clinical notes.

    Reads the DB pool from app.state (set up in main.py lifespan).
    Pool may be None in test/dev environments with no DB configured.
    """
    db_pool = getattr(request.app.state, 'db_pool', None)
    return await derive_codes(body, db_pool)
