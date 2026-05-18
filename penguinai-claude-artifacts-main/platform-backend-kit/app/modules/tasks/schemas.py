from typing import Any, Optional

from pydantic import BaseModel


class TriggerTaskRequest(BaseModel):
    task_name: str
    kwargs: Optional[dict] = None


class TaskStatusResponse(BaseModel):
    task_id: str
    status: str
    result: Optional[Any] = None
    progress: Optional[dict] = None
    error: Optional[str] = None
