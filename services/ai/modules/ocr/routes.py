from fastapi import APIRouter, Depends
from pydantic import BaseModel

from services.ai.common.deps import require_token
from services.ai.ocr import ocr_document

router = APIRouter(tags=['ocr'])


class OCRRequest(BaseModel):
    file_path: str


@router.post('/ocr-document', dependencies=[Depends(require_token)])
async def ocr_document_handler(body: OCRRequest):
    return await ocr_document(body.file_path)
