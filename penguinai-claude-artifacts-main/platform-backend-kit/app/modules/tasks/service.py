import asyncio
import json
from collections.abc import AsyncGenerator

from celery.result import AsyncResult

from app.celery_app import celery_app
from app.common.exceptions import BadRequestException, ForbiddenException, NotFoundException
from app.modules.tasks.schemas import TaskStatusResponse
from app.redis import get_redis
from app.tenant import get_tenant_ctx

_TASK_OWNER_PREFIX = "task_owner:"
_TASK_OWNER_TTL = 86400  # 24 hours

ALLOWED_TASKS = {
    "tasks.example_long_running",
    "tasks.send_notification",
}


class TaskService:
    @staticmethod
    async def trigger_task(task_name: str, kwargs: dict | None = None) -> str:
        if task_name not in ALLOWED_TASKS:
            raise BadRequestException(f"Task '{task_name}' is not available")

        task_kwargs = dict(kwargs or {})
        # Inject tenant_id so workers can resolve the correct tenant DB
        ctx = get_tenant_ctx()
        task_kwargs["tenant_id"] = ctx.tenant_id

        result = celery_app.send_task(task_name, kwargs=task_kwargs)

        # Store task ownership for verification on status/stream
        try:
            redis = get_redis()
            await redis.set(f"{_TASK_OWNER_PREFIX}{result.id}", ctx.tenant_id, ex=_TASK_OWNER_TTL)
        except Exception:
            pass  # Fail open — don't block task dispatch if Redis is down

        return result.id

    @staticmethod
    async def verify_task_ownership(task_id: str, tenant_id: str) -> None:
        """Verify the requesting tenant owns the task. Raises ForbiddenException on mismatch."""
        try:
            redis = get_redis()
            owner = await redis.get(f"{_TASK_OWNER_PREFIX}{task_id}")
            if owner and owner != tenant_id:
                raise ForbiddenException("Task does not belong to your tenant")
            if not owner:
                # Task ownership record expired or missing — check Celery
                result = AsyncResult(task_id, app=celery_app)
                if result.status == "PENDING":
                    raise NotFoundException("Task not found")
        except (ForbiddenException, NotFoundException):
            raise
        except Exception:
            pass  # Fail open

    @staticmethod
    async def get_task_status(task_id: str) -> TaskStatusResponse:
        result = AsyncResult(task_id, app=celery_app)
        response = TaskStatusResponse(
            task_id=task_id,
            status=result.status,
        )
        if result.status == "PROGRESS":
            response.progress = result.info
        elif result.status == "SUCCESS":
            response.result = result.result
        elif result.status == "FAILURE":
            response.error = str(result.result)
        return response

    @staticmethod
    async def stream_task_status(task_id: str, poll_interval: float = 1.0) -> AsyncGenerator[str, None]:
        """Yield SSE events as the task progresses.

        Emits events until the task reaches a terminal state (SUCCESS, FAILURE, REVOKED).
        """
        terminal_states = {"SUCCESS", "FAILURE", "REVOKED"}
        last_status = None
        last_progress = None

        try:
            while True:
                result = AsyncResult(task_id, app=celery_app)
                status = result.status

                # Build the event payload
                payload: dict = {"task_id": task_id, "status": status}

                if status == "PROGRESS" and isinstance(result.info, dict):
                    payload["progress"] = result.info
                elif status == "SUCCESS":
                    payload["result"] = result.result
                elif status == "FAILURE":
                    payload["error"] = str(result.result)

                # Only emit if something changed
                current_progress = payload.get("progress")
                if status != last_status or current_progress != last_progress:
                    last_status = status
                    last_progress = current_progress
                    yield f"event: task_update\ndata: {json.dumps(payload, default=str)}\n\n"

                if status in terminal_states:
                    yield f"event: task_complete\ndata: {json.dumps(payload, default=str)}\n\n"
                    return

                await asyncio.sleep(poll_interval)
        except asyncio.CancelledError:
            return
