# Platform Standards

Development conventions for building features on this platform. Every new module, endpoint, or service should follow these patterns.

---

## 1. Pagination — Always Paginate List Endpoints

Any endpoint that returns a list of records from the database **must** be paginated. Unbounded queries are a production outage waiting to happen.

### Utilities

| Utility | Location |
|---------|----------|
| `PaginationParams` | `app/common/schemas.py` |
| `PaginatedResponse` | `app/common/schemas.py` |

### Route-Level Pattern

```python
from fastapi import APIRouter, Depends, Query
from app.common.schemas import PaginatedResponse
from app.modules.auth.dependencies import CurrentUser, require_tenant

router = APIRouter()

@router.get("/items", response_model=PaginatedResponse[ItemResponse])
async def list_items(
    user: CurrentUser,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    _: None = Depends(require_tenant()),
):
    # See service-level pattern below
    return await ItemService.list_items(user.tenant_id, skip=skip, limit=limit)
```

### Service-Level Pattern (Motor Collections)

```python
from app.tenant import get_tenant_collection

async def list_items(tenant_id: str, skip: int = 0, limit: int = 50) -> dict:
    collection = get_tenant_collection("items")
    query_filter = {"tenant_id": tenant_id}

    total = await collection.count_documents(query_filter)
    cursor = collection.find(query_filter).skip(skip).limit(limit)
    items = await cursor.to_list(length=limit)

    return {
        "items": items,
        "total": total,
        "skip": skip,
        "limit": limit,
    }
```

### Service-Level Pattern (Beanie Documents)

```python
from app.modules.auth.models import User

async def list_users(tenant_id: str, skip: int = 0, limit: int = 50) -> dict:
    query = User.find(User.tenant_id == tenant_id)
    total = await query.count()
    users = await query.skip(skip).limit(limit).to_list()

    return {
        "items": users,
        "total": total,
        "skip": skip,
        "limit": limit,
    }
```

### Rules

- Default page size: **50**. Maximum: **200**.
- Always return `total` count so clients can render pagination controls.
- Add MongoDB indexes on fields used in the query filter (see `app/modules/auth/models.py` for `Indexed()` usage).
- Existing reference: `app/modules/auth/admin_routes.py` — `GET /admin/users`.

---

## 2. Caching — Use CacheService and @cached

Every read-heavy operation should be cached in Redis. The platform provides two approaches: a decorator for simple cases and a service class for manual control.

### Utilities

| Utility | Location |
|---------|----------|
| `CacheService` | `app/common/cache.py` |
| `@cached` decorator | `app/common/cache.py` |

### Decorator Pattern (Preferred for Simple Reads)

```python
from app.common.cache import cached

@cached(prefix="tenant_config", ttl=600)
async def get_tenant_config(tenant_id: str) -> dict:
    collection = get_tenant_collection("config")
    doc = await collection.find_one({"tenant_id": tenant_id})
    return doc or {}
```

The decorator auto-generates a cache key from the function arguments and stores the result as JSON in Redis.

### Manual Pattern (For Custom Logic)

```python
from app.common.cache import CacheService

async def get_item(item_id: str) -> dict | None:
    cache_key = f"item:{item_id}"
    cached = await CacheService.get_json(cache_key)
    if cached is not None:
        return cached

    doc = await collection.find_one({"_id": ObjectId(item_id)})
    if doc:
        await CacheService.set_json(cache_key, doc, ttl=300)
    return doc
```

### Cache Invalidation

Always invalidate on writes. A stale cache is worse than no cache.

```python
async def update_item(item_id: str, data: dict) -> None:
    await collection.update_one({"_id": ObjectId(item_id)}, {"$set": data})
    await CacheService.delete(f"item:{item_id}")
```

### TTL Guidelines

| Data Type | TTL | Example |
|-----------|-----|---------|
| Volatile / user-specific | 60s | User session data, real-time counts |
| Standard | 300s (default) | Item details, file metadata |
| Slow-changing | 3600s | Tenant config, permission mappings |

### Rules

- Never cache writes or mutations.
- Always invalidate related cache keys after a write operation.
- Use the `prefix` parameter in `@cached` to namespace keys (e.g. `"users"`, `"files"`, `"config"`).
- Cache keys follow the pattern: `cache:{prefix}:{hash}`.

---

## 3. File Storage — Always Use S3 Presigned URLs

File uploads and downloads **must** go through S3 presigned URLs. The API server never proxies file bytes — it generates short-lived signed URLs and the client transfers directly with S3.

### Utilities

| Utility | Location |
|---------|----------|
| `StorageService` | `app/modules/storage/service.py` |
| `ALLOWED_CONTENT_TYPES` | `app/modules/storage/constants.py` |

### Upload Flow

```
Client                    API Server                S3
  │                          │                       │
  ├── POST /upload-url ─────►│                       │
  │   {filename, type}       │                       │
  │                          ├── generate_presigned ─►│
  │◄── {upload_url, file_id} │                       │
  │                          │                       │
  ├── PUT upload_url ────────┼──────────────────────►│
  │   (file bytes)           │                       │
  │◄── 200 OK ───────────────┼───────────────────────│
  │                          │                       │
  ├── POST /confirm/{id} ───►│                       │
  │◄── {file_metadata}       │                       │
```

### Download Flow

```
Client                    API Server                S3
  │                          │                       │
  ├── GET /download-url/{id}►│                       │
  │                          ├── generate_presigned ─►│
  │◄── {download_url}        │                       │
  │                          │                       │
  ├── GET download_url ──────┼──────────────────────►│
  │◄── (file bytes) ─────────┼───────────────────────│
```

### Filename Sanitization

All user-supplied filenames must be sanitized before use in S3 keys:

```python
import re
safe_filename = re.sub(r"[^\w.\-]", "_", user_filename)
```

This prevents path traversal attacks (e.g. `../../etc/passwd` becomes `______etc_passwd`).

### S3 Key Structure

All apps share a single bucket (`workflow-builder-platform-backend-uploads`). Each app is isolated via `S3_APP_PREFIX`:

```
{s3_app_prefix}/uploads/{tenant_id}/{user_id}/{uuid}/{safe_filename}
```

### Tenant Isolation

Each tenant has its own S3 bucket: `{S3_BUCKET_PREFIX}-{tenant_id}`. Use `get_tenant_ctx().s3_bucket` to resolve the bucket — never hardcode bucket names.

### Rules

- Never stream file bytes through the API server. Always use presigned URLs.
- Always validate `content_type` against `ALLOWED_CONTENT_TYPES` before generating upload URLs.
- Always sanitize filenames with the regex above.
- Set presigned URL expiry via `S3_PRESIGNED_URL_EXPIRY` (default: 3600s).
- Track file metadata (filename, s3_key, content_type, uploader, status) in the tenant's `file_metadata` collection.
- Use the confirm-upload flow: the file is not considered "uploaded" until the client calls the confirm endpoint.
- Guard against double-confirmation with `ConflictException` (see `app/modules/storage/service.py`).

---

## 4. Audit Trail — Log All Significant Events

Every operation that changes state or accesses sensitive data **must** emit an audit log entry. The platform uses structured logging via loguru with a dedicated `audit_log()` function.

### Utility

| Utility | Location |
|---------|----------|
| `audit_log()` | `app/common/audit.py` |

### Usage

```python
from app.common.audit import audit_log

audit_log(
    action="file.uploaded",
    actor_id=str(user.id),
    tenant_id=user.tenant_id,
    resource_type="file",
    resource_id=file_id,
    details={"filename": "report.pdf", "size_bytes": 1024},
    ip_address=request.client.host,
)
```

### Action Naming Convention

Actions follow the `resource.verb` pattern:

| Category | Actions |
|----------|---------|
| Auth | `user.login`, `user.logout`, `user.token_refreshed` |
| Users | `user.created`, `user.roles_updated`, `user.deactivated` |
| Files | `file.upload_url_generated`, `file.upload_confirmed`, `file.download_url_generated`, `file.deleted` |
| Tasks | `task.triggered`, `task.completed`, `task.failed` |
| Tenants | `tenant.provisioned`, `tenant.settings_updated` |

### When to Audit

| Event Type | Audit? | Example |
|-----------|--------|---------|
| Authentication events | Yes | Login, logout, token refresh, failed auth |
| Data creation | Yes | New user, new file, new task |
| Data modification | Yes | Role change, status update, settings change |
| Data deletion | Yes | File delete, user deactivation |
| Data access (sensitive) | Yes | File download, user profile view by admin |
| Read-only list queries | No | Listing items, search results |
| Health checks | No | `/health`, `/readiness` |

### Required Fields

Every `audit_log()` call must include at minimum:

- `action` — what happened
- `actor_id` — who did it (user ID)
- `tenant_id` — which tenant context

Optional but recommended: `resource_type`, `resource_id`, `details`, `ip_address`.

### Log Output

Audit entries are emitted as structured JSON via loguru with `audit=True` in the log extras. In production, filter on this field to route audit logs to a dedicated store (CloudWatch, Datadog, ELK).

---

## 5. Error Handling — Use Platform Exceptions

Never raise raw `HTTPException`. Use the typed exceptions from `app/common/exceptions.py`:

```python
from app.common.exceptions import (
    BadRequestException,    # 400
    UnauthorizedException,  # 401
    ForbiddenException,     # 403
    NotFoundException,      # 404
    ConflictException,      # 409
)
```

These are caught by the global error handler in `app/common/error_handlers.py` and returned as consistent JSON error responses:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found"
  }
}
```

---

## 6. Multi-Tenancy — Always Use Tenant Context

Every tenant-scoped operation must go through the tenant context system. Never hardcode database names or bucket names.

```python
from app.tenant import get_tenant_ctx, get_tenant_collection

# Get the current tenant's database context
ctx = get_tenant_ctx()
tenant_id = ctx.tenant_id
bucket = ctx.s3_bucket

# Get a Motor collection from the tenant's isolated database
collection = get_tenant_collection("items")
```

Shared data (users, tenants) lives in the shared database via Beanie documents. Tenant-scoped data lives in `{TENANT_DB_PREFIX}_{tenant_id}` databases accessed via Motor collections.

---

## 7. RBAC — Protect Every Route

All authenticated endpoints must declare their required roles or permissions via FastAPI dependencies:

```python
from app.modules.auth.dependencies import (
    CurrentUser,           # Annotated dependency — injects the authenticated user
    require_tenant,        # Ensures user belongs to a tenant
    require_roles,         # Checks user has at least one of the specified roles
    require_permissions,   # Checks user has all specified permissions
)

@router.post(
    "/items",
    dependencies=[
        Depends(require_tenant()),
        Depends(require_permissions(["items:create"])),
    ],
)
async def create_item(body: CreateItemRequest, user: CurrentUser):
    ...
```

### Permission Naming

Permissions follow the `resource:action` pattern: `storage:upload`, `tasks:trigger`, `users:manage_roles`.

---

## 8. Request Validation — Use Pydantic Schemas

All request and response bodies must use Pydantic models. Never accept raw `dict` from request bodies.

```python
from pydantic import BaseModel, Field

class CreateItemRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None

class ItemResponse(BaseModel):
    id: str
    name: str
    description: str | None
    created_at: str
```

Always declare `response_model` on route decorators for OpenAPI documentation and response validation.

---

## 9. Idempotency — Prevent Duplicate Mutations

State-changing endpoints (POST, PUT, DELETE) should support idempotency via the `Idempotency-Key` header to prevent duplicate operations from retries or network issues.

### Pattern

```python
from fastapi import Header
from app.redis import get_redis

@router.post("/items")
async def create_item(
    body: CreateItemRequest,
    user: CurrentUser,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
):
    if idempotency_key:
        redis = get_redis()
        cache_key = f"idempotency:{user.tenant_id}:{idempotency_key}"
        existing = await redis.get(cache_key)
        if existing:
            return {"id": existing, "message": "Already processed (idempotent)"}

    result = await ItemService.create(body, user)

    if idempotency_key:
        redis = get_redis()
        cache_key = f"idempotency:{user.tenant_id}:{idempotency_key}"
        await redis.set(cache_key, str(result.id), ex=300)  # 5 min TTL

    return result
```

Existing reference: `app/modules/tasks/routes.py` — `POST /trigger`.

---

## 10. Module Structure — How to Organize a New Feature

Every feature module follows a consistent directory layout under `app/modules/`.

### Standard Layout

```
app/modules/{feature_name}/
├── __init__.py          # Empty or re-exports
├── routes.py            # FastAPI APIRouter with endpoint definitions
├── service.py           # Business logic (static class, all async methods)
├── models.py            # Beanie documents or Pydantic models for Motor
├── schemas.py           # Request/response Pydantic models
├── constants.py         # Module-specific constants (optional)
└── workers/             # Celery task definitions (optional)
    ├── __init__.py
    └── {task}_tasks.py
```

### Router Registration

In `routes.py`, create a plain `APIRouter()` (no prefix — that's set in `main.py`):

```python
from fastapi import APIRouter

router = APIRouter()

@router.get("/items", summary="List items")
async def list_items(...):
    ...
```

In `app/main.py`, import and mount with prefix and tags:

```python
from app.modules.feature_name.routes import router as feature_router

app.include_router(feature_router, prefix=f"{settings.api_v1_prefix}/feature-name", tags=["feature-name"])
```

### Service Layer

Services contain all business logic. Routes should be thin — they validate input, call the service, and return the response.

```python
class FeatureService:
    @staticmethod
    async def create_item(data: CreateItemRequest, user_id: str) -> Item:
        ctx = get_tenant_ctx()
        collection = get_tenant_collection("items")
        # ... business logic ...
        audit_log(action="item.created", actor_id=user_id, tenant_id=ctx.tenant_id)
        return item
```

### Schema Separation

Never reuse database models as API schemas. Always separate:

- `*Request` — what the client sends
- `*Response` — what the client receives

This decouples the API contract from the storage layer.

### References

- Auth module: `app/modules/auth/` (most complex, with providers + admin routes)
- Storage module: `app/modules/storage/`
- Tasks module: `app/modules/tasks/`
- Health module: `app/modules/health/` (minimal example)

---

## 11. Logging — Use Loguru Everywhere

All application logging goes through loguru. Never use `print()` or Python's stdlib `logging` module directly.

### Utilities

| Utility | Location |
|---------|----------|
| `configure_logging()` | `app/logging_config.py` |
| `request_id_ctx`, `trace_id_ctx` | `app/logging_config.py` |

### Basic Usage

```python
from loguru import logger

logger.info("Processing request for tenant={}", tenant_id)
logger.warning("Cache miss for key={}", cache_key)
logger.error("Failed to connect to S3: {}", str(exc))
```

### Structured Fields

Use `logger.bind()` to attach structured metadata:

```python
logger.bind(tenant_id=ctx.tenant_id, user_id=user_id).info("Item created")
```

### Automatic Context

The middleware stack automatically injects per-request context into every log entry:

- `request_id` — unique ID per request (from `X-Request-ID` header or auto-generated)
- `trace_id`, `span_id` — OpenTelemetry trace context (if enabled)
- `user_id` — authenticated user (if available)

You get these for free — no manual work needed.

### Log Formats

| Environment | Format | Config |
|-------------|--------|--------|
| Development | Colorized, human-readable | `LOG_JSON=false` (default) |
| Production | Structured JSON | `LOG_JSON=true` |

### Rules

- Use `loguru.logger`, never `import logging`.
- Use `logger.bind()` for structured fields, not string interpolation.
- Use `logger.opt(exception=exc)` to include tracebacks without re-raising.
- Stdlib loggers (uvicorn, celery, motor, boto3) are automatically intercepted and routed through loguru.
- Reference: `app/logging_config.py`

---

## 12. Background Tasks — Celery Worker Conventions

Long-running or async work is dispatched to Celery workers. Never block the API server with heavy computation.

### Utilities

| Utility | Location |
|---------|----------|
| `celery_app` | `app/celery_app.py` |
| `TaskService` | `app/modules/tasks/service.py` |
| `ALLOWED_TASKS` | `app/modules/tasks/service.py` |

### Defining a Task

```python
from app.celery_app import celery_app
from loguru import logger

@celery_app.task(bind=True, name="tasks.process_report")
def process_report_task(self, report_id: str, tenant_id: str = None):
    logger.info("Task {} started for tenant={}", self.request.id, tenant_id)

    # Report progress for long-running work
    for i in range(total_steps):
        do_step(i)
        self.update_state(
            state="PROGRESS",
            meta={"current": i + 1, "total": total_steps, "percent": int((i + 1) / total_steps * 100)},
        )

    logger.info("Task {} completed", self.request.id)
    return {"status": "completed", "report_id": report_id, "tenant_id": tenant_id}
```

### Registering a Task

Add the task name to `ALLOWED_TASKS` in `app/modules/tasks/service.py`:

```python
ALLOWED_TASKS = {
    "tasks.example_long_running",
    "tasks.send_notification",
    "tasks.process_report",  # <-- add here
}
```

Also add the module to `imports` in `app/celery_app.py` if it's in a new file.

### Rules

- **Naming**: Use `tasks.` prefix — `tasks.process_report`, not `process_report`.
- **`bind=True`**: Always use for access to `self.request.id` and `self.update_state()`.
- **`tenant_id` kwarg**: Always accept it. `TaskService.trigger_task()` injects it automatically.
- **Progress**: Report progress via `self.update_state(state="PROGRESS", meta={...})` for SSE streaming.
- **Return type**: Return serializable dicts, not Pydantic models or custom objects.
- **Idempotency**: Tasks may be retried — design them to be safe to re-execute.
- **Whitelist**: Tasks not in `ALLOWED_TASKS` cannot be triggered via the API.
- **Dispatch**: Always use `TaskService.trigger_task()` in routes — never call `celery_app.send_task()` directly.
- Reference: `app/modules/tasks/workers/example_tasks.py`

---

## 13. SSE — Server-Sent Events for Real-Time Streaming

Use SSE for real-time updates to the client (e.g., task progress, notifications).

### Utilities

| Utility | Location |
|---------|----------|
| `TaskService.stream_task_status()` | `app/modules/tasks/service.py` |

### Endpoint Pattern

```python
from fastapi.responses import StreamingResponse

@router.get("/stream/{resource_id}")
async def stream_updates(resource_id: str, request: Request, token: str | None = Query(None)):
    # Auth: browser EventSource can't set headers, so accept ?token= query param
    user_payload = getattr(request.state, "user", None)
    if user_payload is None and token:
        user_payload = decode_access_token(token)

    return StreamingResponse(
        event_generator(resource_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx/proxy buffering
        },
    )
```

### Generator Pattern

```python
async def event_generator(resource_id: str) -> AsyncGenerator[str, None]:
    terminal_states = {"SUCCESS", "FAILURE", "REVOKED"}
    try:
        while True:
            status, payload = await get_current_state(resource_id)

            yield f"event: update\ndata: {json.dumps(payload)}\n\n"

            if status in terminal_states:
                yield f"event: complete\ndata: {json.dumps(payload)}\n\n"
                return

            await asyncio.sleep(1.0)
    except asyncio.CancelledError:
        return  # Client disconnected — clean up gracefully
```

### Event Format

```
event: update
data: {"resource_id": "abc", "status": "PROGRESS", "percent": 50}

event: complete
data: {"resource_id": "abc", "status": "SUCCESS", "result": {...}}
```

### Rules

- Always set `X-Accel-Buffering: no` to prevent nginx from buffering the stream.
- Support `?token=` query param for browser `EventSource` (which cannot set `Authorization` headers).
- Emit events only when state changes — don't spam the client.
- Handle `asyncio.CancelledError` to clean up when the client disconnects.
- Reference: `app/modules/tasks/service.py`, `app/modules/tasks/routes.py`

---

## 14. Testing — Test Conventions

Every module must have tests. Tests use mocked infrastructure — no real MongoDB or Redis required.

### Utilities

| Utility | Location |
|---------|----------|
| Test fixtures | `app/tests/conftest.py` |
| `mongomock-motor` | Mock MongoDB driver |
| `fakeredis` | Mock Redis |

### File Structure

```
app/tests/
├── conftest.py                    # Shared fixtures
├── test_health.py                 # Health check tests
├── test_auth/
│   ├── test_routes.py             # Auth endpoint tests
│   └── test_jwt.py                # JWT unit tests
├── test_storage/
│   └── test_routes.py             # Storage endpoint tests
└── test_tasks/
    └── test_routes.py             # Tasks endpoint tests
```

New modules: create `app/tests/test_{module_name}/test_routes.py`.

### Available Fixtures

```python
mock_settings       # Settings with test values (no real credentials needed)
mock_tenant_ctx     # TenantContext with mock database
app                 # FastAPI app with all deps mocked
client              # Async HTTP client for endpoint testing
auth_headers        # Auth headers with a valid test JWT
```

### Test Pattern

```python
import pytest

@pytest.mark.asyncio
async def test_list_items_requires_auth(client):
    response = await client.get("/api/v1/feature/items")
    assert response.status_code == 401

@pytest.mark.asyncio
async def test_list_items_returns_paginated(client, auth_headers):
    response = await client.get("/api/v1/feature/items", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert "total" in data
```

### Rules

- Use `@pytest.mark.asyncio` for all async tests.
- Test both success and error paths (401, 403, 404, 422).
- Use `conftest.py` fixtures — don't reinvent mocks.
- Assert on `response.status_code` and `response.json()`.
- Reference: `app/tests/conftest.py`

---

## 15. Configuration — Settings Access Pattern

All configuration comes from environment variables via Pydantic Settings. Never hardcode values.

### Utility

| Utility | Location |
|---------|----------|
| `get_settings()` | `app/config.py` |
| `Settings` class | `app/config.py` |

### Accessing Settings

```python
from app.config import get_settings

settings = get_settings()  # LRU-cached singleton
expiry = settings.s3_presigned_url_expiry
```

### Adding a New Setting

1. Add the field to the `Settings` class in `app/config.py`:

```python
class Settings(BaseSettings):
    # ... existing fields ...
    my_new_setting: str = "default_value"
    my_required_secret: str = ""
```

2. Add production validation if the setting is a secret or required credential:

```python
@model_validator(mode="after")
def _validate_production_config(self) -> "Settings":
    if self.app_env != "production":
        return self
    if not self.my_required_secret:
        errors.append("MY_REQUIRED_SECRET must be set")
```

3. Add the env var to `.env.example`.

### Rules

- Always use `get_settings()` — never instantiate `Settings()` directly (it's cached).
- Never hardcode URLs, secrets, or tuning parameters. Put them in settings.
- Production mode fails fast on default secrets and missing credentials.
- Reference: `app/config.py`

---

## 16. Database — Beanie vs Motor Conventions

The platform uses two data access patterns depending on whether data is shared or tenant-scoped.

### Shared Data (Beanie Documents)

For data that spans tenants (users, tenant registry), use Beanie ODM:

```python
from beanie import Indexed, Document
from app.common.models import BaseDocument

class User(BaseDocument):
    email: Indexed(EmailStr, unique=True)
    tenant_id: Indexed(Optional[str]) = None
    roles: List[str] = Field(default_factory=lambda: ["user"])

    class Settings:
        collection = "users"
        use_state_management = True
```

`BaseDocument` (from `app/common/models.py`) provides `created_at` and `updated_at` timestamps automatically.

### Tenant-Scoped Data (Motor Collections)

For data isolated per tenant, use Pydantic models with Motor collections:

```python
from pydantic import BaseModel, Field
from datetime import UTC, datetime

class Item(BaseModel):
    id: Optional[str] = None
    tenant_id: str
    name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    def to_doc(self) -> dict:
        """Convert to MongoDB document for insertion."""
        return self.model_dump(exclude={"id"})

    @classmethod
    def from_doc(cls, doc: dict) -> "Item":
        """Create from MongoDB document."""
        doc = dict(doc)
        doc["id"] = str(doc.pop("_id")) if "_id" in doc else None
        return cls(**doc)
```

Access the collection via tenant context:

```python
collection = get_tenant_collection("items")
await collection.insert_one(item.to_doc())
doc = await collection.find_one({"_id": ObjectId(item_id)})
item = Item.from_doc(doc)
```

### Indexes for Tenant Collections

Register indexes in `TenantDatabaseManager.ensure_indexes()` in `app/tenant.py`:

```python
async def ensure_indexes(self, tenant_id: str) -> None:
    db = self.get_tenant_db(tenant_id)
    items_coll = db["items"]
    await items_coll.create_index("name")
    await items_coll.create_index("created_at")
```

### Rules

- Shared models: inherit from `BaseDocument`, use `Indexed()` for query fields.
- Tenant models: plain Pydantic with `to_doc()` and `from_doc()` methods.
- Always include `tenant_id` in tenant-scoped models.
- Register indexes in `ensure_indexes()` — they run lazily on first tenant access.
- References: `app/common/models.py`, `app/modules/storage/models.py`, `app/tenant.py`

---

## 17. Dependency Injection — FastAPI Dependency Patterns

Use FastAPI's dependency injection for auth, permissions, and service instantiation. Never check auth inside route bodies.

### Utilities

| Utility | Location |
|---------|----------|
| `CurrentUser` | `app/modules/auth/dependencies.py` |
| `require_tenant()` | `app/modules/auth/dependencies.py` |
| `require_roles()` | `app/modules/auth/dependencies.py` |
| `require_permissions()` | `app/modules/auth/dependencies.py` |

### Type-Annotated Dependencies

Use `Annotated` for reusable dependency types:

```python
from typing import Annotated
from fastapi import Depends

CurrentUser = Annotated[User, Depends(get_current_user)]

@router.get("/me")
async def get_profile(user: CurrentUser):
    return user  # user is injected and validated automatically
```

### Factory Dependencies

For parameterized checks, use the factory pattern:

```python
def require_permissions(required_permissions: List[str]):
    async def permission_checker(user: CurrentUser):
        if not all(perm in user.permissions for perm in required_permissions):
            raise ForbiddenException("Insufficient permissions")
        return user
    return permission_checker
```

### Usage Patterns

```python
# Inject a value into the route function
@router.get("/items")
async def list_items(user: CurrentUser):
    ...

# Check without injecting (use dependencies= on the decorator)
@router.post(
    "/items",
    dependencies=[
        Depends(require_tenant()),
        Depends(require_permissions(["items:create"])),
    ],
)
async def create_item(body: CreateItemRequest, user: CurrentUser):
    ...

# Service instantiation via dependency
def get_storage_service() -> StorageService:
    return StorageService()

@router.post("/upload")
async def upload(service: StorageService = Depends(get_storage_service)):
    ...
```

### Rules

- Use `dependencies=[...]` on the route decorator for checks that don't return values.
- Use function params for deps that inject values (e.g. `user: CurrentUser`).
- Dependencies compose: `require_permissions` implicitly checks auth via `CurrentUser`.
- Raise exceptions (`UnauthorizedException`, `ForbiddenException`) to signal failures — never return error dicts.
- Reference: `app/modules/auth/dependencies.py`

---

## 18. Twelve-Factor App Compliance

This platform follows the [Twelve-Factor App](https://12factor.net) methodology. Every new feature must preserve these principles.

### I. Codebase — One codebase, many deploys

One Git repository produces all deployment artifacts. The same codebase runs in development, staging, and production — differentiated only by configuration.

- Single repo → single `Dockerfile` → single image
- `APP_ENV` (`development` / `staging` / `production`) controls behavior differences
- CI pipeline (`.github/workflows/ci.yml`) builds from `main`

**Rule**: Never maintain separate codebases for different environments.

### II. Dependencies — Explicitly declare and isolate

All dependencies are declared in `pyproject.toml` with version constraints. No implicit system-level dependencies at runtime.

```
pyproject.toml          # Declares all Python deps
requirements.lock       # Pinned versions (make lock)
requirements-dev.lock   # Dev deps pinned
Dockerfile              # Multi-stage build isolates into /opt/venv
```

**Rule**: Never `pip install` something in production that isn't in `pyproject.toml`. Run `make lock` after adding deps.

### III. Config — Store config in the environment

All configuration comes from environment variables, loaded via Pydantic Settings in `app/config.py`. See [Standard #15](#15-configuration--settings-access-pattern) for details.

- `.env` file for local development
- Environment variables in staging/production (injected by orchestrator)
- Production validator rejects default secrets on startup

**Rule**: Never hardcode URLs, credentials, or tuning parameters. Never commit `.env` files.

### IV. Backing services — Treat as attached resources

MongoDB, Redis, RabbitMQ, and S3 are all accessed via URL/credential env vars. Swapping a backing service (e.g., local Redis → ElastiCache) requires only changing an env var.

| Service | Config Var | Access |
|---------|-----------|--------|
| MongoDB | `MONGODB_URL` | `app/database.py` — Motor client |
| Redis | `REDIS_URL` | `app/redis.py` — aioredis |
| Celery broker | `CELERY_BROKER_URL` | `app/celery_app.py` — Redis or AMQP |
| Celery backend | `CELERY_RESULT_BACKEND` | `app/celery_app.py` — MongoDB |
| S3 | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | `app/modules/storage/service.py` — boto3 |

**Rule**: Never import connection strings or credentials directly. Always go through `get_settings()`. A backing service swap must be a config change, not a code change.

### V. Build, release, run — Strictly separate stages

| Stage | What happens | Artifact |
|-------|-------------|----------|
| **Build** | `docker build` — install deps, copy code | Docker image |
| **Release** | Image + environment config (`.env`, secrets) | Deployable unit |
| **Run** | `uvicorn` / `celery worker` inside container | Running process |

The `Dockerfile` uses multi-stage builds:
- Stage 1 (`builder`): installs deps into `/opt/venv`
- Stage 2 (`runtime`): copies venv + app code, runs as non-root `appuser`

**Rule**: Never modify code in a running container. Build a new image instead.

### VI. Processes — Execute as stateless processes

The API server stores **zero local state**. All persistent state lives in backing services:

| State | Where it lives |
|-------|---------------|
| User sessions | JWT tokens (client-side) + Redis blacklist |
| File uploads | S3 (never local disk) |
| Task results | MongoDB (Celery result backend) |
| Cache | Redis |
| Tenant context | Per-request contextvar (reset each request) |

**Rule**: Never write to the local filesystem for persistent data. Never store request state in module-level variables that persist across requests (contextvars are per-request and safe).

### VII. Port binding — Export services via port binding

The app is fully self-contained. Uvicorn binds directly to port 8000 — no external web server (nginx/Apache) required to serve the application.

```dockerfile
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

A reverse proxy can sit in front for TLS termination, but the app runs independently.

**Rule**: The app must be runnable with a single command. No required external web server configuration.

### VIII. Concurrency — Scale out via the process model

The platform scales horizontally by running more processes, not by threading within a single process:

| Process type | Scale command | What it handles |
|-------------|--------------|-----------------|
| **Web** | Multiple uvicorn workers or container replicas | HTTP requests |
| **Worker** | Multiple Celery workers (`--concurrency=N`) | Background tasks |

```yaml
# docker-compose.yml runs them as separate services
services:
  app:           # Web process
  celery_worker: # Worker process
```

Both are stateless (Factor VI), so adding replicas is safe.

**Rule**: Offload heavy work to Celery workers. Scale web and worker processes independently based on load.

### IX. Disposability — Fast startup, graceful shutdown

The app starts fast and shuts down gracefully via the `lifespan` context manager in `app/main.py`:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup — initialize connections
    await init_db(settings)
    await init_redis(settings)
    init_tenant_manager(get_motor_client(), settings)
    yield
    # Shutdown — close connections cleanly
    await close_redis()
    await close_db()
    shutdown_telemetry()
```

Celery workers are configured for safe restarts:
- `task_acks_late=True` — tasks acknowledged only after completion
- `worker_prefetch_multiplier=1` — worker fetches one task at a time
- If a worker crashes, unacknowledged tasks are re-queued automatically

Docker HEALTHCHECK enables orchestrators to detect and replace unhealthy processes.

**Rule**: Initialize all resources in `lifespan` startup. Release all resources in `lifespan` shutdown. Keep startup fast.

### X. Dev/prod parity — Keep environments similar

| Aspect | Development | Production |
|--------|------------|------------|
| Backing services | Same versions via Docker Compose (Mongo 7, Redis 7, RabbitMQ 3) | Managed services (DocumentDB, ElastiCache, Amazon MQ) |
| Code | Same `Dockerfile`, same deps | Same image |
| Config | `.env` file | Env vars from secrets manager |
| Behavior differences | `debug=True`, Swagger UI enabled, colorized logs | `debug=False`, Swagger disabled, JSON logs, HSTS |

**Rule**: Use Docker Compose locally with the same service versions as production. Minimize behavior branching on `APP_ENV` — only for security (HSTS, error redaction) and developer experience (docs UI, log format).

### XI. Logs — Treat logs as event streams

The app never writes log files. All output goes to `stderr` as a stream. See [Standard #11](#11-logging--use-loguru-everywhere) for details.

- Development: colorized human-readable output to terminal
- Production: structured JSON to `stderr`, captured by container runtime
- Audit events tagged with `audit=True` for downstream filtering/routing

The container orchestrator (ECS, Kubernetes) captures stdout/stderr and routes to the log aggregation service (CloudWatch, Datadog, ELK).

**Rule**: Never open log files. Never configure log rotation in the app. Write to stderr and let the platform handle it.

### XII. Admin processes — Run as one-off tasks

Administrative and maintenance work runs in the same codebase and environment as the app:

| Admin task | How to run |
|-----------|-----------|
| Background jobs | Celery tasks dispatched via API (`POST /tasks/trigger`) |
| Data migrations | One-off script in `scripts/` using the same `app.config` and `app.database` |
| Interactive debug | `python -c "from app.config import get_settings; ..."` inside the container |
| Linting / testing | `make lint`, `make test` (same deps as CI) |

```bash
# Run a one-off command in the same environment
docker compose exec app python -c "from app.database import init_db; ..."

# Or run a script
docker compose exec app python scripts/migrate_data.py
```

**Rule**: Admin scripts must import from `app.*` and use the same config/database utilities. Never write standalone scripts with hardcoded connection strings.

### Compliance Summary

| Factor | Status | Implementation |
|--------|--------|---------------|
| I. Codebase | Done | Single Git repo, `APP_ENV` differentiates deploys |
| II. Dependencies | Done | `pyproject.toml` + `requirements.lock` + Docker venv |
| III. Config | Done | Pydantic Settings from env vars (Standard #15) |
| IV. Backing services | Done | All services accessed via URL env vars |
| V. Build/release/run | Done | Multi-stage Docker build, image + config = release |
| VI. Processes | Done | Stateless — all state in MongoDB/Redis/S3 |
| VII. Port binding | Done | Uvicorn binds port 8000 directly |
| VIII. Concurrency | Done | Separate web + worker processes, horizontally scalable |
| IX. Disposability | Done | Lifespan startup/shutdown, Celery `acks_late` |
| X. Dev/prod parity | Done | Docker Compose mirrors production services |
| XI. Logs | Done | Loguru to stderr, JSON in production (Standard #11) |
| XII. Admin processes | Done | Celery tasks + scripts using same `app.*` modules |

---

## 19. Software Engineering Principles

This section maps SOLID, DRY, and related principles to concrete patterns already established in the codebase. Follow these patterns when adding new code.

### 19.1 Single Responsibility Principle (SRP)

> Every module, class, or file should have one reason to change.

**How we apply it:**

- **Module file separation** — each file in a module has exactly one job:
  - `routes.py` — HTTP request/response handling only
  - `service.py` — business logic only (no HTTP concerns)
  - `models.py` — data persistence only
  - `schemas.py` — request/response validation only
- **Single-purpose middleware** — each middleware file handles one cross-cutting concern:
  - `request_id.py` — request tracing
  - `security_headers.py` — HTTP security headers
  - `error_handler.py` — exception-to-response mapping

**Rule**: If a file does two unrelated things, split it. A route handler should never contain business logic; a service should never import `Request` or `Response`.

> Reference: `app/modules/*/routes.py`, `app/modules/*/service.py`, `app/middleware/`

### 19.2 Open/Closed Principle (OCP)

> Software entities should be open for extension but closed for modification.

**How we apply it:**

- **Auth provider factory** — adding a new auth provider (e.g., Google, Okta) requires:
  1. Create a new file implementing `AuthProvider` (e.g., `providers/google.py`)
  2. Call `register_provider("google", GoogleAuthProvider)` in factory
  3. Zero changes to `AuthService`, routes, or existing providers

```python
# app/modules/auth/providers/factory.py
_provider_registry: dict[str, type[AuthProvider]] = {}

def register_provider(name: str, provider_class: type[AuthProvider]) -> None:
    _provider_registry[name] = provider_class
```

- **Celery task whitelist** — new tasks are added to `ALLOWED_TASKS` without modifying dispatch logic

**Rule**: When you need to support a new variant of something, add a new class/module and register it. Never add `if/elif` branches to existing code for new variants.

> Reference: `app/modules/auth/providers/base.py`, `app/modules/auth/providers/factory.py`

### 19.3 Liskov Substitution Principle (LSP)

> Subtypes must be substitutable for their base types without altering program correctness.

**How we apply it:**

- All auth providers implement the same `AuthProvider` abstract interface:
  - `get_login_url(tenant_id, redirect_uri)` → `str`
  - `handle_callback(code, redirect_uri, tenant_id)` → user info dict
  - `get_logout_url(redirect_uri)` → `Optional[str]`
- `AuthService` calls these methods on whichever provider is configured — no type-checking, no special cases

```python
# In AuthService — provider is interchangeable
provider = get_provider(tenant.auth_provider)
login_url = await provider.get_login_url(tenant_id, redirect_uri)
```

**Rule**: If you implement an interface/base class, honor its full contract. Never raise `NotImplementedError` for required methods or return unexpected types.

> Reference: `app/modules/auth/providers/microsoft.py`, `app/modules/auth/providers/saml.py`, `app/modules/auth/service.py`

### 19.4 Interface Segregation Principle (ISP)

> Clients should not be forced to depend on interfaces they don't use.

**How we apply it:**

- **Separate request/response schemas** — a route that only creates resources sees `CreateFileRequest`, not a monolithic `File` model with fields it doesn't need
- **Granular auth dependencies** — routes declare only the checks they need:
  - `require_tenant()` — just tenant context
  - `require_roles(["admin"])` — role check (implies auth)
  - `require_permissions(["files:write"])` — permission check (implies auth + tenant)
- Routes never receive a "god object" with all possible auth context; they get exactly what they declare

```python
# Only requires tenant context — no role/permission overhead
@router.get("/files", dependencies=[Depends(require_tenant())])
async def list_files(user: CurrentUser): ...

# Requires specific permission
@router.delete("/files/{id}", dependencies=[Depends(require_permissions(["files:delete"]))])
async def delete_file(user: CurrentUser): ...
```

**Rule**: Prefer many small, focused dependencies over one large dependency that returns everything. Prefer specific schemas over reusing the database model.

> Reference: `app/modules/auth/schemas.py`, `app/modules/auth/dependencies.py`

### 19.5 Dependency Inversion Principle (DIP)

> High-level modules should depend on abstractions, not concrete implementations.

**How we apply it:**

- **FastAPI `Depends()`** — routes declare *what* they need, not *how* to get it:
  - `user: CurrentUser` — route doesn't know about JWT parsing, token validation, or database lookup
  - `tenant_ctx: TenantContext = Depends(require_tenant())` — route doesn't know about tenant resolution logic
- **`CacheService`** — services call `CacheService.get()` / `CacheService.set()`, never `redis.get()` directly
- **`get_settings()`** — all code reads config through the abstraction, never from `os.environ` directly
- **Testability** — dependencies are trivially swapped in tests by overriding `app.dependency_overrides`

```python
# Production: resolves from JWT + database
CurrentUser = Annotated[User, Depends(get_current_user)]

# Test: injected directly
app.dependency_overrides[get_current_user] = lambda: mock_user
```

**Rule**: Never import and call infrastructure directly in route handlers or services. Always go through a dependency or abstraction layer.

> Reference: `app/modules/auth/dependencies.py`, `app/common/cache.py`, `app/config.py`

### 19.6 DRY (Don't Repeat Yourself)

> Every piece of knowledge should have a single, authoritative representation.

**How we apply it:**

| Shared Concern | Reusable Component | Location |
|---|---|---|
| Timestamps on documents | `TimestampMixin` / `BaseDocument` | `app/common/models.py` |
| Caching logic | `CacheService` + `@cached` decorator | `app/common/cache.py` |
| Audit logging | `audit_log()` function | `app/common/audit.py` |
| List pagination | `PaginationParams` + `PaginatedResponse` | `app/common/schemas.py` |
| JWT token payload | `_build_token_data()` helper | `app/modules/auth/service.py` |
| Error responses | `AppException` hierarchy | `app/common/exceptions.py` |

**Rule**: Before writing logic, check `app/common/` for an existing utility. If you find yourself copy-pasting code between modules, extract it to `app/common/`.

> Reference: `app/common/`

### 19.7 KISS & YAGNI

> Keep it simple. Don't build what you don't need yet.

**How we apply it:**

- **Static service classes** — services use `@staticmethod` methods, not complex dependency-injected class hierarchies. No abstract base class for services because there's no polymorphism needed.
- **Motor over ORM for tenant data** — raw Motor collections are simpler and sufficient for tenant-scoped data. Beanie is only used where its document lifecycle features (hooks, state management) add value.
- **Built-in middleware** — FastAPI's `@app.middleware("http")` and Starlette's middleware classes are used directly. No custom middleware framework.
- **No premature abstraction** — three similar lines of code are better than an abstraction with one caller

```python
# Good: simple and direct
class StorageService:
    @staticmethod
    async def list_files(tenant_ctx: TenantContext, ...) -> PaginatedResponse:
        collection = tenant_ctx.get_collection("files")
        ...

# Bad: unnecessary abstraction for a single implementation
class BaseService(ABC):
    @abstractmethod
    async def list(self): ...

class StorageService(BaseService):
    async def list(self): ...
```

**Rule**: Don't add abstractions, configurability, or "extensibility" until the second concrete use case demands it. Solve today's problem today.

### 19.8 Composition over Inheritance

> Favor composing behaviors from independent parts over deep class hierarchies.

**How we apply it:**

- **Middleware stack** — each middleware is an independent unit composed onto the app:
  ```python
  app.add_middleware(SecurityHeadersMiddleware)
  app.add_middleware(RequestIdMiddleware)
  # Each is independent — order matters, but they don't inherit from each other
  ```
- **Dependency composition** — complex auth checks are built by composing simple dependencies:
  - `require_permissions()` internally uses `CurrentUser`
  - `CurrentUser` internally uses `get_current_user()`
  - Each layer is independently testable and reusable
- **Mixins over deep hierarchies** — `TimestampMixin` adds `created_at`/`updated_at` to any model. `BaseDocument` composes `TimestampMixin` + Beanie `Document`. Max inheritance depth: 2.

**Rule**: If you need to share behavior, use mixins or dependency composition. Never create inheritance chains deeper than 2 levels.

> Reference: `app/main.py`, `app/modules/auth/dependencies.py`, `app/common/models.py`

### Principles Quick Reference

| Principle | Key Pattern | Primary Example |
|---|---|---|
| **SRP** | One file = one job | `routes.py` vs `service.py` vs `models.py` |
| **OCP** | Registry + interface | Auth provider factory (`register_provider()`) |
| **LSP** | Consistent interface | Microsoft & SAML providers interchangeable |
| **ISP** | Granular dependencies | `require_roles()`, `require_permissions()`, `require_tenant()` |
| **DIP** | `Depends()` everywhere | `CurrentUser`, `CacheService`, `get_settings()` |
| **DRY** | `app/common/` utilities | `BaseDocument`, `@cached`, `audit_log()` |
| **KISS/YAGNI** | No premature abstraction | Static services, Motor over ORM for tenants |
| **Composition** | Compose, don't inherit | Middleware stack, dependency chains, mixins |

---

## Checklist for New Features

Before submitting a PR for a new feature, verify:

- [ ] Module follows standard layout (`routes.py`, `service.py`, `models.py`, `schemas.py`)
- [ ] Router mounted in `main.py` with `prefix` and `tags`
- [ ] List endpoints are paginated with `skip`/`limit` and return `total`
- [ ] Read-heavy queries use `@cached` or `CacheService` with proper invalidation
- [ ] File transfers use S3 presigned URLs (no byte proxying)
- [ ] All state-changing operations emit `audit_log()` entries
- [ ] Errors use platform exceptions (`NotFoundException`, `BadRequestException`, etc.)
- [ ] Logging uses `loguru.logger`, not `print()` or stdlib logging
- [ ] Data access goes through `get_tenant_ctx()` / `get_tenant_collection()`
- [ ] Routes declare `require_tenant()`, `require_roles()`, or `require_permissions()` as appropriate
- [ ] Request/response bodies use Pydantic schemas with `response_model` on the route
- [ ] Mutating endpoints accept `Idempotency-Key` header where applicable
- [ ] Route decorators include `summary=` for OpenAPI docs
- [ ] Background work dispatched via Celery (task registered in `ALLOWED_TASKS`)
- [ ] Settings accessed via `get_settings()`, no hardcoded values
- [ ] Tests added in `app/tests/test_{module}/` with success and error cases
- [ ] Code follows SOLID/DRY principles — no deep inheritance, no copy-paste, shared logic in `app/common/` (Section 19)
