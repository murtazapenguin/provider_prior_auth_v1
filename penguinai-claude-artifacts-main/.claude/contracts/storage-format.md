# Contract: storage-format

## Overview
Defines how data flows from AI producer → MongoDB → API consumer with zero transformation.

**Principle:** MongoDB stores data in the EXACT format that consumers expect. No field renaming, no structure changes, no serialization.

## Producer
- **ai-integrator** (Phase 2.5) - Produces data in contract format

## Storage
- **api-builder** (Phase 2) - Stores data AS-IS in MongoDB

## Consumer
- **ui-builder** (Phase 1) - Receives data AS-IS from API

## Zero-Transform Rule

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  ai-integrator  │────>│    MongoDB      │────>│   api-builder   │
│                 │     │                 │     │                 │
│  produces:      │     │  stores:        │     │  returns:       │
│  {              │     │  {              │     │  {              │
│    bboxes: []   │ === │    bboxes: []   │ === │    bboxes: []   │
│  }              │     │  }              │     │  }              │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
        └───────────────────────┴───────────────────────┘
                    IDENTICAL FORMAT
```

## Forbidden Transformations

| Transformation | Example | Why Forbidden |
|---------------|---------|---------------|
| Field renaming | `supporting_texts` → `supportingTexts` | Breaks consumer expectations |
| Array serialization | `bboxes: []` → `bboxes: "{...}"` | Requires parsing on read |
| Nested flattening | `evidence.bboxes` → `evidence_bboxes` | Breaks nested access |
| Type coercion | `page_number: 1` → `page_number: "1"` | May break consumers |
| Wrapper objects | `{data: {bboxes: []}}` | Adds unwanted nesting |

## MongoDB Document Structure

### ExtractionResult Collection

Store AI output exactly as produced:

```javascript
// Document in "extraction_results" collection
{
  "_id": ObjectId("..."),
  "result_id": "ext_abc123",
  "item_id": "item_456",
  "org_id": "org_789",  // Added for multi-tenant
  "status": "completed",
  "created_at": ISODate("2024-01-15T10:30:00Z"),

  // Store EXACTLY as ai-integrator produces
  "extracted_fields": [
    {
      "field_name": "patient_name",
      "value": "John Smith",
      "evidence": {
        "supporting_texts": ["Patient: John Smith"],  // Array, not joined string
        "reasoning": "Name found in header",
        "confidence": 0.95,
        "bboxes": [  // Array of objects, not serialized
          {
            "document_name": "document.pdf",
            "page_number": 1,  // INTEGER per canonical format
            "bbox": [[0.1, 0.2, 0.4, 0.2, 0.4, 0.25, 0.1, 0.25]]
          }
        ]
      }
    }
  ]
}
```

### CriteriaEvaluation (for PA/evaluation use cases)

```javascript
// Document in "evaluations" collection
{
  "_id": ObjectId("..."),
  "evaluation_id": "eval_123",
  "case_id": "case_456",
  "org_id": "org_789",

  // Store EXACTLY as ai-integrator produces
  "criteria_evaluations": [
    {
      "question_id": "1.1.1.1",
      "criteria_text": "Is skilled nursing medically necessary?",
      "result": true,
      "evidence": {
        "supporting_texts": [
          "Patient requires tracheostomy care",
          "Ventilator management needed daily"
        ],
        "reasoning": "Tracheostomy care requires skilled nursing",
        "confidence": 0.89,
        "bboxes": [
          {
            "document_name": "medical_records.pdf",
            "page_number": 3,
            "bbox": [
              [0.1, 0.15, 0.6, 0.15, 0.6, 0.22, 0.1, 0.22],
              [0.1, 0.25, 0.5, 0.25, 0.5, 0.30, 0.1, 0.30]
            ]
          }
        ]
      }
    }
  ]
}
```

## API Response (No Transformation)

api-builder returns MongoDB documents directly (minus internal fields):

```python
# routes/results.py

@router.get("/items/{item_id}/results")
async def get_results(item_id: str, db = Depends(get_db)):
    result = await db.extraction_results.find_one(
        {"item_id": item_id},
        {"_id": 0}  # Exclude MongoDB _id only
    )
    return result  # Return AS-IS, no transformation
```

## Pydantic Models (Match Contract Exactly)

```python
# models/evidence.py

from pydantic import BaseModel
from typing import List, Optional

class BboxObject(BaseModel):
    """Matches bbox-format contract exactly."""
    document_name: str
    page_number: int  # INTEGER per canonical format
    bbox: List[List[float]]

class EvidenceCitation(BaseModel):
    """Matches evidence-citation contract exactly."""
    supporting_texts: List[str]  # Array, not string
    reasoning: Optional[str] = None
    confidence: float
    bboxes: List[BboxObject]  # Array of objects

class ExtractedField(BaseModel):
    """Matches extraction-result contract exactly."""
    field_name: str
    value: Any
    evidence: EvidenceCitation
```

## TypeScript Interfaces (Match Pydantic Exactly)

```typescript
// types/evidence.ts — field names are snake_case, NOT camelCase

interface BboxObject {
  document_name: string;
  page_number: number;  // INTEGER
  bbox: number[][];
}

interface EvidenceCitation {
  supporting_texts: string[];  // Array, not string
  reasoning: string | null;
  confidence: number;
  bboxes: BboxObject[];
}

interface ExtractedField {
  field_name: string;
  value: any;
  evidence: EvidenceCitation;
}
```

**Field names are snake_case in TypeScript too.** Do NOT convert to camelCase.

## Validation Rules

1. **Field names MUST match contract exactly** - No camelCase/snake_case conversion
2. **Arrays MUST stay arrays** - Never serialize to JSON strings
3. **Nested objects MUST stay nested** - Never flatten
4. **Types MUST be preserved** - String stays string, int stays int
5. **api-builder returns documents AS-IS** - Only exclude `_id`

## Common Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| Serializing bboxes to JSON string | UI must parse | Store as native array |
| Converting supporting_texts to single string | Loses structure | Keep as array |
| Renaming fields for "MongoDB convention" | Breaks consumers | Use contract field names |
| Adding wrapper objects | Extra nesting | Store flat |
| Converting page_number type | May break consumers | Keep as INTEGER |

## Testing Storage Format

```python
# tests/test_storage_format.py

async def test_storage_matches_contract():
    """Verify MongoDB stores data in contract format."""

    # ai-integrator produces this
    ai_output = {
        "result_id": "ext_123",
        "extracted_fields": [
            {
                "field_name": "patient_name",
                "value": "John Smith",
                "evidence": {
                    "supporting_texts": ["Patient: John Smith"],
                    "reasoning": "Found in header",
                    "confidence": 0.95,
                    "bboxes": [
                        {
                            "document_name": "doc.pdf",
                            "page_number": 1,
                            "bbox": [[0.1, 0.2, 0.3, 0.2, 0.3, 0.25, 0.1, 0.25]]
                        }
                    ]
                }
            }
        ]
    }

    # Store in MongoDB
    await db.extraction_results.insert_one(ai_output)

    # Retrieve from MongoDB
    stored = await db.extraction_results.find_one(
        {"result_id": "ext_123"},
        {"_id": 0}
    )

    # MUST be identical (zero transformation)
    assert stored == ai_output

    # Verify nested structure preserved
    assert isinstance(stored["extracted_fields"][0]["evidence"]["bboxes"], list)
    assert isinstance(stored["extracted_fields"][0]["evidence"]["supporting_texts"], list)
```

## Exceptions to Zero-Transform Rule

### PDFViewer Data (`pdfviewer-data` contract)

The `pdfviewer-data` contract is the **one permitted exception** to the zero-transform rule. Field names are intentionally renamed at the API layer:

| MongoDB Storage | API Response | Reason |
|-----------------|-------------|--------|
| `document_names` | `files` | PDFViewer expects `documentData.files` |
| `page_urls` | `presigned_urls` | PDFViewer expects `documentData.presigned_urls` |

This rename is required because MongoDB stores descriptive field names, but the PDFViewer component expects specific prop names. The api-builder performs this rename when serving the `/pdfs` endpoint.

**This is the ONLY permitted rename.** All other data (bboxes, extraction results, evidence citations) must flow without any transformation.

---

## Relationship to Other Contracts

```
storage-format (this contract)
       │
       ├── Stores: evidence-citation (as-is)
       │
       ├── Stores: bbox-format (as-is)
       │
       ├── Stores: extraction-result (as-is)
       │
       └── Returns: Same format to UI (no transformation)
```
