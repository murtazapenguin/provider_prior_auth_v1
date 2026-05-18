from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from services.ai.common.deps import require_token
from services.ai.modules.submission_packet.schemas import GeneratePacketRequest, GeneratePacketResponse
from services.ai.submission_packet import generate_submission_packet

router = APIRouter(tags=['submission-packet'])


@router.post('/generate-submission-packet', dependencies=[Depends(require_token)], response_model=GeneratePacketResponse)
async def generate_submission_packet_route(request_body: GeneratePacketRequest, request: Request):
    """Generate (or regenerate) the submission packet PDF for a PA.

    Loads PA data, calls LLM for narrative paragraph, builds PDF with fitz,
    saves to public/submission-packets/{pa_id}.pdf, and persists an Attachment row.
    """
    db_pool = getattr(request.app.state, 'db_pool', None)

    result = await generate_submission_packet(
        pa_id=request_body.pa_id,
        regenerate=request_body.regenerate,
        provider_id=request_body.provider_id,
        db_pool=db_pool,
    )

    return GeneratePacketResponse(**result)
