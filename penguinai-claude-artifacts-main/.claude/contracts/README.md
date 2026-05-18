# Integration Contracts

Contracts define data formats that flow between agents. There are two types:

1. **Fixed Contracts** - Library requirements (e.g., PDFViewer), always the same
2. **Derived Contracts** - Generated from user answers, written to HANDOFF.md per project

## Contract Types

### Fixed Contracts (Library Requirements)

These contracts are **fixed** because they match the requirements of reusable libraries (PDFViewer, auth system). They are the same for every project that uses these libraries.

| Contract | Why Fixed | Library |
|----------|-----------|---------|
| [bbox-format](./bbox-format.md) | PDFViewer expects this exact format | data-labelling-library |
| [pdfviewer-data](./pdfviewer-data.md) | PDFViewer expects this structure | data-labelling-library |
| [evidence-citation](./evidence-citation.md) | Base evidence format with bboxes | data-labelling-library |
| [storage-format](./storage-format.md) | Zero-transform storage rule | MongoDB |
| [auth-response](./auth-response.md) | Auth system expects this format | platform-backend-kit |
| [error-response](./error-response.md) | Error handling expects this | platform-backend-kit |
| [pagination](./pagination.md) | DataTable expects this format | Standard_UI_Template |

### Derived Contracts (Per-Project)

These contracts are **derived from user answers** during Phase 0 questionnaire and written to HANDOFF.md. They vary per project.

| What | Derived From | Written To |
|------|--------------|------------|
| `extracted_fields[]` schema | "What fields to extract?" | HANDOFF.md |
| Status enums | "What can users do?" | HANDOFF.md |
| API endpoints | UI requirements | HANDOFF.md |
| Domain-specific data | Problem statement | HANDOFF.md |

**See:** `.claude/orchestrator/requirements.md` for how user answers derive contracts.

### Generic Templates

These templates define the STRUCTURE but NOT the specific fields. Domain fields are derived from user answers during Phase 0.

| Template | Description |
|----------|-------------|
| [extraction-result](./extraction-result.md) | Generic structure for AI extraction output |
| work-item-response | Generic structure for work items (defined in HANDOFF.md per project) |

**How domain fields are added:**
1. Orchestrator asks "What fields to extract?" during Phase 0
2. User answers (e.g., "ICD codes, CPT codes, diagnosis")
3. These become `extracted_fields[].field_name` values
4. Written to HANDOFF.md, NOT as separate contract files

## How Contracts Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  Phase 0: Orchestrator                                          │
│                                                                  │
│  1. Ask user questions (orchestrator/requirements.md)            │
│  2. Derive contracts from answers                               │
│  3. Write derived contract to HANDOFF.md                        │
│  4. Fixed contracts (bbox-format, etc.) apply automatically     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
         ┌────────────────────┴────────────────────┐
         ↓                                         ↓
┌─────────────────┐                    ┌─────────────────┐
│  HANDOFF.md     │                    │  Fixed Contracts │
│  (derived)      │                    │  (this folder)   │
│                 │                    │                  │
│  - fields       │                    │  - bbox-format   │
│  - statuses     │                    │  - pdfviewer     │
│  - endpoints    │                    │  - evidence      │
└────────┬────────┘                    └────────┬─────────┘
         │                                      │
         └──────────────┬───────────────────────┘
                        ↓
              ┌─────────────────┐
              │  All Agents     │
              │  Read Both      │
              │                 │
              │  ui-builder     │
              │  api-builder    │
              │  ai-integrator  │
              └─────────────────┘
```

## Data Flow Diagram

```
┌─────────────┐
│ Orchestrator│
│  (Phase 0)  │
└──────┬──────┘
       │ problem-statement, data-model
       ▼
┌─────────────┐
│ ui-builder  │ ◄─── Consumes: (none from other agents)
│  (Phase 1)  │ ───► Produces: api-endpoints-required (in HANDOFF.md)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ api-builder │ ◄─── Consumes: api-endpoints-required
│  (Phase 2)  │ ───► Produces: auth-response, error-response, pagination,
└──────┬──────┘               case-response, websocket-messages
       │
       ▼
┌──────────────┐
│ai-integrator │ ◄─── Consumes: (HANDOFF.md data model)
│ (Phase 2.5)  │ ───► Produces: page-images, evidence-citation, extraction-result
└──────┬───────┘
       │
       ▼
┌──────────────┐
│quality-tester│ ◄─── Consumes: ALL contracts (validates everything)
│  (Phase 3)   │ ───► Produces: test-report (in HANDOFF.md)
└──────────────┘
```

## Zero-Transform Storage Rule

The `storage-format` contract ensures data flows without transformation:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  ai-integrator  │────>│    MongoDB      │────>│   api-builder   │────>│   ui-builder    │
│                 │     │                 │     │                 │     │                 │
│  produces:      │     │  stores:        │     │  returns:       │     │  receives:      │
│  {              │     │  {              │     │  {              │     │  {              │
│    bboxes: []   │ === │    bboxes: []   │ === │    bboxes: []   │ === │    bboxes: []   │
│  }              │     │  }              │     │  }              │     │  }              │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │                       │
        └───────────────────────┴───────────────────────┴───────────────────────┘
                              IDENTICAL FORMAT THROUGHOUT
```

**Rules:**
- MongoDB stores data in EXACT format AI produces
- api-builder returns data AS-IS (only removes `_id`)
- No field renaming (e.g., `supporting_texts` stays `supporting_texts`)
- No array serialization (arrays stay arrays)
- No structure changes (nested objects stay nested)

See [storage-format.md](./storage-format.md) for details.

## Agent → Contract Mapping

### ui-builder
```yaml
consumes: []  # No runtime contracts, uses HANDOFF.md
produces: []  # Produces HANDOFF.md Phase 1, not runtime contracts
validates:
  - auth-response      # Must match AuthContext expectations
  - error-response     # Must match error handling
  - pagination         # Must match DataTable expectations
  - pdfviewer-data     # Must match PDFViewer props
  - extraction-result  # Must match results display
  - evidence-citation  # Must match evidence display
```

### api-builder
```yaml
consumes:
  - (HANDOFF.md Phase 1)  # API endpoints required
produces:
  - auth-response
  - error-response
  - pagination
  - pdfviewer-data
  - websocket-messages
validates:
  - storage-format       # Must store in consumer-ready format
  - extraction-result    # Must return correctly
```

### ai-integrator
```yaml
consumes:
  - (HANDOFF.md data model)  # Reads item data from Phase 0
produces:
  - page-images          # Generates during OCR
  - evidence-citation    # Evidence with bboxes
  - extraction-result    # LLM output
  - websocket-messages   # Progress updates
validates:
  - storage-format       # Output must be storage-compatible
```

### quality-tester
```yaml
consumes:
  - ALL contracts        # Tests everything
produces: []
validates:
  - auth-response        # Login works
  - error-response       # Errors display correctly
  - pagination           # Lists paginate
  - pdfviewer-data       # PDFs display
  - evidence-citation    # Evidence highlights
  - extraction-result    # Results display
  - websocket-messages   # Real-time updates work
```

## Using Contracts in Agent Definitions

Agent markdown files should reference contracts in frontmatter:

```yaml
---
name: ai-integrator
phase: 2.5

contracts:
  produces:
    - page-images
    - evidence-citation
    - extraction-result
  consumes:
    - (HANDOFF.md data model)
  validates:
    - storage-format
---
```

When an agent starts, it should:
1. Load its consumed contracts
2. Validate inputs match contract schema
3. Produce outputs matching contract schema
4. Run contract validation tests

## Validation Script

Use the contract validation script to verify implementations:

```bash
# Install dependencies
pip install httpx

# Validate Phase 2 contracts (api-builder output)
python .claude/scripts/validate_contracts.py --phase 2 --backend-url http://localhost:8000

# Validate Phase 2.5 contracts (ai-integrator output)
python .claude/scripts/validate_contracts.py --phase 2.5 --backend-url http://localhost:8000 --case-id your_case_id

# Validate all contracts
python .claude/scripts/validate_contracts.py --all --backend-url http://localhost:8000 --case-id your_case_id
```

### Sample Output

```
=== Phase 2 Contract Validation ===

✅ PASS auth-response: Login returns correct access_token and user format
✅ PASS error-response: Error responses use {detail: '...'} format
✅ PASS pagination: Pagination uses correct {items, total, page, page_size} format

=== Phase 2.5 Contract Validation ===

✅ PASS pdfviewer-data: PDFViewer data has correct {files, presigned_urls} structure
❌ FAIL bbox-format: No bboxes found in results - extraction should include evidence locations
✅ PASS extraction-result: Extraction results use correct format

==================================================
VALIDATION SUMMARY
==================================================

✅ Passed:  5
❌ Failed:  1
⏭️ Skipped: 0

--- FAILURES ---

bbox-format:
  No bboxes found in results - extraction should include evidence locations
  hint: Empty bboxes arrays are forbidden per contract
```

## Integration Tests

Each contract also has corresponding integration tests:

```python
# tests/integration/test_contracts.py

def test_auth_response_contract():
    """Verify login response matches auth-response contract."""
    # MUST use form-urlencoded with 'username' field, NOT JSON with 'email'
    form_data = {'username': 'test@example.com', 'password': 'testpass'}
    response = api.post('/auth/login', data=form_data)

    # From auth-response.md
    assert 'access_token' in response
    assert response['token_type'] == 'bearer'

def test_pdfviewer_data_contract():
    """Verify PDFs endpoint matches pdfviewer-data contract."""
    response = api.get(f'/cases/{case_id}/pdfs')

    # From pdfviewer-data.md
    assert 'files' in response
    assert 'presigned_urls' in response

    # Verify page URLs are PNG images (not PDFs)
    for doc, pages in response['presigned_urls'].items():
        for page_num, url in pages.items():
            assert '.png' in url.lower() or 'image' in requests.head(url).headers.get('content-type', '')
```

## Field Name Consistency Matrix

All field names are **snake_case** and IDENTICAL across the entire pipeline:

### AI → API → UI Data Flow

| Field | ai-integrator | MongoDB | api-builder | ui-builder | Status |
|-------|---------------|---------|-------------|------------|--------|
| `supporting_texts` | produces `string[]` | stores as-is | returns as-is | displays | ✓ |
| `reasoning` | produces `string` | stores as-is | returns as-is | displays | ✓ |
| `confidence` | produces `float` | stores as-is | returns as-is | displays | ✓ |
| `bboxes` | produces `array` | stores as-is | returns as-is | passes to PDFViewer | ✓ |
| `bboxes[].document_name` | `string` | `string` | `string` | matches `files[]` | ✓ |
| `bboxes[].page_number` | `int` | `int` | `int` | `number` | ✓ |
| `bboxes[].bbox` | `float[][]` | `float[][]` | `float[][]` | renders highlight | ✓ |

### PDFViewer Data Flow

| Field | ai-integrator | MongoDB | api-builder | PDFViewer prop | Status |
|-------|---------------|---------|-------------|----------------|--------|
| `files` | generates list | stores `document_names` ¹ | returns `files` ¹ | `documentData.files` | ✓ |
| `presigned_urls` | generates URLs | stores `page_urls` ¹ | returns `presigned_urls` ¹ | `documentData.presigned_urls` | ✓ |
| `presigned_urls[file][page]` | `string` URL | `string` URL | `string` URL | `<img src={...}>` | ✓ |

¹ **Intentional exception to zero-transform rule:** `document_names` → `files` and `page_urls` → `presigned_urls` rename happens at the API layer because PDFViewer expects specific prop names. This is the ONLY permitted field rename. See [storage-format.md](./storage-format.md) Exceptions section.

### Auth & List Data Flow

| Field | api-builder | ui-builder | Status |
|-------|-------------|------------|--------|
| `access_token` | returns JWT | stores in localStorage | ✓ |
| `token_type` | returns "bearer" | attaches to requests | ✓ |
| `items` | returns array | renders in DataTable | ✓ |
| `total` | returns count | shows total | ✓ |
| `page` | returns current | controls pagination | ✓ |
| `page_size` | returns size | NOT `limit` | ✓ |

### Field Naming Rules

1. **Always snake_case** - Never camelCase (`supporting_texts` not `supportingTexts`)
2. **Arrays stay arrays** - Never serialize to JSON strings
3. **Nested objects stay nested** - Never flatten (`evidence.bboxes` not `evidence_bboxes`)
4. **Types preserved** - `page_number` is INTEGER in bboxes; presigned_urls keys are strings (JSON requirement)

## Common Contract Violations

| Violation | Contract | Fix |
|-----------|----------|-----|
| Login returns `token` instead of `access_token` | auth-response | Change field name in auth response |
| List returns `limit` instead of `page_size` | pagination | Update pagination parameters |
| PDFViewer shows blank pages | pdfviewer-data, page-images | Generate PNG page images during OCR |
| Clicking evidence doesn't highlight | bbox-format | Ensure bboxes use canonical 8-point format |
| page_number is 0-indexed | bbox-format | Change to 1-indexed |
| Empty bboxes array | bbox-format | Map OCR lines to extraction results |
| `supporting_text` (singular) | evidence-citation | Use `supporting_texts` (plural array) |
| `files` as array of objects | pdfviewer-data | Use string array |
| Frontend transforms data | storage-format | API must return consumer-ready format |

---

## Platform Starter Kit Notes

Important implementation details that affect how contracts map to actual code:

### Two User Models

The platform-backend-kit defines two different `User` models with overlapping but different fields:

| Model | Location | Key Differences |
|-------|----------|-----------------|
| `User` in `auth.py` | `platform-backend-kit/auth.py` | Has `preferred_username`, `entities`, `full_name` |
| `User` in `models.py` | `platform-backend-kit/models.py` | Has `permissions` dict (`Dict[str, Dict[str, Dict[str, int]]]`) |

Both share `username`, `roles`, `org_name`, `short_org_name`, `bucket_name`. When building new projects, check which model the auth middleware returns and ensure your code handles its specific fields.

### Two JWT Systems

| System | Module | Token Contents | Used By |
|--------|--------|---------------|---------|
| Global secret | `auth.py` | `sub` + `exp` only | `/auth/login`, `/auth/admin-login` |
| Per-org secret | `jwt_handler.py` | Full user data + `exp`, `iat`, `aud`, `iss` | `/auth/basic_auth`, `/auth/getToken` |

See [auth-response.md](./auth-response.md) for the full login endpoint table.

### S3 Utils Are Synchronous — Must Use `asyncio.to_thread()`

`platform-backend-kit/app/modules/storage/service.py` provides `StorageService` with presigned URL flows (`generate_upload_url()`, `confirm_upload()`, `generate_download_url()`). It uses `boto3` (synchronous). For server-side uploads (e.g., page image generation), use direct `boto3.client("s3")` with settings from `app.config.get_settings()`.

**ASYNC RULE:** In `async def` functions (FastAPI handlers, async helpers), wrap ALL boto3 calls in `await asyncio.to_thread()` to avoid blocking the event loop. In synchronous Celery tasks, call boto3 directly.

### OCR Page Number Convention

OCR results use `page_no` internally. The `evidence_bbox_utils.py` utility converts this to `page_number` (matching the bbox-format contract) in its output. See [bbox-format.md](./bbox-format.md) Producer Note section.
