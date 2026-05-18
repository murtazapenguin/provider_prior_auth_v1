# Phase 0 Design Reference: Templates

---

## 1. Standard Data Model Template

When a problem statement is given, use this template as a starting point. Customize per project.

### Canonical Entities

```python
# Organization - Multi-tenant root
Organization:
    org_id: str              # Primary key
    name: str
    settings: dict
    created_at: datetime

# User - Authentication & authorization
User:
    user_id: str             # Primary key
    org_id: str              # FK -> Organization
    email: str
    role: str                # e.g., "reviewer", "admin"
    hashed_password: str
    created_at: datetime

# WorkItem - Primary business entity (rename per project: Case, Document, Invoice, etc.)
WorkItem:
    item_id: str             # Primary key
    org_id: str              # FK -> Organization (multi-tenant filtering)
    title: str
    status: ItemStatus       # Enum - customize per project
    assigned_to: str | None  # FK -> User
    source_files: list[str]  # S3 keys (if file_storage or document_processing capability)
    created_at: datetime
    updated_at: datetime

# ProcessingJob - Tracks async Celery tasks
ProcessingJob:
    job_id: str              # Primary key
    org_id: str              # FK -> Organization
    item_id: str             # FK -> WorkItem
    celery_task_id: str      # Celery task UUID
    status: JobStatus        # pending, running, completed, failed, retrying
    started_at: datetime | None
    completed_at: datetime | None
    error_message: str | None
    retry_count: int

# ExtractionResult - AI output (customize fields per project)
ExtractionResult:
    result_id: str           # Primary key
    org_id: str              # FK -> Organization
    item_id: str             # FK -> WorkItem
    job_id: str              # FK -> ProcessingJob
    extracted_data: dict     # Project-specific structure
    bboxes: list[dict]       # Canonical bbox format (if evidence_display capability)
    created_at: datetime

# AuditLog - State change tracking (for tracing)
AuditLog:
    log_id: str              # Primary key
    org_id: str              # FK -> Organization
    user_id: str | None      # FK -> User (null if system)
    action: str              # e.g., "status_change", "edit", "approve"
    entity_type: str         # e.g., "case", "criterion"
    entity_id: str
    previous_value: dict | None
    new_value: dict | None
    timestamp: datetime
```

### Customization Example (PA Case Review)

```python
# Rename WorkItem -> Case
Case:
    case_id: str
    org_id: str
    patient_name: str
    patient_dob: date
    procedure_code: str
    lob: str                 # Line of business
    guideline_code: str
    status: CaseStatus       # pending, processing, ready_for_review, approved, denied
    ai_decision: str | None  # APPROVE, DENY
    assigned_to: str | None
    document_names: list[str]
    page_urls: dict          # PDFViewer format
    created_at: datetime
    updated_at: datetime

# Rename ExtractionResult -> CriteriaEvaluation
CriteriaEvaluation:
    evaluation_id: str
    case_id: str
    criteria_tree: list[dict]  # Full tree with verdicts
    final_decision: str        # APPROVE, DENY
    created_at: datetime
```

---

## 2. Workflow State Machine Template

Standard state machine for AI workflow apps. Customize per project.

### Work Item Lifecycle

```
                    ┌─────────────────────────────────────┐
                    │         WORK ITEM LIFECYCLE          │
                    └─────────────────────────────────────┘

  pending ──> processing ──> ready_for_review ──> approved
                 │                  │
                 │                  v
                 │              denied
                 v
             failed
                 │
                 └──────────────────────────────────────┐
                                                        │
                              (manual retry) ──────────┘
```

### Processing Job Lifecycle

```
  pending ──> running ──> completed
                │
                v
            retrying ──> failed (after 3 retries)
```

### Tracing Fields (on every state change)

Store these fields in AuditLog for every status transition:

```python
{
    "timestamp": "2024-01-15T10:30:00Z",
    "changed_by": "user_123" | "system",
    "previous_status": "processing",
    "new_status": "ready_for_review",
    "reason": "AI evaluation completed"  # Optional
}
```

### State Transition Functions

```python
async def transition_status(
    db,
    entity_type: str,
    entity_id: str,
    new_status: str,
    user_id: str | None = None,
    reason: str | None = None
):
    """Transition entity status with audit logging."""
    collection = db[entity_type + "s"]
    entity = await collection.find_one({"id": entity_id})

    if not entity:
        raise HTTPException(404, f"{entity_type} not found")

    previous_status = entity["status"]

    # Update entity
    await collection.update_one(
        {"id": entity_id},
        {"$set": {"status": new_status, "updated_at": datetime.utcnow()}}
    )

    # Log to audit trail
    await db.audit_logs.insert_one({
        "id": str(uuid4()),
        "org_id": entity["org_id"],
        "user_id": user_id,
        "action": "status_change",
        "entity_type": entity_type,
        "entity_id": entity_id,
        "previous_value": {"status": previous_status},
        "new_value": {"status": new_status},
        "reason": reason,
        "timestamp": datetime.utcnow()
    })

    return entity
```

---

## 3. Processing Status Flow

Async processing uses WebSocket for real-time status updates.

### Sequence Diagram

```
Client                    Server                    Celery Worker
  │                         │                           │
  │──POST /process/{id}────>│                           │
  │<──202 {job_id}──────────│                           │
  │                         │──dispatch task───────────>│
  │──WS connect─────────────│                           │
  │──WS subscribe(job_id)──>│                           │
  │                         │<──status: running─────────│
  │<──WS {status: running}──│                           │
  │                         │<──progress: 50%───────────│
  │<──WS {progress: 50}─────│                           │
  │                         │<──status: completed───────│
  │<──WS {status: completed,│                           │
  │      result_id: "..."}──│                           │
  │──GET /results/{id}─────>│                           │
  │<──{extracted_data}──────│                           │
```

### WebSocket Message Format

See `.claude/contracts/websocket-messages.md` for full schema.

```json
{
  "type": "notification",
  "payload": {
    "job_id": "job_123",
    "item_id": "case_456",
    "status": "processing",
    "progress": 45,
    "message": "Running OCR on document 2 of 3..."
  }
}
```

### Progress Milestones (example for document processing pipeline)

> Milestones vary by pipeline type. Adapt stages to match selected capabilities.

| Progress | Stage |
|----------|-------|
| 0-10 | Job started, loading documents |
| 10-40 | OCR processing (if `document_processing`) |
| 40-50 | Page image generation (if `document_processing`) |
| 50-90 | AI evaluation (LLM calls) (if `ai_extraction`) |
| 90-95 | Bbox mapping (if `evidence_display`) |
| 95-100 | Saving results |

---

## 4. Standard API Response Shapes

All agents must use these response formats. See `.claude/contracts/` for full schemas.

### Success - Single Item

```json
{
  "id": "item_123",
  "status": "ready_for_review",
  "field": "value"
}
```

### Success - Paginated List

```json
{
  "items": [...],
  "total": 100,
  "page": 1,
  "page_size": 20,
  "total_pages": 5
}
```

### Error

```json
{"detail": "Human-readable error message"}
```

### Processing Accepted (Async)

HTTP 202 Accepted:
```json
{
  "job_id": "job_123",
  "status": "pending",
  "message": "Processing started"
}
```

### Auth Response

Per `.claude/contracts/auth-response.md`:

```json
{
  "access_token": "eyJ...",
  "token_type": "bearer"
}
```

**Note:** The login endpoint (`/api/v1/auth/login`) returns ONLY `access_token` and `token_type`. User details are fetched separately via `GET /api/v1/auth/me`. See the auth-response contract for the canonical format.

---

## 5. Schema Representation Rule

Every domain schema in HANDOFF.md Phase 0 MUST have all 3 representations: JSON, Pydantic, TypeScript. Field names are snake_case in ALL three — including TypeScript. ui-builder does NOT convert to camelCase.

See `.claude/contracts/storage-format.md` for the zero-transform rule and examples.
