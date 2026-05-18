# Phase 0: Requirements Gathering

---

## 1. Dynamic Capability Selection

**IMPORTANT:** Before spawning any subagent, gather requirements by selecting from available capabilities.

### How It Works

```
Read .claude/capabilities/*.md → Present to user → User selects → Derive contracts → Derive schemas → Write to HANDOFF.md
```

### Capability Registry

Available capabilities are defined in `.claude/capabilities/` folder. Each capability file specifies:
- Question to ask the user
- Contracts required when enabled
- Schema fields to add
- API endpoints needed
- UI components needed

### Process

1. **Read all capability files** from `.claude/capabilities/`
2. **For each capability**, ask its question to the user
3. **Record which capabilities are enabled** based on user answers
4. **Derive contracts** from enabled capabilities
5. **Derive domain schemas** by applying contract templates to the problem domain
6. **Get user approval** on capabilities + contracts + schemas
7. **Write to HANDOFF.md**

### Available Capabilities

| Capability | File | Key Question |
|------------|------|--------------|
| document_processing | `document-processing.md` | "Will users view documents?" |
| evidence_display | `evidence-display.md` | "Should users see where data came from?" |
| ai_extraction | `ai-extraction.md` | "What should AI extract/evaluate?" |
| realtime_status | `realtime-status.md` | "Show real-time progress?" |
| async_processing | `async-processing.md` | "Run processing in background?" |
| file_storage | `file-storage.md` | "Will users upload files?" |
| editable_results | `editable-results.md` | "Can users edit AI results?" |
| workflow | `workflow.md` | "What's the item workflow?" |
| rbac | `rbac.md` | "What user roles are needed?" |

### Example Flow

```
User: "Build me a medical coding app"

1. Read capabilities → 7 available
2. Ask: "Will users view documents?" → Yes (PDFs)
   → Enable: document_processing
   → Contracts: pdfviewer-data, page-images

3. Ask: "Should users see where data came from?" → Yes
   → Enable: evidence_display
   → Contracts: bbox-format, evidence-citation

4. Ask: "What should AI extract?" → "ICD codes, diagnosis"
   → Enable: ai_extraction
   → Contracts: extraction-result

5. Continue for all capabilities...

6. Build capability-contract mapping table
7. Derive domain schemas from selected capabilities
8. Get user approval
9. Write to HANDOFF.md
```

See `.claude/capabilities/README.md` for full documentation.

---

## 1b. Derive Domain Schemas, API Formats, and Data Types

After capability selection, the orchestrator MUST derive concrete specs before writing HANDOFF.md.

### Step 1: Derive Domain Schemas

For each enabled capability, apply the contract template to the problem domain:

1. Read the contract file (e.g., `.claude/contracts/extraction-result.md`)
2. Replace generic field names with domain-specific ones
3. Write out the complete JSON with real example values
4. Verify the zero-transform rule: AI output = MongoDB storage = API response = UI props

**Required schemas** (based on enabled capabilities):

| If Capability Enabled | Schema Required |
|-----------------------|-----------------|
| Always | `ItemListResponse` — paginated list |
| Always | `ItemDetailResponse` — single item detail |
| `ai_extraction` | `ExtractionResultResponse` — AI output structure |
| `document_processing` | `PDFViewerDataResponse` — document viewer data |
| `evidence_display` | `EvidenceCitation` — evidence with bboxes |
| `realtime_status` | `WebSocketMessage` — real-time update format |
| `editable_results` | `EditRequest` / `EditResponse` — edit payloads |

### Step 2: Derive API Formats

For each enabled capability, read its "API Formats" section from `.claude/capabilities/`:

1. Extract the endpoint, method, request content-type, request fields, response content-type
2. Build the API Formats table
3. Lock it in HANDOFF.md — subagents copy from HANDOFF.md, never invent formats

**Default auth format** (unless user specifies otherwise):

| Endpoint | Method | Request Content-Type | Request Body |
|----------|--------|---------------------|--------------|
| /api/v1/auth/login | POST | application/x-www-form-urlencoded | `username=string&password=string` |

### Step 3: Derive Data Types

For each schema, create BOTH representations:

1. **Pydantic model** (Python) — used by api-builder
2. **TypeScript interface** — used by ui-builder

Field names, types, and optionality MUST match exactly between all three representations (JSON schema, Pydantic, TypeScript).

### Step 4: Write to HANDOFF.md Phase 0

HANDOFF.md Phase 0 must contain:
- Concrete JSON for every required schema
- API Formats table with content-type and field names for every endpoint
- Pydantic models (complete Python classes)
- TypeScript interfaces (complete TS interfaces)

**This is BLOCKING — do not enter plan mode until schemas are written and user-approved.**

---

## 1c. Derive Test Matrix from User Stories

After user stories are written and approved, the orchestrator MUST derive a **test matrix** before writing HANDOFF.md Phase 0. This follows the progressive discovery pattern:

```
Capabilities → Contracts → Schemas → User Stories → Test Matrix → HANDOFF.md → Subagents
```

### Why This Step Exists

Without an explicit test matrix:
- The quality-tester invents tests ad-hoc based on what code it finds
- Test coverage is inconsistent — some stories tested, others missed
- No traceability from requirement → test → verification
- Bugs hide in untested user stories

With a test matrix:
- Every user story has at least one test case
- Every test case traces back to a user story (US-ID)
- The quality-tester becomes a **verifier** of defined expectations, not an explorer
- Gaps are visible: a story with no test is a gap; a test with no story is scope creep

### Process

1. **For each user story**, derive 1-N test cases from its acceptance criteria
2. **Classify each test** by type: API, UI, E2E (end-to-end browser), or Contract
3. **Identify test data** — which test fixture (golden_case, edge_case_empty, etc.) each test uses
4. **Write the test matrix** table in HANDOFF.md Phase 0
5. **Get user approval** on the test matrix (part of Phase 0 approval)

### Test Matrix Format

```markdown
#### Test Matrix

| TC-ID | US-ID | Test Case | Type | Steps | Expected Result | Test Data |
|-------|-------|-----------|------|-------|-----------------|-----------|
| TC-1 | US-1 | Login with valid credentials | E2E | POST /auth/login with demo creds | 200 + {access_token, token_type}, redirect to dashboard | demo@penguinai.co / demo123 |
| TC-2 | US-1 | Login with invalid credentials | API | POST /auth/login with wrong password | 401 + {detail: "..."} | bad creds |
| TC-3 | US-2 | Dashboard shows cases with status | E2E | GET /cases after login | Table with case rows, status badges, sorted by date | golden_case |
| TC-4 | US-3 | Create new case | E2E | Fill CPT/LOB, upload PDF, click Review | Case created, status=uploading, redirect to case | test PDF |
| TC-5 | US-5 | Criteria tree renders with verdicts | E2E | View ready_for_review case | Tree nodes with TRUE/FALSE badges, evidence sections | golden_case |
```

### Test Type Definitions

| Type | What It Tests | Who Runs It | Tools |
|------|---------------|-------------|-------|
| **API** | Backend endpoint returns correct shape/status | integration-tester, quality-tester | curl/httpx |
| **UI** | Component renders correctly, buttons visible | quality-tester | Playwright MCP |
| **E2E** | Full user journey across frontend + backend | quality-tester | Browser + API |
| **Contract** | Data format matches HANDOFF.md schema | integration-tester | HTTP assertions |

### Rules

1. **Every user story MUST have at least one test case.** If a story has no TC, that's a gap — add one.
2. **Test cases MUST reference test data.** No invented/mock data — use golden_case, edge_case_empty, or user-provided fixtures.
3. **E2E tests follow the acceptance criteria verbatim.** The "Given/When/Then" from the user story becomes the test steps.
4. **Negative tests are encouraged.** For each happy path, consider: what happens with bad input, missing data, unauthorized access?
5. **The test matrix is a contract.** The quality-tester reads it as input and executes every row. It does not invent additional tests unless it finds untested functionality.

### Integration with Quality-Tester

The quality-tester agent:
1. Reads HANDOFF.md Phase 0 → extracts the test matrix
2. Uses TC rows as the primary test backlog (instead of inventing tests)
3. Executes each TC, recording PASS/FAIL
4. Reports results in Phase 3 referencing TC-IDs
5. If it discovers untested functionality during execution, it adds new TC rows and flags them as "discovered"

### Integration with Integration-Tester

The integration-tester agent:
1. Reads HANDOFF.md Phase 0 → extracts TC rows where Type = API or Contract
2. Uses these as its test assertions (in addition to contract-driven checks)
3. Reports results referencing TC-IDs

---

## 1d. LLM Schema Requirements (v0.2.0)

**When `ai_extraction` capability is selected, ALL extraction schemas MUST include line-number-based evidence fields.**

### Why This Section Exists

penguin-ai-sdk v0.2.0 provides line-number-based bbox retrieval which requires LLMs to cite line numbers from the `full_text` format. This section ensures orchestrators and agents design LLM schemas correctly from Phase 0.

### Schema Pattern

For EACH field requiring evidence, include these 4 fields:

```python
{field}_line_numbers: List[int]    # OCR line numbers from full_text
{field}_page_numbers: List[int]    # Page numbers for each line
{field}_reasoning: str              # LLM explanation
{field}_confidence: float           # 0.0-1.0 score
```

### Example Schema

```python
# Python (Pydantic)
class CriteriaEvaluation(BaseModel):
    question_id: str
    criteria_text: str
    result: bool

    # Evidence fields (REQUIRED)
    result_line_numbers: List[int] = Field(description="OCR line numbers from full_text")
    result_page_numbers: List[int] = Field(description="Page numbers for each line")
    result_reasoning: str = Field(description="Why this criterion is met/not met")
    result_confidence: float = Field(ge=0.0, le=1.0, description="Confidence 0.0-1.0")

# TypeScript
interface CriteriaEvaluation {
  question_id: string;
  criteria_text: string;
  result: boolean;

  // Evidence fields (REQUIRED)
  result_line_numbers: number[];  // OCR line numbers from full_text
  result_page_numbers: number[];  // Page numbers for each line
  result_reasoning: string;       // Why this criterion is met/not met
  result_confidence: number;      // Confidence 0.0-1.0
}

// JSON (for HANDOFF.md Phase 0)
{
  "question_id": "1.1",
  "criteria_text": "Is skilled nursing medically necessary?",
  "result": true,
  "result_line_numbers": [42, 43],
  "result_page_numbers": [2, 2],
  "result_reasoning": "Found skilled nursing requirement on lines 42-43",
  "result_confidence": 0.95
}
```

### Prompt Requirement

When `ai_extraction` capability is selected, ALL LLM prompts MUST include this instruction:

```
CRITICAL: Cite line numbers where you found each piece of evidence.

The full_text format is "content || line_number" (e.g., "Patient: John Smith || 5").

For EACH extracted field that requires evidence, you MUST provide:
1. {field}_line_numbers: List of line numbers where you found it
2. {field}_page_numbers: List of page numbers for each line
3. {field}_reasoning: Your explanation
4. {field}_confidence: Your confidence score (0.0-1.0)
```

### HANDOFF.md Phase 0 Checklist

When writing HANDOFF.md Phase 0, ensure:

- [ ] ALL extraction schemas include `{field}_line_numbers` and `{field}_page_numbers`
- [ ] ALL three formats (JSON + Pydantic + TypeScript) have identical field names
- [ ] LLM prompt template includes line number citation instruction
- [ ] Example extraction output shows line_numbers and page_numbers populated

### What Happens If You Skip This

- ai-integrator will produce extraction results without line_numbers
- Bbox mapping will fail (no line numbers to map from)
- Evidence will appear without bboxes (empty arrays)
- PDFViewer will not highlight evidence
- quality-tester will fail bbox validation

**This is a BLOCKING requirement for `ai_extraction` capability.**

---

## 2. Environment Variables

### 2.1 Environment Variable Discovery (BLOCKING)

**Before creating new .env files, search for existing credentials:**

```bash
# Search for existing .env files in project and parent directories
find . -name ".env" -type f 2>/dev/null
find .. -name ".env" -type f 2>/dev/null
find ../.. -name ".env" -type f 2>/dev/null

# Also check for .env.example, .env.local, etc.
find ../.. -name ".env*" -type f 2>/dev/null
```

**If .env files found:**
1. Read the contents
2. List found credentials to user:
   > "Found existing .env at `{path}` with:
   > - AWS credentials: ✅
   > - Azure OCR: ✅
   > - MongoDB: ✅
   > - JWT_SECRET: ❌ (will generate)
   >
   > Should I use these for the new project?"
3. After user confirms, copy relevant credentials to project .env files
4. Generate any missing required credentials (e.g., JWT_SECRET)

**If NO .env files found:**
- Ask user to provide credentials
- Or note which features will be unavailable without them

### 2.2 Required Variables by Feature

Collect after contract questions:

| Category | Variables | Required When |
|----------|-----------|---------------|
| **Database** | `MONGODB_URL` | Always |
| **Cache** | `REDIS_URL` | If async processing |
| **AWS Core** | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | If `file_storage`, `document_processing`, or LLM provider is `bedrock` |
| **S3 Bucket** | `S3_BUCKET_NAME` (default: `workflow-builder-platform-backend-uploads`) | If `file_storage` or `document_processing` capability |
| **S3 App Prefix** | `S3_APP_PREFIX` | If `file_storage` or `document_processing` capability |
| **OCR** | `AZURE_OCR_ENDPOINT`, `AZURE_OCR_SECRET_KEY` | If document processing |
| **LLM** | Depends on user-selected provider (see below) | If AI extraction |

**LLM Environment Variables (by provider — ask user during Phase 0):**

| Provider | Required Env Vars |
|----------|-------------------|
| `bedrock` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `BEDROCK_REGION` |
| `gemini` | `GOOGLE_API_KEY` |
| `openai` | `OPENAI_API_KEY` |
| `azure_openai` | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY` |

**IMPORTANT:** The orchestrator MUST ask the user which LLM provider/model to use when `ai_extraction` is enabled (see `.claude/capabilities/ai-extraction.md`). Do NOT assume Bedrock or any other provider.

> **Bedrock Inference Profiles:** When user selects Bedrock, ask for the **full inference profile ID** (e.g., `us.anthropic.claude-sonnet-4-5-20250929-v1:0`), not a raw model ID. Raw model IDs like `anthropic.claude-3-5-sonnet-20241022-v2:0` require provisioned throughput and will fail with `ValidationException` on on-demand invocation. Record the inference profile ID in `PENGUIN_LLM_MODEL` env var.
| **Auth** | `JWT_SECRET` | Always (auto-generate OK) |

### 2.3 Single .env File (Project Root)

**All credentials go in ONE file at project root.** Backend config.py reads from parent directories automatically.

```bash
# Create/update PROJECT_ROOT/.env (NOT backend/.env)
cat >> .env << 'EOF'
# === Project Configuration ===

# Database
MONGODB_URL=mongodb://localhost:27017/app_db
REDIS_URL=redis://localhost:6379

# Auth
JWT_SECRET=$(openssl rand -hex 32)

# AWS (for S3 storage)
AWS_ACCESS_KEY_ID=<from_existing_or_user>
AWS_SECRET_ACCESS_KEY=<from_existing_or_user>
S3_BUCKET_NAME=workflow-builder-platform-backend-uploads
S3_APP_PREFIX=<app_name>  # Per-app folder prefix within the shared bucket

# Azure OCR
AZURE_OCR_ENDPOINT=<endpoint>
AZURE_OCR_SECRET_KEY=<key>

# LLM (provider-specific — set based on user selection in Phase 0)
# If bedrock: AWS creds above are sufficient + BEDROCK_REGION
# If gemini: GOOGLE_API_KEY=your-key
# If openai: OPENAI_API_KEY=your-key
# If azure_openai: AZURE_OPENAI_ENDPOINT=... AZURE_OPENAI_API_KEY=...
PENGUIN_LLM_PROVIDER=<user_selected_provider>
PENGUIN_LLM_MODEL=<user_selected_model>
EOF
```

**Backend reads from project root automatically:**
```python
# backend/config.py loads .env from parent directories
PROJECT_ROOT = Path(__file__).parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env")
```

**NO NEED to copy credentials to backend/.env.**

---

## 3. Contract Selection (Phase 0)

The orchestrator MUST select applicable contracts based on the problem statement capabilities.

### Keyword → Contract Mapping

| Problem Keywords | Contracts Required |
|------------------|-------------------|
| "PDF", "document", "viewer" | pdfviewer-data, page-images |
| "highlight", "evidence", "source" | bbox-format |
| "OCR", "extract", "scanned" | page-images |
| "AI", "LLM", "extraction" | extraction-result, bbox-format |
| "real-time", "progress", "status" | websocket-messages |
| "list", "queue", "dashboard" | pagination |
| "login", "auth" | auth-response, error-response |

### Document in HANDOFF.md Phase 0

```markdown
### Contracts Required
| Contract | Required | Reason |
|----------|----------|--------|
| auth-response | ✅ | App has login |
| pdfviewer-data | ✅ | Document viewing needed |
| page-images | ✅ | **PDFViewer requires PNG pages** |
| bbox-format | ✅ | Evidence highlighting |
```

### Common Patterns

- **Document Processing App** (medical coding, invoice): ALL contracts
- **Simple CRUD App**: auth-response, error-response, pagination
- **Dashboard/Analytics**: auth-response, pagination, websocket-messages (if real-time)

### Critical Contract: page-images (if `document_processing` capability)

> **Most Common Failure Mode:** If PDFViewer shows blank pages, the page-images contract was not fulfilled.
>
> If `document_processing` capability selected: ai-integrator MUST generate PNG images during OCR. PDFViewer does NOT render raw PDF files.

---

## 4. Orchestrator Plan Mode (MANDATORY)

Before gathering requirements, the orchestrator MUST:

1. **Enter plan mode**
2. **Create Phase 0 task backlog:**

```markdown
## Orchestrator Task Backlog

### Requirements Gathering
- [ ] Capture problem statement
- [ ] Ask clarification questions (Section 1)
- [ ] Collect environment variables
- [ ] Map capabilities to contracts

### Design
- [ ] Define user roles
- [ ] Write user stories with acceptance criteria
- [ ] **Derive test matrix from user stories** (Section 1c)
- [ ] Design data model
- [ ] Define status enums
- [ ] Select required contracts

### Setup
- [ ] Copy HANDOFF_TEMPLATE.md to project
- [ ] Verify infrastructure (Phase 0.5)
- [ ] Create .env file
- [ ] Create test fixtures (golden_case)

### Documentation
- [ ] Write Phase 0 in HANDOFF.md
- [ ] Document contracts required
- [ ] Get user approval
```

3. **Get user approval on plan**
4. **Execute tasks in order**

---

## 5. Orchestrator Checklist (before spawning agents)

**Requirements Gathering:**
- [ ] Problem statement captured
- [ ] Read capabilities from `.claude/capabilities/`
- [ ] Asked capability questions, mapped to contracts

**Environment Variable Discovery (BLOCKING):**
- [ ] Searched for existing .env files: `find ../.. -name ".env" -type f`
- [ ] Listed found credentials to user
- [ ] **User approved** using existing credentials OR provided new ones
- [ ] Copied credentials to project .env files
- [ ] Generated missing required credentials (JWT_SECRET, etc.)

**AWS/S3 Validation (BLOCKING — if `file_storage`, `document_processing`, or LLM provider is `bedrock`):**
- [ ] Verified `AWS_ACCESS_KEY_ID` exists in .env
- [ ] Verified `AWS_SECRET_ACCESS_KEY` exists in .env
- [ ] If `file_storage` or `document_processing`: Verified `S3_APP_PREFIX` exists in .env
- [ ] If `file_storage` or `document_processing`: Verified `S3_APP_PREFIX` exists in .env
- [ ] **AWS/S3 VALIDATION PASSED** - only then proceed to spawn agents

**Schema Definition (BLOCKING):**
- [ ] **DOMAIN SCHEMAS DERIVED** with concrete JSON
- [ ] All required schemas documented in HANDOFF.md:
  - [ ] `ItemListResponse` (paginated list)
  - [ ] `ItemDetailResponse` (single item)
  - [ ] `ExtractionResultResponse` (if ai_extraction)
  - [ ] `PDFViewerDataResponse` (if document_processing)
  - [ ] `EvidenceCitation` (if evidence_display)
  - [ ] `WebSocketMessage` (if realtime_status)
- [ ] Schemas verified identical: AI output = Storage = API response = UI props
- [ ] **USER APPROVED schemas**

**Design:**
- [ ] User roles defined
- [ ] User stories with acceptance criteria
- [ ] **Test matrix derived from user stories** (every US has ≥1 TC)
- [ ] Data model defined (uses approved schemas)
- [ ] Status enums defined
- [ ] **Contracts table added to Phase 0**

**Setup:**
- [ ] Test fixtures created (golden_case)
- [ ] **Infrastructure verified** (Phase 0.5)
- [ ] **Plan mode completed with approved backlog**

**Final Gate:**
- [ ] **USER APPROVED Phase 0**
- [ ] HANDOFF.md written with all schemas
- [ ] **ONLY NOW spawn subagents**

> **If the user provides their own workflow, data model, or screen specs, use those directly instead of designing from scratch.**

---

## 6. Test Fixtures (MANDATORY in Phase 0)

The orchestrator MUST create test fixtures before spawning any agent. The fixture structure varies by app type.

**Example for document processing apps:**

```
data/test_fixtures/
├── golden_case/                    # Case with KNOWN expected output
│   ├── input/                      # PDFs with actual content
│   │   └── medical_record.pdf      # Must have >10KB of text
│   ├── expected_output.json        # Expected evaluation results
│   └── README.md                   # What this fixture tests
├── edge_case_empty/                # Case with no evidence (should DENY)
└── edge_case_partial/              # Case with partial evidence
```

**For non-document apps**, fixture structure depends on the domain — e.g., JSON payloads, seed database records, API request/response pairs.

**expected_output.json must include** (adapt fields per domain):
- `expected_decision`: APPROVE | DENY (or domain-equivalent)
- `min_citations`: minimum citation count (if `evidence_display`)
- `min_criteria_with_evidence`: minimum criteria with supporting text (if `ai_extraction`)

**Phase 0 is NOT complete until test fixtures are defined and approved.**
