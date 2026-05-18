# Contract: extraction-result

## Overview
Generic AI extraction output format. Customize the `extracted_fields` schema per project.

## Producer
- **ai-integrator** (Phase 2.5) - Generates extraction results from LLM

## Consumers
- **api-builder** (Phase 2) - Stores and returns via GET /items/{id}/results
- **ui-builder** (Phase 1) - Displays extracted data with evidence
- **quality-tester** (Phase 3) - Verifies extraction display

## Schema

### Generic Extraction Result

```json
{
  "result_id": "ext_abc123",
  "item_id": "item_456",
  "status": "completed",
  "created_at": "2024-01-15T10:30:00Z",
  "extracted_fields": [
    {
      "field_name": "patient_name",
      "value": "John Smith",
      "evidence": {
        "supporting_texts": ["Patient: John Smith, DOB: 1980-01-15"],
        "reasoning": "Name found in patient demographics header",
        "confidence": 0.95,
        "bboxes": [
          {
            "document_name": "document.pdf",
            "page_number": 1,
            "bbox": [[0.1, 0.2, 0.4, 0.2, 0.4, 0.25, 0.1, 0.25]]
          }
        ]
      }
    },
    {
      "field_name": "date_of_service",
      "value": "2024-01-10",
      "evidence": {
        "supporting_texts": ["Service Date: January 10, 2024"],
        "reasoning": "Date explicitly stated in service header",
        "confidence": 0.89,
        "bboxes": [
          {
            "document_name": "document.pdf",
            "page_number": 2,
            "bbox": [[0.15, 0.3, 0.5, 0.3, 0.5, 0.35, 0.15, 0.35]]
          }
        ]
      }
    }
  ],
  "summary": "Extracted 5 fields with 92% average confidence",
  "raw_text": "Full OCR text... (optional)"
}
```

> **Note:** The `evidence` object follows the `evidence-citation` contract schema.

> **v0.2.0**: Evidence objects SHOULD include `line_numbers` field for traceability. This enables direct mapping from LLM-cited line numbers to bounding box coordinates. See `evidence-citation` contract for line-number-based bbox retrieval pattern.

## Field Requirements

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `result_id` | string | YES | Unique extraction ID |
| `item_id` | string | YES | Work item being processed |
| `status` | string | YES | "pending", "processing", "completed", "failed" |
| `extracted_fields` | array | YES | Array of extracted field objects |
| `created_at` | string | YES | ISO 8601 timestamp |

### Per Extracted Field

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `field_name` | string | YES | Schema field identifier |
| `value` | any | YES | Extracted value |
| `evidence` | object | YES | Evidence citation (see evidence-citation contract) |

### Evidence Object (see evidence-citation contract)

> **See `.claude/contracts/evidence-citation.md` for full evidence schema.**
> **See `.claude/contracts/bbox-format.md` for canonical bbox specification.**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `supporting_texts` | string[] | YES | Array of verbatim OCR text |
| `reasoning` | string | NO | LLM explanation |
| `confidence` | float | YES | 0.0 - 1.0 confidence score |
| `bboxes` | array | YES | **Array** of bbox objects (PDFViewer expects array) |

## Customization Per Project

Define your extraction schema in Phase 0:

```markdown
### Extraction Schema (Phase 0)

| Field | Type | Description |
|-------|------|-------------|
| patient_name | string | Full patient name |
| date_of_birth | date | Patient DOB |
| diagnosis_codes | string[] | ICD-10 codes |
| procedure_codes | string[] | CPT codes |
| provider_name | string | Rendering provider |
```

The ai-integrator uses this schema to prompt the LLM:

```python
class ExtractionSchema(BaseModel):
    patient_name: str
    date_of_birth: date
    diagnosis_codes: List[str]
    procedure_codes: List[str]
    provider_name: str
```

## Consumer Usage

```
field.evidence.bboxes  →  PDFViewer.boundingBoxes  (pass directly)
```

## Validation Rules

1. Every extracted field MUST have `evidence.bboxes` (non-empty **array**)
2. `confidence` MUST be between 0.0 and 1.0
3. `supporting_texts` MUST be verbatim OCR text (not LLM-generated)
4. `bboxes` MUST be an array of bbox objects
5. Empty `extracted_fields` array is allowed for documents with no extractable data

## Common Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| `bboxes` as object | PDFViewer shows nothing | Use **array** of objects |
| Empty bboxes array | No highlights | Map OCR lines to extractions |
| Hardcoded confidence | Unreliable | Use LLM-reported confidence |
| LLM-generated supporting_texts | False evidence | Use verbatim OCR text |
| Missing field_name | Can't display | Always include schema field name |
