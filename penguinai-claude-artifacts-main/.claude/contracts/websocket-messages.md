# Contract: websocket-messages

## Overview
Defines WebSocket message formats for real-time communication. This contract has two layers:

1. **Transport Layer** — the generic message format and connection management built into `platform-backend-kit/websocket/`
2. **Processing Status Convention** — a project-level convention for AI processing progress updates, built on top of the transport layer

## Producer
- **api-builder** (Phase 2) - WebSocket manager sends notifications
- **ai-integrator** (Phase 2.5) - Celery tasks emit progress updates

## Consumers
- **ui-builder** (Phase 1) - WebSocket hook receives and displays updates
- **quality-tester** (Phase 3) - Verifies real-time updates work

## Connection

```
WebSocket URL: /ws/{user_id}
(Frontend: use ws://${window.location.host}/ws/{user_id} — NEVER hardcode localhost)
(Backend tests: ws://localhost:8000/ws/{user_id})
```

---

## Layer 1: Transport (matches `platform-backend-kit/websocket/`)

### WebSocketMessage Model

```python
# websocket/models.py
class MessageType(str, Enum):
    CHAT = "chat"
    NOTIFICATION = "notification"
    SUBSCRIBE = "subscribe"
    UNSUBSCRIBE = "unsubscribe"
    BROADCAST = "broadcast"
    USER_MESSAGE = "user_message"
    GROUP_MESSAGE = "group_message"
    PING = "ping"
    PONG = "pong"

class WebSocketMessage(BaseModel):
    type: MessageType
    payload: Dict[str, Any]
    target: Optional[str] = None    # user_id, group_id, or topic
    sender: Optional[str] = None
    timestamp: Optional[datetime] = None
```

### ConnectionManager

The actual `ConnectionManager` in `websocket/manager.py` supports **multiple connections per user** and **topic subscriptions**:

```python
class ConnectionManager:
    user_connections: Dict[str, Set[WebSocket]]      # user_id -> set of websockets
    topic_subscriptions: Dict[str, Set[WebSocket]]   # topic -> set of websockets
    connection_metadata: Dict[WebSocket, ConnectionMetadata]
    websocket_topics: Dict[WebSocket, Set[str]]      # websocket -> subscribed topics
```

**Key methods:**

| Method | Description |
|--------|-------------|
| `connect(websocket, user_id, ...)` | Adds websocket to user's connection set |
| `disconnect(websocket)` | Removes websocket from all sets |
| `send_to_user(user_id, message)` | Sends to ALL connections for a user |
| `send_to_topic(topic, message)` | Sends to all subscribers of a topic |
| `broadcast(message, exclude_user)` | Sends to all connected users |
| `subscribe_to_topic(websocket, topic)` | Subscribes a connection to a topic |

**Note:** There is no `send_notification` convenience method in the code. To send a notification, use `send_to_user(user_id, message)` with a `WebSocketMessage` of type `"notification"`.

### ErrorMessage Model

```python
class ErrorMessage(BaseModel):
    type: str = "error"
    detail: str          # Matches error-response contract
    timestamp: datetime
```

### NotificationMessage Model

```python
class NotificationMessage(BaseModel):
    type: str = "notification"
    title: str
    body: str
    priority: str = "normal"   # "low", "normal", "high"
    timestamp: datetime
```

**Note:** This built-in `NotificationMessage` has `{title, body, priority}` — it is NOT the same as the processing-status payload convention below. The processing-status payload is project-specific and uses `{job_id, status, progress, message}`.

---

## Layer 2: Processing Status Convention (Project-Level)

This is a **recommended convention** for AI processing progress updates. It is NOT built into the WebSocket manager — Celery tasks construct these payloads and call `send_to_user`.

### 1. Processing Status Update

```json
{
  "type": "notification",
  "payload": {
    "job_id": "job_abc123",
    "case_id": "91091190",
    "status": "processing",
    "progress": 45,
    "message": "Running OCR on document 3 of 5...",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

### 2. Processing Complete

```json
{
  "type": "notification",
  "payload": {
    "job_id": "job_abc123",
    "case_id": "91091190",
    "status": "completed",
    "progress": 100,
    "message": "Evaluation complete",
    "result_id": "eval_xyz789",
    "ai_decision": "APPROVE",
    "timestamp": "2024-01-15T10:32:00Z"
  }
}
```

### 3. Processing Failed

```json
{
  "type": "notification",
  "payload": {
    "job_id": "job_abc123",
    "case_id": "91091190",
    "status": "failed",
    "progress": 0,
    "message": "OCR failed: Document corrupted",
    "error": "PDFReadError: Invalid PDF structure",
    "timestamp": "2024-01-15T10:31:00Z"
  }
}
```

## Status Values

| Status | Description | Progress |
|--------|-------------|----------|
| `pending` | Job queued, not started | 0 |
| `processing` | Actively processing | 1-99 |
| `completed` | Successfully finished | 100 |
| `failed` | Error occurred | 0 |
| `retrying` | Retrying after failure | varies |

## Progress Milestones

| Progress | Stage |
|----------|-------|
| 0-10 | Job started, loading documents |
| 10-40 | OCR processing |
| 40-50 | Page image generation |
| 50-90 | LLM evaluation |
| 90-95 | Bbox mapping |
| 95-100 | Saving results |

---

## Backend Implementation

```python
# In Celery task — construct processing-status payload and send via transport
from websocket.manager import manager  # ConnectionManager instance

async def notify_progress(user_id: str, job_id: str, progress: int, message: str):
    await manager.send_to_user(user_id, {
        "type": "notification",
        "payload": {
            "job_id": job_id,
            "status": "processing",
            "progress": progress,
            "message": message,
            "timestamp": datetime.utcnow().isoformat()
        }
    })
```

## Frontend Implementation

```jsx
// hooks/useWebSocket.js
import { useEffect, useCallback, useState } from 'react';

export const useWebSocket = (userId) => {
  const [socket, setSocket] = useState(null);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/${userId}`);

    ws.onopen = () => console.log('WebSocket connected');

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'notification') {
        setNotifications(prev => [...prev, data.payload]);

        // Show toast for status changes
        if (data.payload.status === 'completed') {
          toast.success(`Evaluation complete: ${data.payload.ai_decision}`);
        } else if (data.payload.status === 'failed') {
          toast.error(`Processing failed: ${data.payload.message}`);
        }
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      // Auto-reconnect after 3 seconds
      setTimeout(() => setSocket(null), 3000);
    };

    setSocket(ws);
    return () => ws.close();
  }, [userId]);

  return { socket, notifications };
};

// Usage in component
const { notifications } = useWebSocket(user.id);

// Find current job status
const currentJob = notifications
  .filter(n => n.case_id === caseId)
  .pop();

{currentJob?.status === 'processing' && (
  <ProgressBar value={currentJob.progress} />
)}
```

## Known Issues

1. **`send_error` bug:** The `send_error` method in `manager.py` passes `error` and `message` keyword arguments, but the `ErrorMessage` model expects a `detail` field. This will raise a `ValidationError` at runtime if `send_error` is called. Workaround: construct the error message manually and use `send_to_user` instead.

2. **`NotificationMessage` vs processing-status mismatch:** The built-in `NotificationMessage` model has `{title, body, priority}` fields, which do not match the processing-status convention `{job_id, status, progress, message}`. The processing-status payloads bypass the `NotificationMessage` model entirely — they are plain dicts sent via `send_to_user`.

## Validation Rules

1. All messages MUST have `type` field
2. Processing-status `payload.status` MUST be one of: pending, processing, completed, failed, retrying
3. Processing-status `payload.progress` MUST be 0-100
4. `payload.timestamp` MUST be ISO 8601 format
5. `completed` status MUST include `result_id`
6. `failed` status MUST include `message` with error description

## Common Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| No reconnect logic | Lost updates after disconnect | Implement auto-reconnect |
| Missing progress updates | User thinks it's stuck | Send updates every 10% |
| No error message | User doesn't know what failed | Always include message |
| Wrong user_id routing | Updates go to wrong user | Use authenticated user_id |
| Using `send_notification` | Method doesn't exist | Use `send_to_user` with notification payload |
| Using `send_error` | Bug: wrong params for ErrorMessage | Construct error dict manually, use `send_to_user` |
| Assuming single connection per user | Misses other tabs/windows | Manager supports `Set[WebSocket]` per user |
