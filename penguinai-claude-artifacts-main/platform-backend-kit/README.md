# platform-backend-kit

Production-ready, multi-tenant FastAPI backend starter kit with enterprise SaaS features built in.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | FastAPI (Python 3.11+) |
| Database | MongoDB / AWS DocumentDB (Motor + Beanie) |
| Cache | Redis (hiredis) |
| Task Queue | Celery (Redis or RabbitMQ broker) |
| Auth | Microsoft OAuth2 (MSAL), SAML2, JWT (PyJWT) |
| Storage | AWS S3 (presigned URLs) |
| Observability | OpenTelemetry + Prometheus + Loguru |
| Containerization | Docker, Docker Compose |
| Linting | ruff (lint + format), mypy (type checking) |
| CI/CD | GitHub Actions |

## Features

- **Multi-Tenant Isolation** -- Database-per-tenant and S3-bucket-per-tenant. Shared models (User, Tenant) in a single DB; tenant-scoped data in isolated databases via Motor collections.
- **Authentication** -- Microsoft OAuth2 and SAML2 providers with pluggable provider factory. SaaS-compliant JWT tokens with issuer/audience validation, jti-based blacklisting on logout.
- **RBAC** -- Role-based access control with `owner`, `admin`, and `user` roles. Permissions follow `resource:action` pattern (e.g. `storage:upload`, `tasks:trigger`). Role-to-permission mappings resolved at token creation time. Admin endpoints for tenant-scoped user/role management.
- **S3 File Storage** -- Presigned upload/download URLs, per-tenant bucket isolation, upload confirmation flow with metadata tracking. Filenames sanitized against path traversal.
- **Async Task Processing** -- Celery workers with Redis/RabbitMQ broker, MongoDB result backend. SSE (Server-Sent Events) for real-time task progress streaming. Task ownership verification ensures cross-tenant isolation. Idempotency key support on trigger to prevent duplicates.
- **Rate Limiting** -- Redis sliding-window rate limiter. Per-user limits for authenticated requests, per-IP for anonymous. Stricter limits on auth-sensitive endpoints (login, refresh, callback). Configurable via environment variables.
- **Security Headers** -- HSTS (production), X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy, Cache-Control.
- **Production Config Validation** -- Fail-fast on default secrets, missing credentials, or misconfigured CORS in production mode.
- **Observability** -- OpenTelemetry tracing (OTLP export), Prometheus metrics at `/metrics`, structured JSON logging with request ID and trace correlation.
- **Health Checks** -- Liveness (`/health`) and readiness (`/readiness`) probes checking MongoDB, Redis, and S3 connectivity. Error details redacted in production.
- **Global Error Handling** -- Centralized exception handlers for application errors, validation errors, and unhandled exceptions.
- **Audit Logging** -- Structured audit events for sensitive operations (login, logout, file access, role changes, tenant provisioning).

## Project Structure

```
app/
├── main.py                 # FastAPI app factory, middleware stack, router mounting
├── config.py               # Pydantic settings (env vars) + production validation
├── database.py             # MongoDB/Beanie init, Motor client (pooled + timeouts)
├── redis.py                # Redis connection (pooled + timeouts)
├── celery_app.py           # Celery configuration (result expiry 24h)
├── tenant.py               # TenantContext (contextvar), TenantDatabaseManager (bounded cache)
├── telemetry.py            # OpenTelemetry + Prometheus setup
├── logging_config.py       # Loguru configuration, stdlib interception
├── common/
│   ├── audit.py            # Structured audit logging
│   ├── cache.py            # Redis cache service
│   ├── error_handlers.py   # Global exception handlers
│   ├── exceptions.py       # Custom HTTP exceptions
│   ├── models.py           # Base document model
│   └── schemas.py          # Shared schemas (pagination, errors)
├── middleware/
│   ├── auth.py             # JWT extraction + token blacklist check
│   ├── cors.py             # CORS from env config
│   ├── logging.py          # Request/response logging
│   ├── rate_limit.py       # Redis sliding-window rate limiter + auth endpoint hardening
│   ├── request_id.py       # X-Request-ID propagation
│   ├── security.py         # Security response headers
│   └── tenant.py           # Tenant context resolution from JWT
├── modules/
│   ├── auth/
│   │   ├── routes.py       # Login, callback, refresh, logout, /me
│   │   ├── admin_routes.py # GET /admin/users (paginated), PUT /admin/users/{id}/roles
│   │   ├── service.py      # Auth flow, tenant auto-provisioning
│   │   ├── jwt.py          # Token create/decode (PyJWT), blacklist
│   │   ├── rbac.py         # Permission constants, role mappings
│   │   ├── dependencies.py # CurrentUser, require_roles, require_permissions, require_tenant
│   │   ├── models.py       # User (Beanie document, indexed tenant_id)
│   │   ├── tenant_model.py # Tenant (Beanie document)
│   │   ├── schemas.py      # Auth request/response schemas
│   │   ├── admin_schemas.py
│   │   └── providers/      # Microsoft (state-secured), SAML provider implementations
│   ├── storage/
│   │   ├── routes.py       # Upload URL, confirm upload, download URL
│   │   ├── service.py      # S3 + Motor operations (tenant-aware, filename sanitized)
│   │   ├── models.py       # FileMetadata (Pydantic + Motor)
│   │   └── schemas.py
│   ├── tasks/
│   │   ├── routes.py       # Trigger (idempotent), status, SSE stream
│   │   ├── service.py      # Celery dispatch, ownership verification, SSE generator
│   │   ├── schemas.py
│   │   └── workers/        # Celery task definitions
│   └── health/
│       └── routes.py       # /health, /readiness (MongoDB + Redis + S3)
└── tests/
    ├── conftest.py
    ├── test_auth/
    ├── test_health.py
    ├── test_storage/
    └── test_tasks/
```

## Getting Started

### Prerequisites

- Python 3.11+
- Docker and Docker Compose (for local infrastructure)

### Setup

```bash
# Clone and enter the project
cd platform-backend-kit

# Copy environment config
cp .env.example .env

# Start infrastructure (MongoDB, Redis, RabbitMQ)
docker compose up -d mongodb redis rabbitmq

# Install dependencies
make dev
# or: pip install -e ".[dev]"

# Run the API server
make run
# or: uvicorn app.main:app --reload --port 8000

# Run a Celery worker (separate terminal)
make worker
# or: celery -A app.celery_app worker --loglevel=info
```

### Docker

```bash
# Run everything
docker compose up --build

# API at http://localhost:8000
# API docs at http://localhost:8000/docs (debug mode only)
# Scalar docs at http://localhost:8000/scalar (debug mode only)
# RabbitMQ management at http://localhost:15672
```

### Makefile Commands

```bash
make install    # Install production dependencies
make dev        # Install with dev dependencies
make lock       # Generate locked requirements from pyproject.toml
make lint       # Run ruff linter
make format     # Format with ruff + auto-fix
make typecheck  # Run mypy type checker
make test       # Run pytest
make run        # Start dev server
make worker     # Start Celery worker
```

## API Endpoints

### Auth (`/api/v1/auth`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/login` | Initiate OAuth login | None |
| GET | `/login/{provider}` | Browser redirect login | None |
| GET/POST | `/callback/{provider}` | OAuth callback | None |
| POST | `/refresh` | Refresh access token | None |
| POST | `/logout` | Logout (blacklists token) | Required |
| GET | `/me` | Current user profile | Required |

### Admin (`/api/v1/admin`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/users?skip=0&limit=50` | List users in your tenant (paginated) | Admin |
| PUT | `/users/{id}/roles` | Update user roles | Admin + `users:manage_roles` |

### Storage (`/api/v1/storage`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/upload-url` | Get presigned upload URL | Tenant + `storage:upload` |
| POST | `/confirm-upload/{id}` | Confirm upload complete | Tenant + `storage:upload` |
| GET | `/download-url/{id}` | Get presigned download URL | Tenant + `storage:download` |

### Tasks (`/api/v1/tasks`)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/trigger` | Queue a task (supports `Idempotency-Key` header) | Tenant + `tasks:trigger` |
| GET | `/status/{id}` | Get task status (tenant-verified) | Tenant + `tasks:view` |
| GET | `/stream/{id}` | SSE task progress stream | Tenant (header or `?token=`) |

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness check |
| GET | `/readiness` | Readiness check (MongoDB + Redis + S3) |
| GET | `/metrics` | Prometheus metrics |

## RBAC

### Roles

| Role | Description | Assignment |
|------|-------------|------------|
| `owner` | Full access, tenant owner | Auto-assigned to first user in a new tenant |
| `admin` | Manages users and resources within the tenant | Assigned via admin API |
| `user` | Standard access | Default for all new users |

### Permissions

| Permission | owner | admin | user |
|-----------|-------|-------|------|
| `storage:upload` | Y | Y | Y |
| `storage:download` | Y | Y | Y |
| `storage:delete` | Y | Y | - |
| `tasks:trigger` | Y | Y | Y |
| `tasks:view` | Y | Y | Y |
| `users:read` | Y | Y | Y |
| `users:update` | Y | Y | - |
| `users:manage_roles` | Y | Y | - |

Permissions are resolved from roles at token creation time. Revoking a role takes effect on the next token refresh.

## Multi-Tenancy

Each tenant gets:
- **Own database** -- `{TENANT_DB_PREFIX}_{tenant_id}` (e.g. `platform_tenant_abc123`)
- **Own S3 bucket** -- `{S3_BUCKET_PREFIX}-{tenant_id}` (e.g. `platform-abc123`)

Tenant context is resolved per-request from the JWT `tenant_id` claim and injected via contextvar. Shared data (users, tenant registry) stays in the shared database. The tenant index cache is bounded at 10,000 entries to prevent unbounded memory growth.

## Middleware Stack

Executed in this order per request:

1. **CORS** -- Origin validation
2. **JWT Session** -- Extracts and validates Bearer token, sets `request.state.user`
3. **Tenant Context** -- Resolves tenant DB + S3 bucket from JWT claims
4. **Rate Limiter** -- Sliding-window per-user/per-IP rate limiting (stricter on auth endpoints)
5. **Logging** -- Request/response logging with timing
6. **Request ID** -- Generates/propagates `X-Request-ID`
7. **Security Headers** -- Sets security response headers

## Security

- **Production config validation** -- App fails to start if default secrets (`change-me-*`) are used, or if `MSAL_CLIENT_ID`, `AWS_ACCESS_KEY_ID`, or `CORS_ALLOWED_ORIGINS` are missing in production mode.
- **JWT library** -- Uses PyJWT (actively maintained) instead of python-jose (unmaintained, known CVEs).
- **MSAL state parameter** -- Random UUID state prevents open redirect attacks via the OAuth callback.
- **Filename sanitization** -- Uploaded filenames are sanitized (`[^\w.\-]` replaced with `_`) to prevent path traversal in S3 keys.
- **Task ownership** -- Task-to-tenant mapping stored in Redis; status/stream endpoints verify the requesting tenant owns the task.
- **Double-confirmation guard** -- Upload confirmation rejects duplicate calls with `409 Conflict`.
- **Idempotency** -- Task trigger endpoint accepts an `Idempotency-Key` header to prevent duplicate dispatch (5-min Redis cache).
- **Connection hardening** -- MongoDB and Redis configured with explicit pool sizes (50), connect timeouts (5s), and socket timeouts (30s).
- **Celery result expiry** -- Task results auto-expire after 24 hours to prevent unbounded storage growth.
- **Auth rate limiting** -- Login, refresh, and callback endpoints are capped at 10 requests per window to resist brute force.
- **Error redaction** -- Health check error details are hidden in production to prevent infrastructure information leakage.

## Configuration

All configuration is via environment variables. See [.env.example](.env.example) for the full list.

Key settings:

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_ENV` | `development`, `staging`, `production` | `development` |
| `SECRET_KEY` | Application secret (must change in production) | `change-me-in-production` |
| `MONGODB_URL` | MongoDB connection string | `mongodb://localhost:27017` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379/0` |
| `CELERY_BROKER_URL` | Celery broker (Redis or AMQP) | `redis://localhost:6379/1` |
| `JWT_SECRET_KEY` | JWT signing key (must change in production) | `change-me-jwt-secret` |
| `S3_BUCKET_PREFIX` | Per-tenant S3 bucket prefix | `platform` |
| `TENANT_DB_PREFIX` | Per-tenant DB name prefix | `platform_tenant` |
| `RATE_LIMIT_AUTHENTICATED` | Max requests/window (authenticated) | `200` |
| `RATE_LIMIT_ANONYMOUS` | Max requests/window (anonymous) | `50` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins (required in production) | `` |
| `OTEL_ENABLED` | Enable OpenTelemetry | `true` |
| `PROMETHEUS_ENABLED` | Enable Prometheus /metrics | `true` |

## Development

### Code Quality

```bash
make lint       # ruff check (E, F, I, N, W, UP, B, S, A, C4, RUF)
make format     # ruff format + auto-fix
make typecheck  # mypy strict mode
```

### Pre-commit Hooks

```bash
pip install pre-commit
pre-commit install
```

Hooks run automatically on commit: ruff (lint + format), mypy, detect-secrets, trailing-whitespace, check-yaml.

### CI Pipeline

GitHub Actions runs on push/PR to `main`:
1. Install dependencies
2. `ruff check` + `ruff format --check`
3. `mypy` type checking
4. `pytest` with MongoDB + Redis services
5. Docker image build

### Testing

```bash
make test
# or: pytest app/tests/ -v
```

Tests use `mongomock-motor` and `fakeredis` for isolated testing without infrastructure dependencies.

### Dependency Locking

```bash
make lock
# Generates: requirements.lock, requirements-dev.lock
```

## License

Proprietary.
