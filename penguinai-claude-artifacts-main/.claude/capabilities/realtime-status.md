# Capability: realtime_status

## Description
Users see real-time processing progress updates via WebSocket. Status changes are pushed to the client without polling.

## Question
"Should users see real-time processing progress?"

## Options
- Yes — show progress updates
- No — skip this capability

## Contracts Required
- `websocket-messages` — WebSocket message format

## Schema Fields
When enabled, add job tracking:

```python
# ProcessingJob model
job_id: str
item_id: str
status: JobStatus               # pending, running, completed, failed, retrying
progress: int                   # 0-100
message: str                    # Current step description
```

## WebSocket Message Schema
```json
{
  "type": "notification",
  "payload": {
    "job_id": "job_123",
    "item_id": "item_456",
    "status": "processing",
    "progress": 45,
    "message": "Running OCR on document 2 of 3...",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

## API Endpoints
When enabled, implement:

| Method | Endpoint | Description |
|--------|----------|-------------|
| WS | `/ws/{user_id}` | WebSocket connection |
| GET | `/api/v1/jobs/{job_id}` | Job status (fallback) |

## API Formats

| Endpoint | Method | Request Content-Type | Request Fields | Response Content-Type |
|----------|--------|---------------------|----------------|----------------------|
| `/ws/{user_id}` | WS | - | WebSocket upgrade | application/json (messages) |
| `/api/v1/jobs/{job_id}` | GET | - | - | application/json |

**WebSocket Message Format:**
```json
{
  "type": "notification",
  "payload": {
    "job_id": "string",
    "item_id": "string",
    "status": "processing",
    "progress": 45,
    "message": "Running OCR...",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

**Response — GET /jobs/{job_id}:**
```json
{
  "job_id": "string",
  "item_id": "string",
  "status": "running",
  "progress": 45,
  "message": "Running OCR...",
  "created_at": "2024-01-15T10:00:00Z",
  "updated_at": "2024-01-15T10:30:00Z"
}
```

## Data Types

> **Canonical schemas (Pydantic + TypeScript):** See `.claude/contracts/websocket-messages.md`
>
> Includes: `JobStatus`, `ProcessingJob`, `WebSocketPayload`, `WebSocketMessage`

## UI Components
When enabled, include:
- WebSocket connection hook
- Progress bar / spinner
- Status toast notifications
- Auto-refresh on completion

## Progress Milestones
| Progress | Stage |
|----------|-------|
| 0-10 | Job started, loading documents |
| 10-40 | OCR processing |
| 40-50 | Page image generation |
| 50-90 | LLM evaluation |
| 90-95 | Bbox mapping |
| 95-100 | Saving results |

## Dependencies
- Requires Redis for Celery broker
- WebSocket manager from platform-backend-kit
- Celery tasks emit progress updates
