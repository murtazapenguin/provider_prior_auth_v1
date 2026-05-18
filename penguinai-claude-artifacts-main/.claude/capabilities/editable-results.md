# Capability: editable_results

## Description
Users can edit AI extraction results. This includes overriding values, changing verdicts, or adding corrections.

## Question
"Can users edit AI results?"

## Options
- Yes — allow editing
- No — view only

## Follow-up Question (if Yes)
"What can users edit?"
- Individual field values
- Verdicts (TRUE/FALSE)
- Final decision (override)
- Add notes/comments

## Contracts Required
- Edit request/response schemas (derived per project)

## Schema Fields
When enabled, add reviewer override fields:

```python
# Per extracted field / criterion
reviewer_value: any | None      # User override (null = accept AI)
reviewer_notes: str | None      # User comments

# Per item (if decision override enabled)
ai_decision: str                # Original AI decision
reviewer_decision: str | None   # User override
```

## API Endpoints
When enabled, implement:

| Method | Endpoint | Description |
|--------|----------|-------------|
| PATCH | `/api/v1/{items}/{id}/fields/{field}` | Update field value |
| PATCH | `/api/v1/{items}/{id}/decision` | Override final decision |
| PATCH | `/api/v1/{items}/{id}/notes` | Update notes |

## API Formats

| Endpoint | Method | Request Content-Type | Request Fields | Response Content-Type |
|----------|--------|---------------------|----------------|----------------------|
| `/api/v1/{items}/{id}/fields/{field}` | PATCH | application/json | `{"value": "any", "notes": "string"}` | application/json |
| `/api/v1/{items}/{id}/decision` | PATCH | application/json | `{"decision": "string", "notes": "string"}` | application/json |
| `/api/v1/{items}/{id}/notes` | PATCH | application/json | `{"notes": "string"}` | application/json |

**Request — PATCH /fields/{field}:**
```json
{
  "value": "new_value",
  "notes": "Reason for change"
}
```

**Response — PATCH (all):** Returns the updated item or field with `{"status": "updated", "field": "...", "previous_value": "...", "new_value": "..."}`.

## Data Types

### Pydantic Models (Backend)
```python
class EditFieldRequest(BaseModel):
    value: Any
    notes: str | None = None

class EditDecisionRequest(BaseModel):
    decision: str
    notes: str | None = None

class EditNotesRequest(BaseModel):
    notes: str

class EditResponse(BaseModel):
    status: str = "updated"
    field: str
    previous_value: Any
    new_value: Any
```

### TypeScript Interfaces (Frontend)
```typescript
interface EditFieldRequest {
  value: any;
  notes: string | null;
}

interface EditDecisionRequest {
  decision: string;
  notes: string | null;
}

interface EditResponse {
  status: string;
  field: string;
  previous_value: any;
  new_value: any;
}
```

## UI Components
When enabled, include:
- Edit buttons on each editable field
- Inline editing or modal forms
- Save/Cancel controls
- Visual indicator for overridden values

## Audit Trail
When enabled, track changes:
```python
# AuditLog entry
action: "edit"
entity_type: "field" | "decision"
entity_id: str
previous_value: any
new_value: any
changed_by: str
timestamp: datetime
```

## Dependencies
- Audit logging for traceability
- Recomputation logic (if editing affects aggregated values)
