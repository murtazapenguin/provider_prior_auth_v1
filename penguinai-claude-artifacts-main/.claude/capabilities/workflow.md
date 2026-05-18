# Capability: workflow

## Description
Item workflow with status transitions. Defines the lifecycle of work items from creation to completion.

## Question
"What's the item workflow (status transitions)?"

## Options
- Default: pending → processing → ready_for_review → completed
- Custom: User defines their own status flow

## Follow-up Question (if Custom)
"Define the status values and transitions:"
- List all status values
- Define allowed transitions
- Define terminal states

## Contracts Required
- Status enum definition in HANDOFF.md

## Schema Fields
When enabled, add to item model:

```python
status: ItemStatus              # Current workflow status
```

## Status Enum Schema
```python
# Define in HANDOFF.md Phase 0
ItemStatus = Literal["pending", "processing", "ready_for_review", "approved", "denied"]
```

## State Machine
Define allowed transitions:

```
pending → processing
processing → ready_for_review
processing → failed
ready_for_review → approved
ready_for_review → denied
failed → pending (retry)
```

## API Endpoints
When enabled, implement:

| Method | Endpoint | Description |
|--------|----------|-------------|
| PATCH | `/api/v1/{items}/{id}/status` | Transition item to new status |
| GET | `/api/v1/{items}?status={status}` | Filter items by status |

Status changes are validated against allowed transitions. Invalid transitions return 400.

## API Formats

| Endpoint | Method | Request Content-Type | Request Fields | Response Content-Type |
|----------|--------|---------------------|----------------|----------------------|
| `/api/v1/{items}/{id}/status` | PATCH | application/json | `{"status": "string"}` | application/json |
| `/api/v1/{items}?status={status}` | GET | - | query: `status` | application/json |

**Request — PATCH /status:**
```json
{ "status": "ready_for_review" }
```

**Response — PATCH /status:**
```json
{
  "id": "item_123",
  "status": "ready_for_review",
  "previous_status": "processing",
  "updated_at": "2024-01-15T10:30:00Z"
}
```

**Error — 400 Invalid Transition:**
```json
{ "detail": "Invalid transition from 'pending' to 'approved'" }
```

## Data Types

### Pydantic Models (Backend)
```python
from enum import Enum

class ItemStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    ready_for_review = "ready_for_review"
    approved = "approved"
    denied = "denied"
    failed = "failed"

class StatusTransitionRequest(BaseModel):
    status: str

class StatusTransitionResponse(BaseModel):
    id: str
    status: str
    previous_status: str
    updated_at: datetime
```

### TypeScript Interfaces (Frontend)
```typescript
type ItemStatus = "pending" | "processing" | "ready_for_review" | "approved" | "denied" | "failed";

interface StatusTransitionRequest {
  status: string;
}

interface StatusTransitionResponse {
  id: string;
  status: string;
  previous_status: string;
  updated_at: string;
}
```

## UI Components
When enabled, include:
- Status badges with color coding
- Filter by status on list pages
- Status transition buttons (based on allowed transitions)

## Common Patterns

### Review Workflow
```python
statuses = ["pending", "processing", "ready_for_review", "approved", "denied"]
transitions = {
    "pending": ["processing"],
    "processing": ["ready_for_review", "failed"],
    "ready_for_review": ["approved", "denied"],
    "failed": ["pending"]
}
terminal = ["approved", "denied"]
```

### Simple Processing
```python
statuses = ["pending", "processing", "completed", "failed"]
transitions = {
    "pending": ["processing"],
    "processing": ["completed", "failed"],
    "failed": ["pending"]
}
terminal = ["completed"]
```

## Audit Trail
Track all status transitions:
```python
{
    "action": "status_change",
    "entity_id": "item_123",
    "previous_status": "processing",
    "new_status": "ready_for_review",
    "changed_by": "system",
    "timestamp": "2024-01-15T10:30:00Z"
}
```

## Dependencies
- Backend enforces transition rules
- WebSocket notifies on status change (if realtime_status enabled)
