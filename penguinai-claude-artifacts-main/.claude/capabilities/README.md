# Capabilities Registry

This folder defines available capabilities that can be enabled for a project. During requirements gathering, the orchestrator reads these files and presents capabilities to the user.

## How It Works

```
User Problem Statement
        ↓
Orchestrator reads .claude/capabilities/*.md
        ↓
Presents available capabilities to user
        ↓
User selects which to enable
        ↓
Derive contracts from selected capabilities
        ↓
Derive domain schemas from contracts
        ↓
Write to HANDOFF.md
```

## Capability File Structure

Each capability file defines:

| Section | Description |
|---------|-------------|
| **Description** | What this capability provides |
| **Question** | How to ask the user about this capability |
| **Options** | Possible answers/choices |
| **Contracts Required** | Which contracts are needed |
| **Schema Fields** | Fields to add to data models |
| **API Endpoints** | Endpoints to implement |
| **API Formats** | Request/Response content-types and field names (NEW) |
| **UI Components** | Frontend components needed |
| **Dependencies** | Other capabilities or infrastructure required |

### API Formats Section (CRITICAL)

Each capability MUST define exact request/response formats for its endpoints:

```markdown
## API Formats

| Endpoint | Method | Request Content-Type | Request Fields | Response Content-Type |
|----------|--------|---------------------|----------------|----------------------|
| /auth/login | POST | application/x-www-form-urlencoded | `username=string&password=string` | application/json |
| /cases | GET | - | query: `page, page_size, status` | application/json |
| /cases/{id}/process | POST | application/json | `{}` (empty) | application/json |
```

**Zero-Transform Rule for Formats:**
- Orchestrator locks formats in HANDOFF.md Phase 0
- api-builder implements EXACTLY as specified (use OAuth2PasswordRequestForm for form-urlencoded, BaseModel for JSON)
- ui-builder calls EXACTLY as specified (use URLSearchParams for form-urlencoded, JSON body for JSON)
- Subagents do NOT invent formats - they copy from HANDOFF.md

### Data Types Section (CRITICAL)

Each capability's schemas MUST be accompanied by complete data type definitions:

```markdown
## Data Types

### Pydantic Models (Backend)
```python
class LoginRequest(BaseModel):
    email: str
    password: str
```

### TypeScript Interfaces (Frontend)
```typescript
interface LoginRequest {
  email: string;
  password: string;
}
```
```

**Zero-Transform Rule for Types:**
- Orchestrator derives Pydantic models AND TypeScript interfaces from approved schemas
- Both are locked in HANDOFF.md Phase 0 alongside JSON schemas
- api-builder copies Pydantic models EXACTLY from HANDOFF.md
- ui-builder copies TypeScript interfaces EXACTLY from HANDOFF.md
- Subagents do NOT invent types - they copy from HANDOFF.md
- Field names, types, and optionality MUST match between Pydantic and TypeScript

**Why This Matters:**
- Prevents type mismatches between frontend and backend
- Ensures API contract is enforceable at compile time
- Single source of truth eliminates "works on my machine" bugs

## Available Capabilities

| Capability | File | Contracts |
|------------|------|-----------|
| Document Processing | `document-processing.md` | pdfviewer-data, page-images |
| Evidence Display | `evidence-display.md` | bbox-format, evidence-citation |
| AI Extraction | `ai-extraction.md` | extraction-result |
| Real-time Status | `realtime-status.md` | websocket-messages |
| Async Processing | `async-processing.md` | websocket-messages (if realtime_status) |
| File Storage | `file-storage.md` | storage-format |
| Editable Results | `editable-results.md` | edit endpoints |
| RBAC | `rbac.md` | auth-response with roles |
| Workflow | `workflow.md` | status enums |

## Adding a New Capability

1. Create `{capability-name}.md` in this folder
2. Follow the structure of existing capabilities
3. Define required contracts (create in `.claude/contracts/` if new)
4. Document schema fields, endpoints, and UI components
5. The capability will automatically appear in requirements gathering

## Capability Dependencies

Some capabilities depend on others:

```
evidence_display → requires document_processing
ai_extraction + evidence_display → requires bbox mapping
realtime_status → requires Redis + Celery
editable_results → may require audit logging
```

## Default Capabilities (Always Included)

These are included in every project:

- **Authentication** — JWT login/logout (auth-response, error-response contracts)
- **Pagination** — Paginated list endpoints (pagination contract)
- **Error Handling** — Standard error responses (error-response contract)

## Requirements Gathering Flow

1. Orchestrator reads all capability files
2. For each capability:
   - Ask the capability's question
   - Record user's answer
   - If enabled, note contracts required
3. After all capabilities asked:
   - Build capability-contract mapping table
   - Derive domain schemas from selected capabilities
   - Present to user for approval
