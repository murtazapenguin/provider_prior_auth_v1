# Capability: async_processing

## Description
Background tasks (OCR, LLM, heavy computation) run via Celery workers rather than
blocking the HTTP request. Jobs are queued in Redis and processed asynchronously.

## Question
"Should processing run in the background (non-blocking)?"

## Options
- Yes — queue tasks with Celery (required for ai_extraction, large file processing)
- No — process synchronously inline (only for fast, trivial operations)

## Contracts Required
- `websocket-messages` — if realtime_status also enabled, tasks emit progress updates

## Schema Fields
Add job tracking to the item schema:
```python
job_id: str | None        # Celery task ID
processing_status: str    # pending / processing / completed / failed
processing_error: str | None
```

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/{items}/{id}/process` | Enqueue task; returns 202 + job_id |
| GET  | `/api/v1/jobs/{job_id}`        | Poll job status (fallback to WebSocket) |

## API Formats

| Endpoint | Method | Request Content-Type | Request Fields | Response Content-Type |
|----------|--------|---------------------|----------------|----------------------|
| `/api/v1/{items}/{id}/process` | POST | application/json | `{}` (empty body) | application/json |
| `/api/v1/jobs/{job_id}` | GET | - | - | application/json |

**Response — POST /process:**
```json
{"job_id": "string", "status": "pending"}
```

**Response — GET /jobs/{job_id}:**
```json
{
  "job_id": "string",
  "item_id": "string",
  "status": "processing",
  "progress": 45,
  "message": "Running OCR...",
  "created_at": "2024-01-15T10:00:00Z",
  "updated_at": "2024-01-15T10:30:00Z"
}
```

## Celery Configuration (MANDATORY)
- Broker: Redis (from env `REDIS_URL`)
- Retries: 3, exponential backoff: 10s → 30s → 90s
- On final failure: update item status to "failed", notify via WebSocket if `realtime_status` enabled
- NEVER use FastAPI BackgroundTasks for AI/ML work — always Celery

## Data Types

> **Canonical schemas (Pydantic + TypeScript):** See `.claude/contracts/websocket-messages.md`
>
> Includes: `JobStatus`, `ProcessingJob`

## UI Components
- Trigger button that POSTs to `/process` and receives 202
- If `realtime_status`: progress bar driven by WebSocket notifications
- If NOT `realtime_status`: polling hook (`GET /jobs/{job_id}` every 3s)

## Dependencies
- Redis (`REDIS_URL` env var)
- Celery worker process
- `platform-backend-kit/app/modules/tasks/workers/`
