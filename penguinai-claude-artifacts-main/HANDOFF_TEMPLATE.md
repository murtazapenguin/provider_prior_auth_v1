# Project Handoff

> **Usage:** Copy this template to `HANDOFF.md` in your project root. Each phase agent appends their section.
>
> **Two-Tier Structure:** Each phase has a **Contract Surface** (compact interface for downstream agents) and a **Full Specification** (detailed inventories). See the reading matrix below.

### Agent Reading Matrix

| Agent | Reads Full Spec | Reads Contract Surface Only |
|-------|----------------|---------------------------|
| ui-builder | Phase 0 | — |
| api-builder | Phase 0 | Phase 1 Contract Surface |
| ai-integrator | Phase 0 | Phase 1 + Phase 2 Contract Surfaces |
| integration-tester | — | All Contract Surfaces |
| quality-tester | All phases | — |

---

## Phase 0: Requirements (Orchestrator)

### Contract Surface
- Contracts: [list enabled contracts, e.g., auth-response, error-response, pagination, pdfviewer-data]
- Status enums: [entity] → [statuses with transitions]
- Auth: form-urlencoded + username (default), JWT Bearer token
- API prefix: /api/v1/
- Golden case: data/test_fixtures/golden_case/

### Full Specification

#### Problem Statement
[Describe the problem to be solved]

#### Capabilities Selected
- [ ] PDFViewer - Document viewing with bbox highlighting
- [ ] NERViewer - Named entity recognition visualization
- [ ] OCR - Text extraction from documents
- [ ] LLM Extraction - Structured data extraction
- [ ] Bbox Mapping - Map extracted data to source locations

#### Contracts Required
<!-- Check contracts that apply to this project -->
| Contract | Required | Producer | Notes |
|----------|----------|----------|-------|
| auth-response | Always | api-builder | Login returns access_token |
| error-response | Always | api-builder | {detail: "message"} format |
| pagination | If lists | api-builder | {items, total, page, page_size} |
| case-response | [ ] | api-builder | If case/item detail pages |
| pdfviewer-data | [ ] | api-builder + ai-integrator | If PDFViewer used |
| page-images | [ ] | ai-integrator | **CRITICAL if PDFViewer** |
| bbox-format | [ ] | ai-integrator | If evidence highlighting |
| extraction-result | [ ] | ai-integrator | If AI extraction |
| websocket-messages | [ ] | api-builder | If real-time updates |

#### User Roles
| Role | Permissions |
|------|-------------|
| [role] | [can_view, can_edit, can_approve, etc.] |

#### User Stories
| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-1 | As a [role], I can [action], so that [value] | Given [precondition], When [action], Then [result] |

#### Data Model
| Entity | Fields | Indexes |
|--------|--------|---------|
| WorkItem | id, org_id, title, status, created_at | org_id, status |
| ExtractionResult | id, item_id, extracted_data, bboxes | item_id |

#### Status Enums
| Entity | Statuses | Transitions |
|--------|----------|-------------|
| WorkItem | uploaded → processing → review → completed | uploaded→processing (auto), processing→review (on complete), review→completed (user action) |

#### API Formats
| Endpoint | Method | Request Content-Type | Request Body | Response Content-Type |
|----------|--------|---------------------|--------------|----------------------|
| /api/v1/auth/login | POST | application/x-www-form-urlencoded | `username=string&password=string` | application/json |
| /api/v1/auth/me | GET | - | - | application/json |
| /api/v1/items | GET | - | query: `page, page_size, status` | application/json |

#### Domain Schemas (AI → Storage → API → UI)

**All 3 representations required, all with identical snake_case field names. See `.claude/contracts/storage-format.md` for the pattern.**

##### JSON
```json
{ "replace_with": "concrete JSON for each schema" }
```

##### Pydantic Models
```python
# Complete classes — api-builder copies these exactly
```

##### TypeScript Interfaces
```typescript
// Complete interfaces — ui-builder copies these exactly
// Field names stay snake_case (do NOT convert to camelCase)
```

#### Success Metrics
- [ ] [Measurable criterion 1]
- [ ] [Measurable criterion 2]

---

## Phase 1: Frontend (ui-builder)

### Contract Surface
<!-- Compact: what downstream agents need to know -->
- Routes: /login, /queue, /items/:id
- API calls: POST /api/v1/auth/login (form-urlencoded), GET /api/v1/items (paginated)
- Auth: Bearer token stored as 'access_token' in localStorage
- WebSocket: ws://localhost:8000/ws/{user_id}
- Build: npm run dev → http://localhost:5173

### Full Specification

#### Contracts to Validate
> Read these contracts BEFORE coding: `.claude/contracts/`
- [ ] auth-response.md - AuthContext must expect `access_token`
- [ ] error-response.md - Error handling expects `{detail: "..."}`
- [ ] pagination.md - DataTable expects `{items, total, page, page_size}`
- [ ] pdfviewer-data.md - PDFViewer expects `{files, presigned_urls}` with **page image URLs**
- [ ] extraction-result.md - CriteriaTree expects `{criteria_evaluations, ai_decision}`

#### Screen Inventory
| Route | Component | Purpose |
|-------|-----------|---------|
| /login | LoginPage | User authentication |
| /queue | QueuePage | Document queue with filters |
| /items/:id | ItemPage | Review extracted data |

#### Button Inventory
| Button | Location | Action | API Call | Navigation |
|--------|----------|--------|----------|------------|
| Sign In | /login | Authenticate | POST /api/v1/auth/login | /queue |
| Logout | Header | Clear session | - | /login |

#### User Journeys
**Journey 1: Login → Queue → Review**
1. User navigates to /login
2. Enters credentials, clicks Sign In
3. Redirected to /queue
4. Clicks on item row
5. Navigated to /items/:id
6. Reviews extracted data

#### API Endpoints Required
| Method | Path | Request | Response | Status Codes |
|--------|------|---------|----------|--------------|
| POST | /api/v1/auth/login | form-urlencoded: username, password | {access_token, token_type} | 200, 401 |
| GET | /api/v1/items | - | {items, total, page, page_size} | 200 |

#### Files Created
- `src/App.jsx`
- `src/components/LoginPage.jsx`
- `src/components/QueuePage.jsx`
- `src/services/api.js`

#### Environment Variables
- `VITE_API_BASE_URL`

#### Build Status
- [ ] `npm run build` passes

---

## Phase 2: Backend (api-builder)

### Contract Surface
- Base URL: http://localhost:8000
- Auth endpoint: POST /api/v1/auth/login (form-urlencoded: username, password) → {access_token, token_type}
- List endpoint: GET /api/v1/items → {items, total, page, page_size}
- Error format: {"detail": "message"}
- Seed users: demo@penguinai.co / demo123
- Health: GET /health → {"status": "ok"}

### Full Specification

#### Contracts to Produce
> Read these contracts BEFORE coding: `.claude/contracts/`
- [ ] auth-response.md - Return `access_token` NOT `token`
- [ ] error-response.md - Return `{detail: "..."}` for errors
- [ ] pagination.md - Return `{items, total, page, page_size}` NOT `{items, total, limit}`
- [ ] case-response.md - Case detail response shape
- [ ] pdfviewer-data.md - GET /cases/{id}/pdfs returns page image URLs

#### Contracts to Validate (store/return correctly)
- [ ] bbox-format.md - Store bboxes in canonical format
- [ ] extraction-result.md - Store/return evaluation results

#### Endpoints Implemented
| Method | Path | Auth | Response |
|--------|------|------|----------|
| POST | /api/v1/auth/login | No | {access_token, token_type} |
| GET | /api/v1/items | Yes | {items, total, page, page_size} |

#### Data Models
| Collection | Fields | Indexes |
|------------|--------|---------|
| users | _id, email, hashed_password, org_id, role | email, org_id |
| work_items | _id, title, status, org_id, created_at | org_id, status |

#### Status Enums Used
[Must exactly match Phase 0]

#### Seed Data (Production Pattern)

> See `.claude/skills/backend-guide/SKILL.md` for full seed data pattern.

##### Users (Multi-tenant Required)
| Email | Role | org_id |
|-------|------|--------|
| demo@penguinai.co | reviewer | org_default |
| admin@penguinai.co | admin | org_default |

##### Items with S3 Integration
- Upload PDFs to S3: `{org_id}/cases/{case_id}/{filename}.pdf`
- Generate page images: `{org_id}/cases/{case_id}/pages/{doc_name}/page_{n}.png`
- Store presigned URLs in MongoDB (1-hour expiry, regenerate on access)

##### Golden Case (Required for Testing)
- case_id: `golden_001` (from `data/test_fixtures/golden_case/`)
- Must have: PDF uploaded to S3, page images generated, evaluation with bboxes
- Expected decision: APPROVE (or per expected_output.json)

##### Canonical Bbox Format (3 Fields Only)
> All seeded evaluations MUST include real bboxes. See `.claude/contracts/bbox-format.md`.

```json
{
  "document_name": "medical_record.pdf",
  "page_number": 1,
  "bbox": [[x1, y1, x2, y2, x3, y3, x4, y4]]
}
```

**Note:** Bboxes have 3 fields only. Label/color mapping is handled by frontend.

**Rules for seed data:**
- Criteria with supporting evidence → bboxes MUST have real coordinates
- Criteria with NO evidence (verdict=FALSE) → use `"bboxes": null` or `[]` with `"no_evidence": true`
- Criteria with verdict=TRUE but empty bboxes (this is a bug)
- Missing `org_id` on any document
- Local file paths (must use S3 presigned URLs)
- Hardcoded pixel coordinates (must be 0-1 normalized)

#### Environment Variables
- `MONGODB_URL`
- `JWT_SECRET`
- `REDIS_URL`

#### Files Created
- `backend/app.py`
- `backend/routes/auth_routes.py`
- `backend/models/`

#### Infrastructure
- Backend: http://localhost:8000
- API Docs: http://localhost:8000/docs
- Health: http://localhost:8000/health

#### Server Status
- [ ] Server runs at :8000

---

## Phase 2.5: AI Integration (ai-integrator)

### Contract Surface
- Celery task: process_document (dispatched on upload, returns via WebSocket)
- OCR: Azure Document Intelligence via penguin-ai-sdk
- LLM: {provider} {model} via penguin-ai-sdk (from Phase 0 LLM Configuration)
- Output: ExtractionResult stored in MongoDB with nested evidence + canonical bboxes
- Page images: PDF→PNG uploaded to S3, presigned URLs stored in MongoDB
- Golden case: [case_id] processed with expected results

### Full Specification

#### Contracts to Produce
> Read these contracts BEFORE coding: `.claude/contracts/`
- [ ] **page-images.md** - CRITICAL: Generate PNG images for each PDF page
- [ ] bbox-format.md - Output bboxes in canonical 8-point format
- [ ] extraction-result.md - LLM extraction output structure
- [ ] websocket-messages.md - Progress notification format

#### PAGE IMAGES REQUIREMENT
> **This is the #1 cause of blank PDFViewer issues**

PDFViewer does NOT render raw PDF files. You MUST:
1. Convert each PDF page to PNG (150 DPI minimum)
2. Upload PNGs to S3: `{org_id}/{case_id}/pages/{doc_name}/page_{n}.png`
3. Generate presigned URLs for each page image
4. Return URLs in pdfviewer-data format:
```json
{
  "files": ["document.pdf"],
  "presigned_urls": {
    "document.pdf": {
      "1": "https://s3.../page_1.png",
      "2": "https://s3.../page_2.png"
    }
  }
}
```

#### Pipeline Configuration
| Component | Provider | Model/Config |
|-----------|----------|--------------|
| OCR | Azure Document Intelligence | prebuilt-read |
| LLM | {Phase 0 selected provider} | {Phase 0 selected model} |

#### Extraction Schema (Nested Evidence)
```python
class EvidenceCitation(BaseModel):
    supporting_texts: List[str]  # Array of OCR excerpts
    reasoning: Optional[str] = None
    confidence: float
    bboxes: List[dict]  # Canonical 3-field format

class ExtractedField(BaseModel):
    field_name: str
    value: Any
    evidence: EvidenceCitation  # Nested evidence object
```

#### Celery Task
| Task | Queue | Retry Policy |
|------|-------|--------------|
| process_document | ai_processing | 3 retries, exponential backoff |

#### Bbox Format (3 Fields Only)
Canonical format per `.claude/contracts/bbox-format.md`:
```json
{
  "document_name": "document.pdf",
  "page_number": 1,
  "bbox": [[x1,y1,x2,y2,x3,y3,x4,y4]]
}
```

**Note:** No `label` or `color` fields - frontend handles display mapping.

#### Environment Variables
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `S3_APP_PREFIX`
- `AZURE_OCR_ENDPOINT`
- `AZURE_OCR_SECRET_KEY`

#### Files Created
- `backend/tasks/document_processor.py`
- `backend/services/ai_pipeline.py`

#### Test Results
- [ ] Sample PDF processed end-to-end
- [ ] OCR extracts text
- [ ] LLM extracts structured data
- [ ] Bboxes map to source locations
- [ ] **Page images generated and uploaded to S3**
- [ ] **Presigned URLs return PNG images (not PDF URLs)**

---

## Phase 3: Testing (quality-tester)

### Contract Surface
- All contracts verified against HANDOFF.md schemas
- All buttons from Phase 1 inventory tested in browser
- All workflows from Phase 1 journeys completed end-to-end
- Zero console errors
- Production enforcement grep checks pass
- Final status: PRODUCTION READY / NEEDS FIXES

### Full Specification

#### Contracts to Verify
> Verify ALL contracts are implemented correctly
- [ ] auth-response.md - Login returns `access_token`, stores in localStorage
- [ ] error-response.md - Errors show `detail` message to user
- [ ] pagination.md - Lists paginate correctly with page_size
- [ ] pdfviewer-data.md - **PDF pages render as images (not blank)**
- [ ] page-images.md - **Page images exist in S3, presigned URLs work**
- [ ] bbox-format.md - Click evidence → highlights in PDF
- [ ] extraction-result.md - Results display in UI
- [ ] websocket-messages.md - Real-time progress updates

#### Environment
- Frontend: http://localhost:5173
- Backend: http://localhost:8000

#### Code Review
- Issues found: [count]
- Issues fixed: [count]
- Build status: [Passing/Failing]

#### Production Verification
- grep TODO: [count] results
- grep FIXME: [count] results
- grep mock: [count] results

#### Button Tests
| Button | Location | Tested | Works |
|--------|----------|--------|-------|
| Sign In | /login | Yes | Yes |

#### Workflow Tests
| Workflow | Steps | Status | Issues |
|----------|-------|--------|--------|
| Login | 3 | Pass | None |

#### API Integration
| Endpoint | Called By | Status |
|----------|-----------|--------|
| POST /api/v1/auth/login | LoginPage | Working |

#### Contract Verification Results
| Contract | Status | Issue (if any) |
|----------|--------|----------------|
| auth-response | [ ] | - |
| error-response | [ ] | - |
| pagination | [ ] | - |
| pdfviewer-data | [ ] | - |
| page-images | [ ] | - |
| bbox-format | [ ] | - |
| extraction-result | [ ] | - |

#### Console Errors
- [List or "None"]

#### Issues Found and Fixed
- [List of fixes]

#### Remaining Issues
- [List or "None"]

#### Final Status
**[PRODUCTION READY / NEEDS FIXES]**
