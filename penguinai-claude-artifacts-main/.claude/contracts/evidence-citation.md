# Contract: evidence-citation

## Overview
Generic schema for AI-extracted evidence with source location. Used wherever extracted data needs to link back to source documents.

This is a **building block contract** - embedded within other contracts like `extraction-result`.

## Producer
- **ai-integrator** (Phase 2.5) - Maps LLM extractions to OCR source locations

## Consumers
- **api-builder** (Phase 2) - Stores and returns citations
- **ui-builder** (Phase 1) - Displays evidence with "View Source" buttons
- **PDFViewer** - Highlights cited regions when clicked

## Schema

### Evidence Citation Object

```json
{
  "supporting_texts": [
    "Patient requires skilled nursing for tracheostomy care",
    "Ventilator management needed daily"
  ],
  "reasoning": "The document explicitly states the patient needs tracheostomy care and ventilator management, which requires skilled nursing per clinical guidelines.",
  "confidence": 0.92,
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
```

**Key:**
- `supporting_texts` is an array of verbatim OCR excerpts
- `bboxes` is an **array** of bbox objects - PDFViewer expects array

## Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `supporting_texts` | string[] | YES | Array of verbatim OCR text excerpts |
| `reasoning` | string | NO | LLM explanation of why this evidence supports the extraction |
| `confidence` | float | YES | 0.0-1.0 confidence score |
| `bboxes` | array | YES | **Array** of PDFViewer-compatible bbox objects |
| `line_numbers` | int[] | RECOMMENDED | OCR line numbers from full_text (v0.2.0) |

### Bboxes Array Element (PDFViewer-Compatible)

> **See `.claude/contracts/bbox-format.md` for the canonical bbox specification.**

**CRITICAL:** PDFViewer expects `boundingBoxes` to be an **array** of objects.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `document_name` | string | YES | Filename matching documentData.files |
| `page_number` | int | YES | 1-indexed page number as INTEGER (e.g., 1, 2, 3) |
| `bbox` | number[][] | YES | Array of 8-point coordinate arrays (normalized 0-1) |
| `line_numbers` | int[] | RECOMMENDED | OCR line numbers from full_text (v0.2.0) |

**Note:** `page_number` is an integer. Presigned URL keys in `pdfviewer-data` are strings (JSON requirement), but bbox `page_number` is integer.

## Usage in Extraction Result

```json
{
  "result_id": "ext_123",
  "item_id": "item_456",
  "extracted_fields": [
    {
      "field_name": "patient_name",
      "value": "John Smith",
      "evidence": {
        "supporting_texts": ["Patient: John Smith"],
        "reasoning": "Name found in patient demographics section",
        "confidence": 0.98,
        "bboxes": [
          {
            "document_name": "intake_form.pdf",
            "page_number": 1,
            "bbox": [[0.1, 0.2, 0.4, 0.2, 0.4, 0.25, 0.1, 0.25]]
          }
        ]
      }
    },
    {
      "field_name": "diagnosis",
      "value": "Type 2 Diabetes",
      "evidence": {
        "supporting_texts": ["Primary Diagnosis: Type 2 Diabetes Mellitus"],
        "reasoning": "Diagnosis explicitly stated in assessment section",
        "confidence": 0.95,
        "bboxes": [
          {
            "document_name": "medical_records.pdf",
            "page_number": 2,
            "bbox": [[0.15, 0.45, 0.7, 0.45, 0.7, 0.5, 0.15, 0.5]]
          }
        ]
      }
    }
  ]
}
```

## Usage in Criteria Evaluation (Example)

```json
{
  "question_id": "1.1.1.1",
  "criteria_text": "Is skilled nursing medically necessary?",
  "result": true,
  "evidence": {
    "supporting_texts": [
      "Patient requires tracheostomy care",
      "Ventilator management needed daily"
    ],
    "reasoning": "Tracheostomy care requires skilled nursing intervention per clinical guidelines",
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
```

## Mapping from OCR (ai-integrator)

### Line-Number-Based Approach (v0.2.0, RECOMMENDED)

**CRITICAL**: Use line-number-based bbox retrieval instead of text matching. This approach is reliable, fast, and traceable.

```python
from penguin.ocr import AzureOCRProvider
from utils.line_number_bbox_utils import create_evidence_citation_from_line_numbers

async def create_evidence_from_llm_output(
    ocr_result,  # OCR result from penguin-ai-sdk
    llm_extraction: dict,  # LLM output with line_numbers and page_numbers
    document_name: str,
    field_name: str
) -> dict:
    """
    Create evidence citation from LLM extraction using line-number-based bbox retrieval.

    CRITICAL: LLM must cite line numbers from full_text format ("content || line_number").
    Produces PDFViewer-compatible format directly.

    Args:
        ocr_result: OCR result object from penguin-ai-sdk (processed with full_text)
        llm_extraction: LLM output with schema:
            {
                "{field_name}_line_numbers": [5, 10],
                "{field_name}_page_numbers": [1, 1],
                "{field_name}_reasoning": "Found on lines 5 and 10",
                "{field_name}_confidence": 0.95
            }
        document_name: Name of the document
        field_name: Name of the extracted field (e.g., "icd_code", "patient_name")

    Returns:
        Evidence citation following evidence-citation contract
    """
    # Extract line numbers and metadata from LLM output
    line_numbers = llm_extraction[f"{field_name}_line_numbers"]
    page_numbers = llm_extraction[f"{field_name}_page_numbers"]
    reasoning = llm_extraction[f"{field_name}_reasoning"]
    confidence = llm_extraction[f"{field_name}_confidence"]

    # Use the first page if multiple pages (can be extended to handle multi-page)
    page_number = page_numbers[0]

    # Create evidence citation using SDK utilities
    evidence = create_evidence_citation_from_line_numbers(
        ocr_result=ocr_result,
        line_numbers=line_numbers,
        page_number=page_number,
        document_name=document_name,
        llm_reasoning=reasoning,
        confidence=confidence,
        criterion_id=field_name,
        criterion_name=field_name.replace("_", " ").title()
    )

    # Extract supporting texts from OCR lines for display
    supporting_texts = []
    for line_num in line_numbers:
        # Use SDK's find_line() to get the actual text
        line_obj = ocr_result.find_line(line_num, page_number=page_number)
        if line_obj:
            # Strip line number suffix from full_text format
            text = line_obj.content.split(" || ")[0] if " || " in line_obj.content else line_obj.content
            supporting_texts.append(text)

    # Add supporting_texts to evidence (not included by create_evidence_citation_from_line_numbers)
    evidence["supporting_texts"] = supporting_texts

    return evidence
```

**Example LLM Schema** (required for line-number approach):

```python
class ICDCodeExtraction(BaseModel):
    icd_code: str
    icd_code_line_numbers: List[int]  # OCR line numbers from full_text
    icd_code_page_numbers: List[int]  # Page numbers for each line
    icd_code_reasoning: str           # LLM explanation
    icd_code_confidence: float        # 0.0-1.0 score
```

**Example LLM Prompt** (required for line-number approach):

```
CRITICAL: Cite line numbers where you found each piece of evidence.

The full_text format is "content || line_number" (e.g., "Patient: John Smith || 5").

For each extracted field, you MUST provide:
1. {field}_line_numbers: List of line numbers where you found the evidence
2. {field}_page_numbers: List of page numbers for each line
3. {field}_reasoning: Your explanation
4. {field}_confidence: Your confidence score (0.0-1.0)

Example:
{
  "icd_code": "J44.0",
  "icd_code_line_numbers": [15, 23],
  "icd_code_page_numbers": [1, 1],
  "icd_code_reasoning": "Found ICD-10 code J44.0 on lines 15 and 23 of page 1",
  "icd_code_confidence": 0.95
}
```

## Combining Multiple Citations

When evidence spans multiple locations (possibly across pages/documents):

```python
def combine_evidence_citations(citations: List[dict], combined_reasoning: str) -> dict:
    """
    Combine multiple citations into single evidence object.
    Handles evidence spanning multiple pages/documents.
    """

    all_texts = []
    total_confidence = 0
    grouped = {}

    for citation in citations:
        all_texts.extend(citation["supporting_texts"])
        total_confidence += citation["confidence"]

        # Merge bboxes, grouping by document/page
        for bbox_obj in citation["bboxes"]:
            key = f"{bbox_obj['document_name']}_{bbox_obj['page_number']}"
            if key not in grouped:
                grouped[key] = {
                    "document_name": bbox_obj["document_name"],
                    "page_number": bbox_obj["page_number"],
                    "bbox": []
                }
            grouped[key]["bbox"].extend(bbox_obj["bbox"])

    return {
        "supporting_texts": all_texts,
        "reasoning": combined_reasoning,
        "confidence": total_confidence / len(citations),
        "bboxes": list(grouped.values())  # ARRAY of bbox objects
    }
```

## Consumer Compatibility

### Zero-Transform Guarantee

ai-integrator produces `bboxes` in exact PDFViewer format. UI passes directly:

```
evidence.bboxes  →  PDFViewer.boundingBoxes  (no transformation)
```

### TypeScript Interface

```typescript
// types/evidence.ts

/**
 * PDFViewer-compatible bounding box object.
 * PDFViewer expects an ARRAY of these objects.
 */
interface BboxObject {
  document_name: string;
  page_number: number;  // INTEGER, 1-indexed (e.g., 1, 2, 3)
  bbox: number[][];     // Array of 8-point coordinate arrays
}

/**
 * Evidence citation object.
 * Produced by ai-integrator, stored by api-builder, displayed by ui-builder.
 */
interface EvidenceCitation {
  supporting_texts: string[];  // Array of verbatim OCR excerpts
  reasoning?: string;          // LLM explanation
  confidence: number;          // 0.0-1.0
  bboxes: BboxObject[];        // ARRAY - pass directly to PDFViewer
}

interface ExtractedField {
  field_name: string;
  value: any;
  evidence: EvidenceCitation;
}
```

## Validation Rules

1. `supporting_texts` MUST be verbatim OCR text (not LLM-generated)
2. `confidence` MUST be between 0.0 and 1.0
3. `bboxes` MUST be a non-empty **array** (PDFViewer expects array)
4. Each `bboxes[].document_name` MUST match a file in documentData.files
5. Each `bboxes[].bbox` MUST have at least one 8-point coordinate array
6. Coordinates MUST be normalized (0.0 to 1.0)

## Common Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| `bboxes` as object | PDFViewer shows nothing | Use **array** of bbox objects |
| LLM-generated supporting_texts | False evidence | Use verbatim OCR text only |
| Empty bboxes array | No highlights | Always include at least one bbox object |
| Missing reasoning | User confused | Always include LLM explanation |
| Confidence always 1.0 | Misleading | Use actual LLM confidence |
| 0-indexed page_number | Wrong page | Use 1-indexed |
| String page_number ("1") | Type mismatch | Use integer (1) |
| Pixel coordinates | Wrong position | Normalize to 0-1 range |

## Relationship to Other Contracts

```
evidence-citation (this contract)
       │
       ├── Uses: bbox-format (for bboxes array)
       │
       ├── Embedded in: extraction-result (for extracted_fields[].evidence)
       │
       └── Displayed by: PDFViewer (highlights bboxes on click)
```
