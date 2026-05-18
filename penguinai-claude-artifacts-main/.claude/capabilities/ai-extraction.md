# Capability: ai_extraction

## Description
AI extracts or evaluates data from documents using LLM. Results are structured based on problem domain (fields, criteria, etc.).

## Question
"What should be extracted or evaluated by AI?"

## Options
User provides domain-specific list, e.g.:
- Field extraction: "patient_name, date_of_service, diagnosis_codes"
- Criteria evaluation: "criteria tree with verdicts"
- Classification: "document type, sentiment"

## Contracts Required
- `extraction-result` — Generic extraction output template

## Schema Fields
When enabled, define domain-specific extraction schema:

```python
# Generic template - customize per project
extracted_fields: list[dict]    # Array of extracted field objects

# Per field
field_name: str                 # Schema field identifier
value: any                      # Extracted value
evidence: EvidenceCitation      # If evidence_display enabled
```

## API Endpoints
When enabled, implement:

| Method | Endpoint | Response Contract |
|--------|----------|-------------------|
| GET | `/api/v1/{items}/{id}/results` | extraction-result |
| POST | `/api/v1/{items}/{id}/process` | Trigger AI processing |

## API Formats

| Endpoint | Method | Request Content-Type | Request Fields | Response Content-Type |
|----------|--------|---------------------|----------------|----------------------|
| `/api/v1/{items}/{id}/results` | GET | - | - | application/json |
| `/api/v1/{items}/{id}/process` | POST | application/json | `{}` (empty) | application/json |

**Response — GET /results:**
```json
{
  "extracted_fields": [
    {
      "field_name": "string",
      "value": "any",
      "evidence": { "supporting_texts": [], "reasoning": "", "confidence": 0.0, "bboxes": [] }
    }
  ]
}
```

**Response — POST /process:** Returns HTTP 202 with `{"job_id": "string", "status": "pending"}`.

## UI Components
When enabled, include:
- Results display panel (table or card layout)
- Field-level evidence links (if evidence_display enabled)
- Processing trigger button ("Process" / "Evaluate")
- Status indicator for async processing

## AI Pipeline
When enabled, ai-integrator must implement:
1. OCR documents (penguin.ocr)
2. LLM extraction/evaluation (penguin.core — `create_model` + `with_structured_output`)
3. Structured output parsing
4. Bbox mapping (if evidence_display enabled)

## Data Types

> **Canonical schemas (Pydantic + TypeScript):** See `.claude/contracts/extraction-result.md`
>
> Includes: `EvidenceCitation`, `ExtractedField`, `ExtractionResult`

## Sub-Options

### confidence_display
"Should users see confidence scores?"
- If yes: Add `confidence: float` to evidence schema

### reasoning_display
"Should users see AI reasoning?"
- If yes: Add `reasoning: str` to evidence schema

## LLM Provider Selection (MANDATORY during Phase 0)

When `ai_extraction` is enabled, the orchestrator MUST ask the user which LLM provider and model to use. **Do NOT default to any provider.**

**Question to ask:**
> "Which LLM provider and model should we use for AI extraction? penguin-ai-sdk supports Bedrock (Claude), Gemini, and OpenAI."

**Options:**

| Provider | Example Models | Env Vars Required |
|----------|---------------|-------------------|
| `bedrock` | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `BEDROCK_REGION` |
| `gemini` | `gemini-3-pro-preview`, `gemini-2.5-flash` | `GOOGLE_API_KEY` |
| `openai` | `gpt-4o`, `gpt-4-turbo` | `OPENAI_API_KEY` |
| `azure_openai` | `gpt-4o` | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY` |

> **Bedrock:** On-demand invocation requires **inference profile IDs** (prefixed with `us.`), not raw model IDs. Raw model IDs like `anthropic.claude-3-5-sonnet-20241022-v2:0` will fail with `ValidationException`. Always ask the user for the full inference profile ID.

**Record in HANDOFF.md Phase 0:**
```markdown
#### LLM Configuration
| Setting | Value |
|---------|-------|
| Provider | {user_selected_provider} |
| Model | {user_selected_model} |
| Env Vars | {required_env_vars_for_provider} |
```

**All downstream agents (ai-integrator, templates) read the LLM provider/model from HANDOFF.md Phase 0 — never assume a default.**

## Dependencies
- Requires penguin-ai-sdk
- Celery tasks for async processing
- If evidence_display: requires bbox mapping
