from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from services.ai.common.deps import require_token
from services.ai.policy_ingestion import ingest_policy

router = APIRouter(tags=['ingest-policy'])


class IngestPolicyRequest(BaseModel):
    pdf_path: str
    policy_id: str


@router.post('/ingest-policy', dependencies=[Depends(require_token)])
async def ingest_policy_handler(body: IngestPolicyRequest, request: Request):
    db_pool = getattr(request.app.state, 'db_pool', None)
    result = await ingest_policy(body.pdf_path, body.policy_id, db_pool=db_pool)
    return result
