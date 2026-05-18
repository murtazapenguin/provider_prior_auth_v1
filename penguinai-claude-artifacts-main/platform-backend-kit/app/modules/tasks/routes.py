from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import StreamingResponse

from app.common.exceptions import ForbiddenException, UnauthorizedException
from app.modules.auth.dependencies import CurrentUser, require_permissions, require_tenant
from app.modules.auth.jwt import decode_access_token
from app.modules.tasks.schemas import TaskStatusResponse, TriggerTaskRequest
from app.modules.tasks.service import TaskService
from app.redis import get_redis

router = APIRouter()


@router.post(
    "/trigger",
    summary="Trigger an async background task",
    dependencies=[Depends(require_tenant()), Depends(require_permissions(["tasks:trigger"]))],
)
async def trigger_task(
    body: TriggerTaskRequest,
    user: CurrentUser,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    # Check idempotency key to prevent duplicate task dispatch
    if idempotency_key:
        redis = get_redis()
        cache_key = f"idempotency:{user.tenant_id}:{idempotency_key}"
        existing = await redis.get(cache_key)
        if existing:
            return {"task_id": existing, "message": f"Task '{body.task_name}' already queued (idempotent)"}

    task_id = await TaskService.trigger_task(body.task_name, body.kwargs)

    if idempotency_key:
        try:
            redis = get_redis()
            cache_key = f"idempotency:{user.tenant_id}:{idempotency_key}"
            await redis.set(cache_key, task_id, ex=300)  # 5 min TTL
        except Exception:
            pass

    return {"task_id": task_id, "message": f"Task '{body.task_name}' queued"}


@router.get(
    "/status/{task_id}",
    summary="Get task execution status",
    response_model=TaskStatusResponse,
    dependencies=[Depends(require_tenant()), Depends(require_permissions(["tasks:view"]))],
)
async def get_task_status(task_id: str, user: CurrentUser):
    await TaskService.verify_task_ownership(task_id, user.tenant_id)
    return await TaskService.get_task_status(task_id)


@router.get("/stream/{task_id}", summary="Stream task status via SSE")
async def stream_task_status(
    task_id: str,
    request: Request,
    token: str | None = Query(None),
):
    """SSE endpoint for real-time task progress.

    Browser EventSource can't set Authorization headers, so auth
    is supported via either:
      - Authorization: Bearer <token>  (programmatic clients)
      - ?token=<token>  (browser EventSource)
    """
    # Try header auth first, fall back to query param
    user_payload = getattr(request.state, "user", None)
    if user_payload is None and token:
        try:
            user_payload = decode_access_token(token)
        except Exception:
            raise UnauthorizedException("Invalid token")

    if user_payload is None:
        raise UnauthorizedException("Authentication required")

    tenant_id = user_payload.get("tenant_id")
    if not tenant_id:
        raise ForbiddenException("Tenant membership required")

    await TaskService.verify_task_ownership(task_id, tenant_id)

    return StreamingResponse(
        TaskService.stream_task_status(task_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )
