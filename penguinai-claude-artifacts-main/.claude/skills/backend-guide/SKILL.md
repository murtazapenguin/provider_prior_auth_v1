---
name: backend-guide
description: FastAPI backend patterns with MongoDB using platform-backend-kit conventions. Includes JWT authentication, Motor async driver, Pydantic models, multi-tenant isolation, Celery workers, and S3 storage. Triggers on backend APIs, FastAPI, MongoDB, or authentication.
---

# FastAPI Backend Patterns

Patterns for building FastAPI backends with MongoDB that integrate with React frontends.

---

## Source Library: platform-backend-kit (CRITICAL - REUSE THIS)

**Location:** `platform-backend-kit/` (relative to repository root)

A production-ready multi-tenant FastAPI backend with JWT auth, RBAC, Celery workers, S3 storage, OpenTelemetry, and full middleware stack.

### Project Structure

```
platform-backend-kit/app/
├── main.py                 # FastAPI app factory + full middleware stack
├── config.py               # Pydantic settings (env vars) + production validation
├── database.py             # MongoDB/Beanie init, Motor client (pooled + timeouts)
├── redis.py                # Redis connection (pooled)
├── celery_app.py           # Celery configuration
├── tenant.py               # TenantContext (contextvar), TenantDatabaseManager
├── telemetry.py            # OpenTelemetry + Prometheus
├── logging_config.py       # Loguru configuration
├── common/
│   ├── audit.py            # Structured audit logging
│   ├── cache.py            # Redis cache service
│   ├── error_handlers.py   # Global exception handlers
│   ├── exceptions.py       # Custom HTTP exceptions
│   ├── models.py           # Base document model
│   └── schemas.py          # Shared schemas (PaginationParams, PaginatedResponse)
├── middleware/
│   ├── auth.py             # JWT extraction + token blacklist
│   ├── cors.py             # CORS from env config
│   ├── logging.py          # Request/response logging
│   ├── rate_limit.py       # Redis sliding-window rate limiter
│   ├── request_id.py       # X-Request-ID propagation
│   ├── security.py         # Security response headers
│   └── tenant.py           # TenantContext middleware
└── modules/
    ├── auth/               # JWT, RBAC, OAuth2, SAML providers
    │   ├── dependencies.py  # CurrentUser, require_roles()
    │   ├── routes.py        # Auth endpoints
    │   ├── service.py       # Auth business logic
    │   ├── models.py        # User, Tenant models
    │   └── providers/       # OAuth2 (MSAL), SAML
    ├── health/             # /health + /readiness probes
    ├── storage/            # S3 presigned upload/download
    └── tasks/workers/      # Celery worker tasks
```

### Key Modules to Reuse

| Module | Purpose | Copy Command |
|--------|---------|--------------|
| `app/main.py` | FastAPI app factory + middleware | Base template |
| `app/modules/auth/` | JWT + RBAC + SSO | `cp -r platform-backend-kit/app/modules/auth backend/app/modules/` |
| `app/middleware/` | Full middleware stack | `cp -r platform-backend-kit/app/middleware backend/app/` |
| `app/common/` | Schemas, errors, cache | `cp -r platform-backend-kit/app/common backend/app/` |
| `app/database.py` | Motor client init | `cp platform-backend-kit/app/database.py backend/app/` |
| `app/tenant.py` | Multi-tenant collections | `cp platform-backend-kit/app/tenant.py backend/app/` |
| `app/modules/tasks/workers/` | Celery workers | `cp -r platform-backend-kit/app/modules/tasks backend/app/modules/` |
| `app/modules/storage/` | S3 presigned URLs | `cp -r platform-backend-kit/app/modules/storage backend/app/modules/` |

### Auth — CurrentUser and RBAC

```python
from app.modules.auth.dependencies import CurrentUser, require_roles

# Protected endpoint
@router.get("/items")
async def list_items(user: CurrentUser):
    return await ItemService.list(user.tenant_id)

# Role-gated endpoint
@router.delete("/items/{id}", dependencies=[Depends(require_roles(["admin"]))])
async def delete_item(id: str, user: CurrentUser):
    ...
```

### Multi-Tenant Collection Pattern

```python
from app.tenant import get_tenant_collection

async def list_items(tenant_id: str, skip: int = 0, limit: int = 50) -> dict:
    collection = get_tenant_collection("items")
    query_filter = {"tenant_id": tenant_id}
    total = await collection.count_documents(query_filter)
    cursor = collection.find(query_filter).skip(skip).limit(limit)
    items = await cursor.to_list(length=limit)
    return {"items": items, "total": total, "skip": skip, "limit": limit}
```

### Pagination Response Shape

```python
from app.common.schemas import PaginatedResponse

@router.get("/items", response_model=PaginatedResponse[ItemResponse])
async def list_items(user: CurrentUser, skip: int = 0, limit: int = 50):
    return await ItemService.list_items(user.tenant_id, skip=skip, limit=limit)
```

### Complete Backend Setup

```bash
cp -r platform-backend-kit/app backend/app
cp platform-backend-kit/pyproject.toml backend/
cp platform-backend-kit/docker-compose.yml backend/
# Then add your domain modules under backend/app/modules/
```

---

## Authentication

> **Full auth patterns (JWT, RBAC, login endpoint, env vars):** See `.claude/patterns/jwt-auth.md`
>
> **API formats and data types:** See `.claude/capabilities/authentication.md`

---

## Core Configuration

```python
# config.py
import os
from dotenv import load_dotenv
load_dotenv()

MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017/")
DATABASE_NAME = os.getenv("DATABASE_NAME", "penguin_app")
JWT_SECRET = os.getenv("JWT_SECRET", "your-secret-key")
JWT_ALGORITHM = "HS256"
```

```python
# utils/db_utils.py
from motor.motor_asyncio import AsyncIOMotorClient
from config import MONGODB_URL, DATABASE_NAME

client = AsyncIOMotorClient(MONGODB_URL)
db = client[DATABASE_NAME]
```

---

## Standard Status Enums

```python
# models/document.py
from enum import Enum

# Customize per project — orchestrator locks these in Phase 0
class DocumentStatus(str, Enum):
    UPLOADED = "uploaded"
    QUEUED = "queued"
    PROCESSING = "processing"
    REVIEW = "review"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
```

---

## Standard API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/login` | Login |
| POST | `/api/v1/auth/register` | Register |
| GET | `/api/v1/auth/me` | Current user |
| GET | `/api/v1/documents/queue` | List documents |
| GET | `/api/v1/documents/{id}` | Get document |
| POST | `/api/v1/documents/` | Create document |
| PUT | `/api/v1/documents/{id}/start-coding` | Start workflow |
| PUT | `/api/v1/documents/{id}/complete` | Complete workflow |

---

## Extraction Results Endpoint

> **Canonical bbox format:** See `.claude/contracts/bbox-format.md`
> **Pass bboxes directly to PDFViewer** — no frontend transformation needed.

```python
@router.get("/items/{item_id}/results")
async def get_extraction_results(item_id: str, user=Depends(get_current_user)):
    result = await db.extraction_results.find_one({"item_id": item_id})
    if not result:
        raise HTTPException(404, "Results not found")
    return {
        "id": str(result["_id"]),
        "item_id": item_id,
        "extracted_data": result["extracted_data"],
        "bboxes": result["bboxes"]  # Canonical format - pass directly to PDFViewer
    }
```

---

## Queue Endpoint Pattern

```python
@router.get("/queue")
async def get_queue(status: str | None = None, user=Depends(get_current_user)):
    query = {}
    if status:
        query["status"] = status

    documents = await db.documents.find(query).to_list(100)
    all_docs = await db.documents.find({}).to_list(1000)
    stats = {
        "total": len(all_docs),
        "pending": sum(1 for d in all_docs if d["status"] == "pending"),
        "in_progress": sum(1 for d in all_docs if d["status"] == "in_progress"),
        "completed": sum(1 for d in all_docs if d["status"] == "completed")
    }
    return {"documents": documents, "stats": stats}
```

---

## App Entry Point

```python
# app.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="PenguinAI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/v1/auth", tags=["Authentication"])
app.include_router(document_router, prefix="/api/v1/documents", tags=["Documents"])

@app.get("/health")
async def health():
    return {"status": "ok"}
```

---

## Response Shapes (must match frontend)

```python
# Queue response (paginated)
{
    "items": [{"id": "...", "episode_id": "...", "patient_name": "...", "status": "uploaded", "codes": [...]}],
    "total": 100,
    "page": 1,
    "page_size": 20,
    "total_pages": 5
}
```

---

## Error Handling & Retry Strategy

### Celery Task Retry Policy

- Max retries: 3
- Backoff: exponential (10s → 30s → 90s)
- On final failure: log to AuditLog, update status to `failed`, notify via WebSocket

```python
@app.task(bind=True, max_retries=3, default_retry_delay=10)
def process_document(self, document_id: str):
    try:
        result = run_ocr_and_extraction(document_id)
        return result
    except TransientError as e:
        retry_delay = 10 * (3 ** self.request.retries)
        raise self.retry(exc=e, countdown=retry_delay)
    except MaxRetriesExceededError:
        update_job_status(document_id, "failed")
        notify_user_via_websocket(document_id, "Processing failed after 3 retries")
```

### API Error Response Format

```json
{"detail": "Human-readable error message"}
```

| Scenario | HTTP Code |
|----------|-----------|
| Validation error | 400 |
| Unauthenticated | 401 |
| Forbidden | 403 |
| Not found | 404 |
| Processing failed | 500 |

### Global Exception Handler

```python
async def global_exception_handler(request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    logger.error(f"Unexpected error: {exc}", exc_info=True)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

app.add_exception_handler(Exception, global_exception_handler)
```

---

## Logging

```python
from loguru import logger

logger.info(f"[AUTH] Login attempt for {email}")
logger.info(f"[UPLOAD] Processing {filename}")
logger.error(f"[ERROR] Failed: {str(e)}")
```

Use `LOG_LEVEL=DEBUG` in `.env` for verbose output.

---

## S3 Presigned URLs

> **Full S3 patterns, key format, page image generation:** See `.claude/patterns/s3-integration.md`

**S3 is MANDATORY — there is NO local file storage fallback.**

```env
S3_BUCKET_NAME=workflow-builder-platform-backend-uploads
S3_APP_PREFIX=your-app-name          # Per-app folder prefix
S3_PRESIGNED_URL_EXPIRY=3600         # Presigned URL TTL in seconds
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
```

---

## CORS Configuration

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## Running the Server

```bash
uvicorn app:app --reload --host 0.0.0.0 --port 8000
# API docs at http://localhost:8000/docs
```

---

## Production Seed Data

> **Full seed script with S3 upload + bbox insertion:** See `reference/seed-data.md`

Requirements:
1. All seeded documents MUST include `org_id`
2. PDFs and page images uploaded to S3 (see `.claude/patterns/s3-integration.md`)
3. Extraction results MUST include canonical bboxes (see `.claude/contracts/bbox-format.md`)

---

## Progressive Disclosure

For detailed patterns, see:
- `reference/seed-data.md` - Complete seed script with S3 + bbox integration
- `reference/MODELS.md` - Complete Pydantic model definitions
- `reference/ROUTES.md` - Full route implementations
- `reference/PATTERNS.md` - Advanced patterns
- `.claude/patterns/jwt-auth.md` - JWT authentication patterns
- `.claude/patterns/s3-integration.md` - S3 storage patterns
- `.claude/patterns/multi-tenant-design.md` - Multi-tenant MongoDB patterns
