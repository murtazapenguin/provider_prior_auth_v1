# High-Level Design (HLD)

## 1. Introduction

**platform-backend-kit** is a production-ready, multi-tenant backend platform built on FastAPI. It provides the foundational services that enterprise SaaS applications need: authentication, authorization, file storage, asynchronous task processing, and observability — all with tenant isolation at the database and storage layer.

### 1.1 Goals

- Provide a reusable backend starter for SaaS products with enterprise-grade security
- Enforce tenant isolation at every layer: database, storage, API access
- Support pluggable authentication (Microsoft OAuth2, SAML2, extensible)
- Deliver production observability out of the box (tracing, metrics, structured logging)
- Enable asynchronous workloads with real-time progress visibility

### 1.2 Non-Goals

- Frontend / UI implementation
- Billing, subscription, or payment processing
- Multi-region deployment orchestration (handled by infrastructure layer)

---

## 2. System Architecture

```
                          ┌──────────────┐
                          │   Clients    │
                          │  (Browser /  │
                          │   Mobile /   │
                          │   Service)   │
                          └──────┬───────┘
                                 │  HTTPS
                          ┌──────▼───────┐
                          │  Load        │
                          │  Balancer /  │
                          │  API Gateway │
                          └──────┬───────┘
                                 │
                     ┌───────────▼───────────┐
                     │   FastAPI Application  │
                     │                        │
                     │  ┌──────────────────┐  │
                     │  │  Middleware Stack │  │
                     │  │  (Security,      │  │
                     │  │   Auth, Tenant,  │  │
                     │  │   Rate Limit,    │  │
                     │  │   Logging)       │  │
                     │  └────────┬─────────┘  │
                     │           │             │
                     │  ┌────────▼─────────┐  │
                     │  │  Route Handlers   │  │
                     │  │  (Auth, Storage,  │  │
                     │  │   Tasks, Admin,   │  │
                     │  │   Health)         │  │
                     │  └────────┬─────────┘  │
                     │           │             │
                     │  ┌────────▼─────────┐  │
                     │  │  Service Layer    │  │
                     │  └────────┬─────────┘  │
                     └───────────┼───────────┘
                                 │
            ┌────────────┬───────┼───────┬────────────┐
            │            │       │       │            │
     ┌──────▼──────┐ ┌──▼───┐ ┌─▼──┐ ┌──▼───┐ ┌─────▼─────┐
     │  MongoDB     │ │Redis │ │ S3 │ │Celery│ │  OTLP     │
     │  (Shared +   │ │      │ │    │ │Worker│ │  Collector│
     │  Per-Tenant) │ │      │ │    │ │      │ │           │
     └─────────────┘ └──────┘ └────┘ └──────┘ └───────────┘
```

---

## 3. Component Overview

### 3.1 API Layer (FastAPI)

The application exposes a RESTful API organized into modules:

| Module | Prefix | Purpose |
|--------|--------|---------|
| **Auth** | `/api/v1/auth` | OAuth2/SAML login, token refresh, logout |
| **Admin** | `/api/v1/admin` | Tenant-scoped user and role management |
| **Storage** | `/api/v1/storage` | Presigned S3 upload/download URLs |
| **Tasks** | `/api/v1/tasks` | Async task triggering, status, SSE streaming |
| **Health** | `/health`, `/readiness` | Liveness and dependency health checks |

### 3.2 Middleware Stack

Middleware executes in a defined order for every request:

```
Request → CORS → JWT Auth → Tenant Context → Rate Limiter → Logging → Request ID → Security Headers → Response
```

| Middleware | Responsibility |
|-----------|---------------|
| CORS | Origin validation from configured allowlist |
| JWT Session | Extract Bearer token, decode, check blacklist, set `request.state.user` |
| Tenant Context | Resolve tenant DB and S3 bucket from JWT claims, set contextvar |
| Rate Limiter | Sliding-window rate limiting per-user or per-IP via Redis |
| Logging | Request/response logging with duration and user context |
| Request ID | Generate/propagate `X-Request-ID`, bind OTel trace IDs |
| Security Headers | HSTS, X-Frame-Options, CSP-adjacent headers |

### 3.3 Authentication

Pluggable provider architecture supporting:

- **Microsoft OAuth2 (MSAL)** — Authorization code flow with PKCE
- **SAML2 (pysaml2)** — SP-initiated SSO with POST binding
- **Extensible** — New providers implement the `AuthProvider` abstract base class and register via the factory

Tokens are SaaS-compliant JWTs with: `sub`, `email`, `tenant_id`, `roles`, `permissions`, `iss`, `aud`, `jti`, `iat`, `exp`.

### 3.4 Authorization (RBAC)

Three roles with permission mappings resolved at token creation:

| Role | Scope |
|------|-------|
| `owner` | All permissions. Auto-assigned to first user in a tenant. |
| `admin` | All resource permissions + user management within the tenant. |
| `user` | Standard read/write on storage and tasks. |

Route-level enforcement via FastAPI dependency injection: `require_tenant()`, `require_roles()`, `require_permissions()`.

### 3.5 Multi-Tenancy

**Database-per-tenant** isolation model:

| Data Type | Database | Access Pattern |
|-----------|----------|---------------|
| Shared (User, Tenant) | Single shared DB (`platform_backend`) | Beanie ODM |
| Tenant-scoped (FileMetadata, domain data) | Per-tenant DB (`platform_tenant_{id}`) | Motor collections directly |

**S3-bucket-per-tenant**: Each tenant's files go to `{prefix}-{tenant_id}`.

Tenant context is resolved per-request from the JWT `tenant_id` claim and injected into a `ContextVar`. All downstream services access the correct DB and bucket transparently.

### 3.6 File Storage

Presigned URL workflow (no file data passes through the API server):

```
Client → POST /upload-url → API returns presigned PUT URL + file_id
Client → PUT file to S3 (direct)
Client → POST /confirm-upload/{file_id} → API marks file as uploaded
Client → GET /download-url/{file_id} → API returns presigned GET URL
Client → GET file from S3 (direct)
```

### 3.7 Async Task Processing

```
Client → POST /tasks/trigger → Celery send_task → Redis/RabbitMQ broker
                                                          │
                                              ┌───────────▼───────────┐
                                              │    Celery Worker      │
                                              │  (executes task,      │
                                              │   updates PROGRESS)   │
                                              └───────────┬───────────┘
                                                          │
Client ← GET /tasks/stream/{id} ← SSE events ← API polls AsyncResult
```

- Tasks are whitelisted by name before dispatch
- Tenant ID is injected into task kwargs automatically
- SSE (Server-Sent Events) provides real-time progress streaming to browsers
- SSE auth supports both Bearer header (programmatic) and `?token=` query param (browser EventSource)

### 3.8 Caching

Redis serves three purposes:
1. **Token blacklist** — Revoked JWTs tracked by `jti` with TTL matching remaining token lifetime
2. **Rate limiting** — Sliding-window counters per-user/per-IP
3. **Application cache** — Tenant metadata, auth flow state, generic key-value caching with TTL

### 3.9 Observability

| Pillar | Technology | Details |
|--------|-----------|---------|
| **Tracing** | OpenTelemetry SDK → OTLP exporter | Auto-instrumentation for FastAPI, Celery, Redis, PyMongo |
| **Metrics** | OpenTelemetry → Prometheus | `/metrics` endpoint, HTTP request metrics, custom counters |
| **Logging** | Loguru | Structured JSON in production, human-readable in development. Request ID + trace ID correlation. Stdlib interception for all third-party libraries. |
| **Audit** | Loguru (audit=True) | Structured events for login, logout, file access, role changes, tenant provisioning |

---

## 4. Data Flow: Authentication

```
1. Client → POST /auth/login {provider: "microsoft"}
2. API → Generates MSAL auth URL, caches flow state in Redis
3. Client → Redirected to Microsoft login page
4. Microsoft → Redirects to GET /auth/callback/microsoft?code=...
5. API → Exchanges code for tokens via MSAL
6. API → Upserts User in shared DB
7. API → Auto-provisions Tenant if new (first user gets "owner" role)
8. API → Returns JWT access_token + refresh_token
9. Client → Uses Bearer token for subsequent requests
```

---

## 5. Data Flow: Authenticated Request

```
1. Client → Request with Authorization: Bearer <token>
2. JWTSessionMiddleware → Decode token, check blacklist, set request.state.user
3. TenantContextMiddleware → Resolve tenant DB + S3 bucket, set contextvar
4. RateLimitMiddleware → Check Redis counter, reject if over limit
5. Route Handler → require_tenant() + require_permissions() checks
6. Service Layer → Operates on tenant-specific DB/S3 via contextvar
7. Response → Security headers, rate limit headers, X-Request-ID
```

---

## 6. Deployment Architecture

```
┌─────────────────────────────────────────────┐
│              Docker Compose / ECS / K8s      │
│                                              │
│  ┌─────────┐  ┌──────────────┐  ┌────────┐ │
│  │ FastAPI  │  │ Celery       │  │ Celery │ │
│  │ (uvicorn)│  │ Worker (N)   │  │ Beat   │ │
│  │ Port 8000│  │              │  │(optional)│ │
│  └────┬─────┘  └──────┬───────┘  └────────┘ │
│       │               │                      │
│  ┌────▼───────────────▼──────────────┐       │
│  │       Shared Infrastructure       │       │
│  │  ┌───────┐ ┌─────┐ ┌──────────┐  │       │
│  │  │MongoDB│ │Redis│ │RabbitMQ  │  │       │
│  │  │/ DocDB│ │     │ │(optional)│  │       │
│  │  └───────┘ └─────┘ └──────────┘  │       │
│  └───────────────────────────────────┘       │
│                                              │
│  ┌─────────────────┐  ┌──────────────────┐   │
│  │  AWS S3 Buckets  │  │  OTLP Collector  │   │
│  │  (per-tenant)    │  │  (Jaeger/Tempo)  │   │
│  └─────────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────┘
```

---

## 7. Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Token replay | JWT `jti` claim + Redis-backed blacklist on logout |
| Cross-tenant access | Tenant context from JWT, verified at middleware + service layer |
| Injection | Pydantic validation on all inputs, parameterized MongoDB queries |
| Rate abuse | Redis sliding-window per-user/per-IP with configurable limits |
| Transport security | HSTS in production, security response headers on every response |
| Privilege escalation | RBAC enforcement via FastAPI dependencies on every protected route |
| Secrets | All secrets via environment variables, never hardcoded |

---

## 8. Scalability

| Component | Scaling Strategy |
|-----------|-----------------|
| API servers | Horizontal — stateless, scale behind load balancer |
| Celery workers | Horizontal — add workers per queue/task type |
| MongoDB | Vertical (DocumentDB) or sharded cluster |
| Redis | Vertical or Redis Cluster for high-throughput |
| S3 | Managed, scales automatically |
