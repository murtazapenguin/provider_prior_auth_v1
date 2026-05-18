# Low-Level Design (LLD)

## 1. Project Structure

```
app/
├── main.py                          # App factory, middleware wiring, router mounting
├── config.py                        # Pydantic Settings (all env vars)
├── database.py                      # MongoDB init (Beanie for shared, Motor client for tenant)
├── redis.py                         # Async Redis connection lifecycle
├── celery_app.py                    # Celery instance + worker config
├── tenant.py                        # TenantContext contextvar, TenantDatabaseManager
├── telemetry.py                     # OpenTelemetry + Prometheus init
├── logging_config.py                # Loguru setup, stdlib interception
├── common/
│   ├── models.py                    # BaseDocument (Beanie), TimestampMixin
│   ├── exceptions.py                # AppException hierarchy (400-409, 500)
│   ├── error_handlers.py            # Global exception → JSON response mapping
│   ├── audit.py                     # Structured audit log emitter
│   ├── cache.py                     # CacheService (Redis get/set/delete), @cached decorator
│   ├── schemas.py                   # PaginationParams, PaginatedResponse, ErrorResponse
│   └── dependencies.py              # get_pagination() FastAPI dependency
├── middleware/
│   ├── auth.py                      # JWTSessionMiddleware
│   ├── tenant.py                    # TenantContextMiddleware
│   ├── rate_limit.py                # RateLimitMiddleware
│   ├── security.py                  # SecurityHeadersMiddleware
│   ├── cors.py                      # CORS configuration
│   ├── logging.py                   # LoggingMiddleware
│   └── request_id.py                # RequestIDMiddleware
├── modules/
│   ├── auth/
│   │   ├── routes.py                # Auth endpoints (login, callback, refresh, logout, /me)
│   │   ├── admin_routes.py          # Admin endpoints (list users, update roles)
│   │   ├── service.py               # AuthService (login flow, token creation)
│   │   ├── jwt.py                   # Token create/decode/blacklist
│   │   ├── rbac.py                  # Permissions, ROLE_PERMISSIONS, resolve_permissions()
│   │   ├── dependencies.py          # CurrentUser, require_roles, require_permissions, require_tenant
│   │   ├── models.py                # User (Beanie Document)
│   │   ├── tenant_model.py          # Tenant (Beanie Document)
│   │   ├── schemas.py               # Auth request/response Pydantic models
│   │   ├── admin_schemas.py         # Admin request/response Pydantic models
│   │   ├── constants.py             # PROVIDER_MICROSOFT, PROVIDER_SAML
│   │   └── providers/
│   │       ├── base.py              # AuthProvider ABC
│   │       ├── microsoft.py         # MicrosoftAuthProvider (MSAL)
│   │       ├── saml.py              # SAMLAuthProvider (pysaml2)
│   │       └── factory.py           # get_auth_provider(), register_provider()
│   ├── storage/
│   │   ├── routes.py                # Storage endpoints (upload-url, confirm, download-url)
│   │   ├── service.py               # StorageService (S3 presigned URLs, Motor CRUD)
│   │   ├── models.py                # FileMetadata (Pydantic + Motor helpers)
│   │   ├── schemas.py               # Storage request/response Pydantic models
│   │   └── constants.py             # ALLOWED_CONTENT_TYPES
│   ├── tasks/
│   │   ├── routes.py                # Task endpoints (trigger, status, SSE stream)
│   │   ├── service.py               # TaskService (Celery dispatch, AsyncResult polling, SSE)
│   │   ├── schemas.py               # Task request/response Pydantic models
│   │   └── workers/
│   │       └── example_tasks.py     # Celery task definitions
│   └── health/
│       └── routes.py                # /health, /readiness
└── tests/
    ├── conftest.py                  # Fixtures (mock DB, Redis, tenant context)
    ├── test_auth/
    ├── test_health.py
    ├── test_storage/
    └── test_tasks/
```

---

## 2. Application Lifecycle

### 2.1 Startup (`app/main.py`)

```
configure_logging(settings)          # 1. Loguru setup (before anything logs)

create_app():
  FastAPI(lifespan=lifespan)         # 2. Create app with lifespan handler
  init_telemetry(app, settings)      # 3. OTel TracerProvider + MeterProvider + /metrics
  add_middleware(...)                 # 4. Register middleware stack (see §3)
  register_error_handlers(app)       # 5. Global exception → JSON mapping
  include_router(...)                # 6. Mount all route modules

lifespan (async context manager):
  startup:
    await init_db(settings)          # 7. Motor client + Beanie init (User, Tenant)
    await init_redis(settings)       # 8. Async Redis connection
    init_tenant_manager(client, s)   # 9. TenantDatabaseManager singleton
  shutdown:
    await close_redis()
    await close_db()
    shutdown_telemetry()
```

### 2.2 Request Lifecycle

```
Incoming HTTP Request
  │
  ├─ CORS (Starlette CORSMiddleware)
  │    └─ Validates Origin header against allowed_origins
  │
  ├─ JWTSessionMiddleware
  │    ├─ Skip if path in EXEMPT_PATHS (/health, /readiness, /docs, /metrics, etc.)
  │    ├─ Extract "Bearer <token>" from Authorization header
  │    ├─ decode_access_token(token) → validates sig, exp, iss, aud, type
  │    ├─ is_token_blacklisted(jti) → Redis lookup
  │    ├─ If valid and not blacklisted: request.state.user = payload
  │    └─ Bind user_id to loguru contextvar
  │
  ├─ TenantContextMiddleware
  │    ├─ Skip if path in TENANT_EXEMPT_PATHS or TENANT_EXEMPT_PREFIXES
  │    ├─ Read tenant_id from request.state.user
  │    ├─ Lookup Tenant record (Redis cache → MongoDB fallback)
  │    ├─ TenantDatabaseManager.get_tenant_db(tenant_id) → Motor database
  │    ├─ TenantDatabaseManager.get_tenant_bucket(tenant_id) → S3 bucket name
  │    ├─ set_tenant_ctx(TenantContext(...)) → ContextVar
  │    └─ ensure_indexes(tenant_id) → lazy index creation on first access
  │
  ├─ RateLimitMiddleware
  │    ├─ Skip if path in RATE_LIMIT_EXEMPT_PATHS
  │    ├─ Key = "user:{sub}" (authenticated) or "ip:{client.host}" (anonymous)
  │    ├─ Redis pipeline: INCR + EXPIRE(NX)
  │    ├─ If count > max_requests → 429 JSON response
  │    └─ Set X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Window headers
  │
  ├─ LoggingMiddleware
  │    └─ Log: method, path, status_code, duration_ms, user_id
  │
  ├─ RequestIDMiddleware
  │    ├─ Read X-Request-ID or generate UUID
  │    ├─ Bind to loguru contextvar (request_id_ctx)
  │    ├─ Extract OTel trace_id, span_id → bind to loguru
  │    └─ Set X-Request-ID response header
  │
  ├─ SecurityHeadersMiddleware
  │    └─ Add: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection,
  │       Referrer-Policy, Permissions-Policy, Cache-Control, HSTS (production)
  │
  └─ Route Handler
       ├─ FastAPI dependency injection: CurrentUser, require_tenant(), require_permissions()
       ├─ Service layer call
       └─ Response serialization
```

---

## 3. Module Designs

### 3.1 Auth Module

#### 3.1.1 Data Models

**User** (`app/modules/auth/models.py`) — Beanie Document, shared database:

| Field | Type | Description |
|-------|------|-------------|
| `email` | `EmailStr` (unique index) | User email |
| `display_name` | `str` | Display name from IdP |
| `provider` | `str` | `"microsoft"` or `"saml"` |
| `provider_user_id` | `str` | IdP subject identifier |
| `tenant_id` | `Optional[str]` | SaaS tenant/org ID from IdP claims |
| `roles` | `List[str]` | Default: `["user"]` |
| `permissions` | `List[str]` | Directly-assigned extra permissions |
| `avatar_url` | `Optional[str]` | Profile image URL |
| `is_active` | `bool` | Default: `True` |
| `last_login` | `Optional[str]` | ISO timestamp |
| `created_at` | `datetime` | From `TimestampMixin` |
| `updated_at` | `datetime` | From `TimestampMixin` |

**Tenant** (`app/modules/auth/tenant_model.py`) — Beanie Document, shared database:

| Field | Type | Description |
|-------|------|-------------|
| `tenant_id` | `str` (unique index) | Tenant identifier (from IdP `tid` claim) |
| `name` | `str` | Tenant display name |
| `is_active` | `bool` | Default: `True` |
| `s3_bucket_name` | `Optional[str]` | Override default bucket naming |
| `db_name` | `Optional[str]` | Override default DB naming |
| `created_at` | `datetime` | From `TimestampMixin` |
| `updated_at` | `datetime` | From `TimestampMixin` |

#### 3.1.2 JWT Token Structure

**Access Token** payload:

```json
{
  "sub": "user_object_id",
  "email": "user@example.com",
  "tenant_id": "azure-ad-tenant-guid",
  "roles": ["owner", "user"],
  "permissions": ["storage:upload", "storage:download", "...resolved from roles..."],
  "iss": "platform-backend-kit",
  "aud": "platform-backend-kit",
  "jti": "uuid4",
  "iat": 1700000000,
  "exp": 1700001800,
  "type": "access"
}
```

**Refresh Token**: Same structure with `"type": "refresh"` and longer TTL.

Token signing: HMAC-SHA256 (`HS256`) via `python-jose`. Key: `JWT_SECRET_KEY` env var.

#### 3.1.3 Token Blacklisting

On logout, the access token's `jti` is written to Redis:

```
Key:   token_blacklist:{jti}
Value: "1"
TTL:   remaining seconds until token expiry
```

`JWTSessionMiddleware` checks `is_token_blacklisted(jti)` on every request. Fails open if Redis is down.

#### 3.1.4 Auth Provider Architecture

```
AuthProvider (ABC)
  ├─ get_login_url(redirect_url) → str
  ├─ handle_callback(request) → AuthCallbackData
  └─ get_logout_url() → Optional[str]

MicrosoftAuthProvider(AuthProvider)
  ├─ Uses msal.ConfidentialClientApplication
  ├─ Auth code flow: initiate_auth_code_flow → acquire_token_by_auth_code_flow
  ├─ Flow state cached in Redis (TTL 600s)
  └─ Returns id_token_claims as raw_claims

SAMLAuthProvider(AuthProvider)
  ├─ Uses pysaml2.client.Saml2Client
  ├─ SP-initiated flow: prepare_for_authenticate → parse_authn_request_response
  └─ Extracts identity attributes from SAML assertion

factory.get_auth_provider(name) → AuthProvider
  ├─ Lazily instantiates providers
  └─ register_provider(name, cls) for extension
```

#### 3.1.5 Login Flow (sequence)

```
Client                   API                        IdP               Redis        MongoDB
  │                       │                          │                  │             │
  ├─POST /auth/login─────►│                          │                  │             │
  │  {provider:"microsoft"}                          │                  │             │
  │                       ├─initiate_auth_code_flow──►                  │             │
  │                       │◄─auth_uri + flow state───┤                  │             │
  │                       ├─cache flow state──────────────────────────►│             │
  │◄──{login_url}─────────┤                          │                  │             │
  │                       │                          │                  │             │
  ├─Browser redirect─────────────────────────────────►                  │             │
  │                       │                          │                  │             │
  │◄─Redirect with code───────────────────────────────┤                  │             │
  │                       │                          │                  │             │
  ├─GET /auth/callback────►│                          │                  │             │
  │  ?code=...&state=...  ├─get flow from cache──────────────────────►│             │
  │                       │◄─flow state──────────────────────────────┤             │
  │                       ├─acquire_token─────────────►                  │             │
  │                       │◄─id_token_claims──────────┤                  │             │
  │                       │                          │                  │             │
  │                       ├─User.find_one(email)──────────────────────────────────►│
  │                       │◄─user (or None)───────────────────────────────────────┤
  │                       ├─upsert user───────────────────────────────────────────►│
  │                       │                          │                  │             │
  │                       ├─Tenant.find_one(tid)──────────────────────────────────►│
  │                       │  (auto-provision if new,  │                  │             │
  │                       │   assign owner role)      │                  │             │
  │                       │                          │                  │             │
  │                       ├─_build_token_data(user)   │                  │             │
  │                       │  resolve_permissions()    │                  │             │
  │                       │  create_access_token()    │                  │             │
  │                       │  create_refresh_token()   │                  │             │
  │                       │                          │                  │             │
  │◄──{access_token,      │                          │                  │             │
  │    refresh_token,     │                          │                  │             │
  │    expires_in}        │                          │                  │             │
```

#### 3.1.6 RBAC

**Permission Constants** (`app/modules/auth/rbac.py`):

```
storage:upload, storage:download, storage:delete
tasks:trigger, tasks:view
users:read, users:update, users:manage_roles
```

**Role → Permission Mapping**:

| Role | Permissions |
|------|------------|
| `owner` | All 8 permissions |
| `admin` | All 8 permissions |
| `user` | `storage:upload`, `storage:download`, `tasks:trigger`, `tasks:view`, `users:read` |

`resolve_permissions(roles, extra_permissions)`:
1. Collect all permissions from `ROLE_PERMISSIONS` for each role
2. Union with any directly-assigned `extra_permissions`
3. Deduplicate and sort
4. Called in `_build_token_data()` at token creation time

**Route Guards** (FastAPI `dependencies` parameter):

```python
# Storage routes
dependencies=[Depends(require_tenant()), Depends(require_permissions(["storage:upload"]))]

# Admin routes
dependencies=[Depends(require_tenant()), Depends(require_roles(["admin"]))]
```

Each guard is a dependency factory returning an async function that:
1. Receives `CurrentUser` (triggers full user lookup from DB)
2. Checks `user.roles` or `user.permissions`
3. Raises `ForbiddenException` on failure

**Tenant Scoping**: Admin endpoints verify `target_user.tenant_id == current_user.tenant_id` to prevent cross-tenant role management.

#### 3.1.7 Admin Endpoints

**GET `/api/v1/admin/users`**:
- Guards: `require_tenant()`, `require_roles(["admin"])`
- Query: `User.find(User.tenant_id == current_user.tenant_id)`
- Returns: List of `TenantUserResponse` (id, email, display_name, roles, is_active)

**PUT `/api/v1/admin/users/{user_id}/roles`**:
- Guards: `require_tenant()`, `require_roles(["admin"])`, `require_permissions(["users:manage_roles"])`
- Validation:
  - Target user exists
  - Target user is in same tenant
  - Requested roles are in `ASSIGNABLE_ROLES` (`{"user", "admin"}`)
  - `owner` role is preserved if already present (cannot be removed)
- Updates `user.roles` and saves
- Emits audit log: `user.roles_updated`

---

### 3.2 Storage Module

#### 3.2.1 Data Model

**FileMetadata** (`app/modules/storage/models.py`) — Pydantic BaseModel (not Beanie), stored via Motor in per-tenant database:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `Optional[str]` | MongoDB `_id` as string |
| `tenant_id` | `str` | Owning tenant |
| `filename` | `str` | Original filename |
| `s3_key` | `str` | Full S3 object key |
| `content_type` | `str` | MIME type |
| `size_bytes` | `Optional[int]` | File size (set on confirm) |
| `uploaded_by` | `str` | User ID |
| `description` | `Optional[str]` | User-provided description |
| `is_uploaded` | `bool` | `False` until confirmed |
| `created_at` | `datetime` | Auto-set |
| `updated_at` | `datetime` | Auto-set |

Motor helpers: `to_doc()` converts to MongoDB dict (excludes `id`), `from_doc()` converts back (maps `_id` → `id`).

MongoDB collection: `file_metadata` in tenant database.
Indexes: `s3_key` (unique), `uploaded_by` (created lazily by `TenantDatabaseManager`).

#### 3.2.2 StorageService

```python
class StorageService:
    __init__():
        # boto3 S3 client with s3v4 signature
        # Presigned URL expiry from settings

    _get_bucket() → str:
        # Returns get_tenant_ctx().s3_bucket

    _get_collection() → AsyncIOMotorCollection:
        # Returns get_tenant_collection("file_metadata")

    generate_upload_url(request, user_id):
        # 1. Validate content_type against ALLOWED_CONTENT_TYPES
        # 2. Build S3 key: {s3_app_prefix}/uploads/{tenant_id}/{user_id}/{uuid}/{filename}
        # 3. Generate presigned PUT URL
        # 4. Insert FileMetadata doc (is_uploaded=False)
        # 5. Audit log: file.upload_url_generated
        # 6. Return: upload_url, s3_key, file_id, expires_in

    confirm_upload(file_id, user_id, size_bytes):
        # 1. Find doc by _id, verify uploaded_by matches
        # 2. Update: is_uploaded=True, size_bytes, updated_at
        # 3. Return FileMetadata

    generate_download_url(file_id, user_id):
        # 1. Find doc by _id, verify uploaded_by matches
        # 2. Verify is_uploaded=True
        # 3. Generate presigned GET URL
        # 4. Audit log: file.download_url_generated
        # 5. Return: download_url, filename, expires_in
```

S3 key structure: `{s3_app_prefix}/uploads/{tenant_id}/{user_id}/{uuid_hex}/{filename}`

---

### 3.3 Tasks Module

#### 3.3.1 Celery Configuration (`app/celery_app.py`)

| Setting | Value | Purpose |
|---------|-------|---------|
| `broker` | Redis (default) or RabbitMQ | Message transport |
| `backend` | MongoDB | Result storage |
| `task_serializer` | JSON | Serialization format |
| `task_track_started` | `True` | Enable STARTED state |
| `task_acks_late` | `True` | Ack after execution (at-least-once) |
| `worker_prefetch_multiplier` | `1` | Fair task distribution |
| `visibility_timeout` | 3600s | Requeue unacked tasks after 1 hour |

Worker process init: configures Loguru logging per child process.

#### 3.3.2 Task Whitelisting

```python
ALLOWED_TASKS = {
    "tasks.example_long_running",
    "tasks.send_notification",
}
```

`TaskService.trigger_task()` rejects any task name not in this set (raises `BadRequestException`).

#### 3.3.3 TaskService

```python
class TaskService:
    trigger_task(task_name, kwargs):
        # 1. Validate task_name in ALLOWED_TASKS
        # 2. Inject tenant_id from get_tenant_ctx()
        # 3. celery_app.send_task(task_name, kwargs=task_kwargs)
        # 4. Return result.id

    get_task_status(task_id):
        # 1. AsyncResult(task_id, app=celery_app)
        # 2. Map status → TaskStatusResponse fields:
        #    PROGRESS → .progress = result.info
        #    SUCCESS  → .result = result.result
        #    FAILURE  → .error = str(result.result)

    stream_task_status(task_id, poll_interval=1.0):
        # Async generator yielding SSE events:
        # 1. Poll AsyncResult every poll_interval seconds
        # 2. Only emit when status or progress changes
        # 3. Event format: "event: task_update\ndata: {json}\n\n"
        # 4. On terminal state (SUCCESS/FAILURE/REVOKED):
        #    emit "event: task_complete\ndata: {json}\n\n" and return
```

#### 3.3.4 SSE Stream Endpoint

```python
GET /api/v1/tasks/stream/{task_id}?token=<optional>
```

Authentication:
1. Try `request.state.user` (set by JWTSessionMiddleware from Bearer header)
2. Fall back to `?token=` query parameter (decoded inline via `decode_access_token`)
3. Reject if neither provides valid payload
4. Check `tenant_id` in payload, reject with 403 if missing

Response: `StreamingResponse` with `media_type="text/event-stream"` and headers:
- `Cache-Control: no-cache`
- `Connection: keep-alive`
- `X-Accel-Buffering: no` (nginx proxy support)

#### 3.3.5 Worker Task Example

```python
@celery_app.task(bind=True, name="tasks.example_long_running")
def example_long_running_task(self, duration=10, data=None, tenant_id=None):
    for i in range(duration):
        time.sleep(1)
        self.update_state(
            state="PROGRESS",
            meta={"current": i + 1, "total": duration, "percent": int((i + 1) / duration * 100)}
        )
    return {"status": "completed", "duration": duration, "tenant_id": tenant_id, "data": data}
```

State transitions: `PENDING → STARTED → PROGRESS (repeated) → SUCCESS | FAILURE`

---

### 3.4 Multi-Tenancy Module

#### 3.4.1 TenantContext (`app/tenant.py`)

```python
@dataclass
class TenantContext:
    tenant_id: str                    # Tenant identifier
    db: AsyncIOMotorDatabase          # Motor database for this tenant
    s3_bucket: str                    # S3 bucket name for this tenant

_tenant_ctx: ContextVar[Optional[TenantContext]]  # Per-request, per-asyncio-task
```

Access pattern:
- `get_tenant_ctx()` — returns current context or raises `ForbiddenException`
- `set_tenant_ctx(ctx)` — called by middleware
- `get_tenant_collection(name)` — shortcut for `get_tenant_ctx().db[name]`

#### 3.4.2 TenantDatabaseManager

```python
class TenantDatabaseManager:
    __init__(client: AsyncIOMotorClient, settings: Settings)
    _indexed_tenants: set[str]       # In-memory set of tenants with indexes created

    get_tenant_db(tenant_id) → AsyncIOMotorDatabase:
        # Returns client[f"{tenant_db_prefix}_{tenant_id}"]

    get_tenant_bucket(tenant_id, override=None) → str:
        # Returns override or f"{s3_bucket_prefix}-{tenant_id}"

    ensure_indexes(tenant_id):
        # Idempotent. On first call per tenant per process:
        #   file_metadata: create_index("s3_key", unique=True)
        #   file_metadata: create_index("uploaded_by")
        # Tracked in _indexed_tenants set
```

#### 3.4.3 TenantContextMiddleware Flow

```
1. Check exemptions (paths + prefixes)
2. Read request.state.user → tenant_id
3. Cache lookup: Redis key "tenant:{tenant_id}"
4. Cache miss: Tenant.find_one(tenant_id=...) → cache for 300s
5. Build TenantContext(tenant_id, db, s3_bucket)
6. set_tenant_ctx(ctx)
7. ensure_indexes(tenant_id) (no-op if already done)
8. Continue to route handler
```

---

### 3.5 Common Infrastructure

#### 3.5.1 Error Handling (`app/common/error_handlers.py`)

Three-layer exception handling registered on the FastAPI app:

| Handler | Trigger | Status | Response Body |
|---------|---------|--------|--------------|
| `AppException` | Any custom exception | Exception's `status_code` | `{"error": {"code": "...", "message": "..."}}` |
| `RequestValidationError` | Pydantic validation failure | 422 | `{"error": {"code": "VALIDATION_ERROR", "details": [...]}}` |
| `Exception` (catch-all) | Unhandled exceptions | 500 | `{"error": {"code": "INTERNAL_ERROR", "message": "An unexpected error occurred"}}` |

Exception hierarchy:

```
AppException (500, INTERNAL_ERROR)
  ├── NotFoundException (404, NOT_FOUND)
  ├── UnauthorizedException (401, UNAUTHORIZED)
  ├── ForbiddenException (403, FORBIDDEN)
  ├── BadRequestException (400, BAD_REQUEST)
  └── ConflictException (409, CONFLICT)
```

#### 3.5.2 Caching (`app/common/cache.py`)

**CacheService** — static methods wrapping Redis operations:

| Method | Operation |
|--------|-----------|
| `get(key)` | Redis GET |
| `set(key, value, ttl=300)` | Redis SET EX |
| `delete(key)` | Redis DEL |
| `get_json(key)` | GET + `json.loads` |
| `set_json(key, value, ttl=300)` | `json.dumps` + SET EX |

**`@cached(prefix, ttl)` decorator**:
- Generates cache key from `prefix` + `md5(args + kwargs)`
- Redis key format: `cache:{prefix}:{md5_hex}`
- Returns cached result on hit, executes function on miss

#### 3.5.3 Audit Logging (`app/common/audit.py`)

```python
audit_log(
    action="user.login",         # Dot-namespaced action identifier
    actor_id="user_id",          # Who performed the action
    tenant_id="tenant_id",       # Tenant context
    resource_type="user",        # Resource type affected
    resource_id="user_id",       # Resource ID affected
    details={"provider": "ms"},  # Additional context
    ip_address="1.2.3.4"         # Client IP
)
```

Emits via `logger.bind(audit=True, ...)`. In production, can be filtered/routed to a dedicated audit store using the `audit=True` extra field.

Audited operations:
- `user.login`, `user.logout`
- `tenant.provisioned`
- `user.roles_updated`
- `file.upload_url_generated`, `file.download_url_generated`

#### 3.5.4 Rate Limiting (`app/middleware/rate_limit.py`)

Algorithm: Fixed-window counter via Redis `INCR` + `EXPIRE(NX)`.

```
Key format:   ratelimit:{identifier}
Identifier:   "user:{sub}" (authenticated) or "ip:{client_host}" (anonymous)
Window:       RATE_LIMIT_WINDOW_SECONDS (default 60)
Limits:       RATE_LIMIT_AUTHENTICATED (200) / RATE_LIMIT_ANONYMOUS (50)
```

Pipeline per request:
1. `INCR key` → current count
2. `EXPIRE key window NX` → set TTL only if key is new (preserves existing window)

If count exceeds limit: return 429 with `{"error": {"code": "RATE_LIMITED", ...}}`.

Response headers on every request:
- `X-RateLimit-Limit: {max_requests}`
- `X-RateLimit-Remaining: {max(0, max_requests - current_count)}`
- `X-RateLimit-Window: {window}`

Failure mode: If Redis is unavailable, requests pass through (fail open).

Exempt paths: `/health`, `/readiness`, `/metrics`, `/docs`, `/redoc`, `/openapi.json`

---

### 3.6 Observability

#### 3.6.1 OpenTelemetry (`app/telemetry.py`)

**TracerProvider**:
- Resource: `service.name`, `service.version`, `deployment.environment`
- Exporter: OTLP gRPC (if `OTEL_EXPORTER_OTLP_ENDPOINT` set), Console (debug mode)
- Processor: `BatchSpanProcessor`

**MeterProvider**:
- Reader: `PrometheusMetricReader` → `prometheus_client.REGISTRY`
- Endpoint: `/metrics` (Starlette Route, mounted directly on app)

**Auto-instrumentation** (providers passed explicitly):
- `FastAPIInstrumentor` (excluded: health, readiness, metrics, docs, redoc, openapi.json)
- `CeleryInstrumentor`
- `RedisInstrumentor`
- `PymongoInstrumentor`

#### 3.6.2 Logging (`app/logging_config.py`)

**Loguru configuration**:
- Context patcher injects `request_id`, `trace_id`, `span_id`, `user_id` into every record
- Development format: colored, human-readable with request_id and trace_id
- Production format (`LOG_JSON=true`): Single-line JSON with all context fields

**stdlib interception**:
- `InterceptHandler` routes all Python `logging` records through Loguru
- Overrides: uvicorn, celery, motor, pymongo, boto3, botocore

**ContextVars** (set per-request by middleware):

| Var | Set By | Purpose |
|-----|--------|---------|
| `request_id_ctx` | RequestIDMiddleware | Correlate logs to request |
| `trace_id_ctx` | RequestIDMiddleware | OTel trace correlation |
| `span_id_ctx` | RequestIDMiddleware | OTel span correlation |
| `user_id_ctx` | JWTSessionMiddleware | Identify acting user |

---

## 4. Database Schema

### 4.1 Shared Database (`platform_backend`)

**Collection: `users`**

```json
{
  "_id": ObjectId,
  "email": "user@corp.com",          // unique index
  "display_name": "Jane Doe",
  "provider": "microsoft",
  "provider_user_id": "oid-from-azure",
  "tenant_id": "azure-tid-guid",
  "roles": ["owner", "user"],
  "permissions": [],
  "avatar_url": "https://...",
  "is_active": true,
  "last_login": "2025-01-15T10:30:00Z",
  "created_at": ISODate,
  "updated_at": ISODate
}
```

**Collection: `tenants`**

```json
{
  "_id": ObjectId,
  "tenant_id": "azure-tid-guid",     // unique index
  "name": "Acme Corp",
  "is_active": true,
  "s3_bucket_name": null,            // null = use default naming
  "db_name": null,                   // null = use default naming
  "created_at": ISODate,
  "updated_at": ISODate
}
```

### 4.2 Per-Tenant Database (`platform_tenant_{tenant_id}`)

**Collection: `file_metadata`**

```json
{
  "_id": ObjectId,
  "tenant_id": "azure-tid-guid",
  "filename": "report.pdf",
  "s3_key": "app-prefix/uploads/tid/uid/hex/report.pdf",  // unique index
  "content_type": "application/pdf",
  "size_bytes": 1048576,
  "uploaded_by": "user-object-id",              // index
  "description": "Q4 report",
  "is_uploaded": true,
  "created_at": ISODate,
  "updated_at": ISODate
}
```

### 4.3 Celery Results Database (`celery_results`)

**Collection: `celery_taskmeta`** (managed by Celery MongoDB backend)

```json
{
  "_id": "celery-task-uuid",
  "status": "SUCCESS",
  "result": {"status": "completed", "...": "..."},
  "traceback": null,
  "date_done": ISODate
}
```

---

## 5. Redis Key Patterns

| Key Pattern | Purpose | TTL |
|-------------|---------|-----|
| `token_blacklist:{jti}` | Revoked JWT tracking | Remaining token lifetime |
| `ratelimit:user:{sub}` | Per-user request counter | `RATE_LIMIT_WINDOW_SECONDS` |
| `ratelimit:ip:{host}` | Per-IP request counter | `RATE_LIMIT_WINDOW_SECONDS` |
| `tenant:{tenant_id}` | Cached tenant metadata | 300s |
| `msal_flow:{state}` | MSAL auth code flow state | 600s |
| `cache:{prefix}:{md5}` | Generic application cache | Configurable (default 300s) |

---

## 6. API Contracts

### 6.1 Error Response Format (all endpoints)

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found"
  }
}
```

Validation errors include `details`:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {"field": "body.email", "message": "value is not a valid email address"}
    ]
  }
}
```

### 6.2 Auth Endpoints

**POST `/api/v1/auth/login`**

Request: `{"provider": "microsoft", "redirect_url": "https://app.example.com/dashboard"}`

Response: `{"login_url": "https://login.microsoftonline.com/..."}`

**GET `/api/v1/auth/callback/{provider}?code=...&state=...`**

Response:
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "token_type": "bearer",
  "expires_in": 1800
}
```

**POST `/api/v1/auth/refresh`**

Request: `{"refresh_token": "eyJ..."}`

Response: Same as callback.

**POST `/api/v1/auth/logout`**

Response: `{"message": "Logged out successfully", "provider_logout_url": "https://..."}`

**GET `/api/v1/auth/me`**

Response:
```json
{
  "id": "...",
  "email": "user@corp.com",
  "display_name": "Jane Doe",
  "provider": "microsoft",
  "tenant_id": "...",
  "roles": ["owner", "user"],
  "permissions": ["storage:upload", "storage:download", "..."],
  "avatar_url": "...",
  "is_active": true
}
```

### 6.3 Admin Endpoints

**GET `/api/v1/admin/users`**

Response:
```json
[
  {"id": "...", "email": "user@corp.com", "display_name": "Jane", "roles": ["admin", "user"], "is_active": true}
]
```

**PUT `/api/v1/admin/users/{user_id}/roles`**

Request: `{"roles": ["admin", "user"]}`

Response:
```json
{"id": "...", "email": "user@corp.com", "roles": ["admin", "user"], "message": "Roles updated successfully"}
```

### 6.4 Storage Endpoints

**POST `/api/v1/storage/upload-url`**

Request: `{"filename": "report.pdf", "content_type": "application/pdf", "description": "Q4"}`

Response:
```json
{
  "upload_url": "https://s3.amazonaws.com/...",
  "s3_key": "app-prefix/uploads/tid/uid/hex/report.pdf",
  "file_id": "...",
  "expires_in": 3600
}
```

**POST `/api/v1/storage/confirm-upload/{file_id}`**

Request: `{"size_bytes": 1048576}`

Response:
```json
{
  "id": "...", "filename": "report.pdf", "s3_key": "...", "content_type": "application/pdf",
  "size_bytes": 1048576, "uploaded_by": "...", "description": "Q4",
  "is_uploaded": true, "created_at": "..."
}
```

**GET `/api/v1/storage/download-url/{file_id}`**

Response: `{"download_url": "https://s3.amazonaws.com/...", "filename": "report.pdf", "expires_in": 3600}`

### 6.5 Task Endpoints

**POST `/api/v1/tasks/trigger`**

Request: `{"task_name": "tasks.example_long_running", "kwargs": {"duration": 30}}`

Response: `{"task_id": "celery-uuid", "message": "Task 'tasks.example_long_running' queued"}`

**GET `/api/v1/tasks/status/{task_id}`**

Response (in progress):
```json
{"task_id": "...", "status": "PROGRESS", "progress": {"current": 5, "total": 30, "percent": 16}, "result": null, "error": null}
```

**GET `/api/v1/tasks/stream/{task_id}`** (SSE)

```
event: task_update
data: {"task_id": "...", "status": "PROGRESS", "progress": {"current": 5, "total": 30, "percent": 16}}

event: task_update
data: {"task_id": "...", "status": "PROGRESS", "progress": {"current": 6, "total": 30, "percent": 20}}

event: task_complete
data: {"task_id": "...", "status": "SUCCESS", "result": {"status": "completed", "duration": 30}}
```

---

## 7. Configuration Reference

All settings in `app/config.py` via `pydantic-settings` (env vars + `.env` file):

| Setting | Env Var | Type | Default |
|---------|---------|------|---------|
| `app_name` | `APP_NAME` | `str` | `"platform-backend-kit"` |
| `app_env` | `APP_ENV` | `Literal["development","staging","production"]` | `"development"` |
| `debug` | `DEBUG` | `bool` | `False` |
| `secret_key` | `SECRET_KEY` | `str` | `"change-me-in-production"` |
| `api_v1_prefix` | `API_V1_PREFIX` | `str` | `"/api/v1"` |
| `mongodb_url` | `MONGODB_URL` | `str` | `"mongodb://localhost:27017"` |
| `mongodb_db_name` | `MONGODB_DB_NAME` | `str` | `"platform_backend"` |
| `redis_url` | `REDIS_URL` | `str` | `"redis://localhost:6379/0"` |
| `celery_broker_url` | `CELERY_BROKER_URL` | `str` | `"redis://localhost:6379/1"` |
| `celery_result_backend` | `CELERY_RESULT_BACKEND` | `str` | `"mongodb://localhost:27017"` |
| `celery_result_db_name` | `CELERY_RESULT_DB_NAME` | `str` | `"celery_results"` |
| `jwt_secret_key` | `JWT_SECRET_KEY` | `str` | `"change-me-jwt-secret"` |
| `jwt_algorithm` | `JWT_ALGORITHM` | `str` | `"HS256"` |
| `jwt_access_token_expire_minutes` | `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | `int` | `30` |
| `jwt_refresh_token_expire_days` | `JWT_REFRESH_TOKEN_EXPIRE_DAYS` | `int` | `7` |
| `jwt_issuer` | `JWT_ISSUER` | `str` | `"platform-backend-kit"` |
| `jwt_audience` | `JWT_AUDIENCE` | `str` | `"platform-backend-kit"` |
| `msal_client_id` | `MSAL_CLIENT_ID` | `str` | `""` |
| `msal_client_secret` | `MSAL_CLIENT_SECRET` | `str` | `""` |
| `msal_tenant_id` | `MSAL_TENANT_ID` | `str` | `""` |
| `msal_authority` | `MSAL_AUTHORITY` | `str` | `"https://login.microsoftonline.com/{tenant_id}"` |
| `msal_redirect_uri` | `MSAL_REDIRECT_URI` | `str` | `"http://localhost:8000/api/v1/auth/callback/microsoft"` |
| `msal_scopes` | `MSAL_SCOPES` | `str` | `"User.Read"` |
| `saml_sp_entity_id` | `SAML_SP_ENTITY_ID` | `str` | `""` |
| `saml_sp_acs_url` | `SAML_SP_ACS_URL` | `str` | `""` |
| `saml_idp_metadata_url` | `SAML_IDP_METADATA_URL` | `str` | `""` |
| `saml_idp_sso_url` | `SAML_IDP_SSO_URL` | `str` | `""` |
| `saml_idp_cert_file` | `SAML_IDP_CERT_FILE` | `str` | `""` |
| `otel_service_name` | `OTEL_SERVICE_NAME` | `str` | `"platform-backend-kit"` |
| `otel_exporter_otlp_endpoint` | `OTEL_EXPORTER_OTLP_ENDPOINT` | `str` | `""` |
| `otel_enabled` | `OTEL_ENABLED` | `bool` | `True` |
| `prometheus_enabled` | `PROMETHEUS_ENABLED` | `bool` | `True` |
| `log_level` | `LOG_LEVEL` | `str` | `"INFO"` |
| `log_json` | `LOG_JSON` | `bool` | `False` |
| `s3_bucket_prefix` | `S3_BUCKET_PREFIX` | `str` | `"platform"` |
| `tenant_db_prefix` | `TENANT_DB_PREFIX` | `str` | `"platform_tenant"` |
| `aws_access_key_id` | `AWS_ACCESS_KEY_ID` | `str` | `""` |
| `aws_secret_access_key` | `AWS_SECRET_ACCESS_KEY` | `str` | `""` |
| `aws_region` | `AWS_REGION` | `str` | `"us-east-1"` |
| `s3_bucket_name` | `S3_BUCKET_NAME` | `str` | `"workflow-builder-platform-backend-uploads"` |
| `s3_app_prefix` | `S3_APP_PREFIX` | `str` | `""` |
| `s3_presigned_url_expiry` | `S3_PRESIGNED_URL_EXPIRY` | `int` | `3600` |
| `cors_allowed_origins` | `CORS_ALLOWED_ORIGINS` | `str` | `""` |
| `rate_limit_authenticated` | `RATE_LIMIT_AUTHENTICATED` | `int` | `200` |
| `rate_limit_anonymous` | `RATE_LIMIT_ANONYMOUS` | `int` | `50` |
| `rate_limit_window_seconds` | `RATE_LIMIT_WINDOW_SECONDS` | `int` | `60` |

---

## 8. Docker Configuration

### 8.1 Multi-Stage Dockerfile

```
Stage 1 (builder): python:3.11-slim
  - Install build deps (build-essential, libxmlsec1-dev for pysaml2)
  - Create venv, pip install project

Stage 2 (runtime): python:3.11-slim
  - Install runtime deps (libxmlsec1)
  - Non-root user (appuser)
  - Copy venv + app code
  - Healthcheck: httpx GET /health
  - CMD: uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 8.2 Docker Compose Services

| Service | Image | Ports | Purpose |
|---------|-------|-------|---------|
| `app` | Build from Dockerfile | 8000 | FastAPI server (uvicorn --reload) |
| `celery_worker` | Build from Dockerfile | — | Celery worker |
| `mongodb` | mongo:7 | 27017 | Database |
| `redis` | redis:7-alpine | 6379 | Cache + broker |
| `rabbitmq` | rabbitmq:3-management-alpine | 5672, 15672 | Alternative broker |

Volume: `mongo_data` for MongoDB persistence.
