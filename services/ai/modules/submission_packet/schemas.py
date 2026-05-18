from datetime import datetime

from pydantic import BaseModel


class GeneratePacketRequest(BaseModel):
    pa_id: str
    regenerate: bool = False
    provider_id: str | None = None


class GeneratePacketResponse(BaseModel):
    pdf_url: str
    attachment_id: str
    generated_at: datetime
    narrative_paragraph: str
    prompt_version: str
    model: str
    trace_id: str | None = None
    cached: bool
    page_count: int = 1
