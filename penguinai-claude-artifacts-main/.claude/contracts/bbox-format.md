# Contract: bbox-format

## Overview
Defines the canonical bounding box format for highlighting evidence in PDFViewer.

## Producer
- **ai-integrator** (Phase 2.5) - Maps OCR coordinates to canonical format

## Consumers
- **api-builder** (Phase 2) - Stores and returns bboxes with evaluation results
- **ui-builder** (Phase 1) - PDFViewer renders highlights
- **quality-tester** (Phase 3) - Verifies bbox highlighting works

## Schema

**CRITICAL:** PDFViewer expects `boundingBoxes` prop to be an **array** of bbox objects.

```json
[
  {
    "document_name": "patient_info.pdf",
    "page_number": 1,
    "bbox": [[0.1, 0.15, 0.4, 0.15, 0.4, 0.18, 0.1, 0.18]]
  }
]
```

## Field Requirements

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `document_name` | string | YES | Filename matching `documentData.files` |
| `page_number` | int | YES | 1-indexed page number as INTEGER (e.g., 1, 2, 3) |
| `bbox` | float[][] | YES | Array of 8-point coordinate arrays |
| `line_numbers` | int[] | RECOMMENDED | OCR line numbers from full_text (v0.2.0) |

## 8-Point Coordinate Format

Coordinates are **normalized (0-1)** relative to page dimensions:

```
bbox: [[x1, y1, x2, y2, x3, y3, x4, y4]]

Points form a quadrilateral (clockwise from top-left):
  (x1,y1) -------- (x2,y2)
     |                |
     |                |
  (x4,y4) -------- (x3,y3)
```

## Example: Single Bbox

```json
{
  "document_name": "medical_records.pdf",
  "page_number": 3,
  "bbox": [[0.12, 0.34, 0.45, 0.34, 0.45, 0.38, 0.12, 0.38]]
}
```

## Example: Multiple Bboxes on Same Page

```json
{
  "document_name": "patient_info.pdf",
  "page_number": 1,
  "bbox": [
    [0.1, 0.2, 0.3, 0.2, 0.3, 0.25, 0.1, 0.25],
    [0.1, 0.3, 0.4, 0.3, 0.4, 0.35, 0.1, 0.35]
  ]
}
```

## Producer Note: `evidence_bbox_utils.py`

The `platform-backend-kit/utils/evidence_bbox_utils.py` utility returns **5 fields**, not 3:

```python
{
    "bbox": [[x1, y1, x2, y2, x3, y3, x4, y4]],  # Normalized 0-1 coordinates
    "page_number": 1,        # INTEGER, 1-indexed
    "width": 2550,           # Image width in pixels — NOT part of consumer contract
    "height": 3300,          # Image height in pixels — NOT part of consumer contract
    "document_name": "doc.pdf"
}
```

**`width` and `height` are pixel metadata** used internally during coordinate normalization. They are NOT needed by consumers (PDFViewer, api-builder, ui-builder). Strip them before storage:

```python
# Strip producer-only fields before storing
def to_consumer_format(producer_bbox: dict) -> dict:
    return {
        "document_name": producer_bbox["document_name"],
        "page_number": producer_bbox["page_number"],
        "bbox": producer_bbox["bbox"]
    }
```

**`label` and `color`** are optional PDFViewer display props — they are NOT produced by the utility, NOT required in this contract, and can be added by the frontend at display time if needed.

---

## SDK Helpers (v0.2.0 — PRIMARY Recommended Approach)

The penguin-ai-sdk v0.2.0 provides built-in helpers for bbox format conversion. **Use these instead of manual conversion whenever possible:**

### `ocr_result_to_bbox_format()`

Converts OCR result bounding boxes to canonical format automatically:

```python
from penguin.ocr import AzureOCRProvider

ocr = AzureOCRProvider()
result = await ocr.process_file("document.pdf")

# Get canonical bboxes for specific line numbers
bboxes = result.ocr_result_to_bbox_format(
    line_numbers=[5, 10],
    page_number=1,
    document_name="document.pdf"
)
# Returns: [{"document_name": "document.pdf", "page_number": 1, "bbox": [[...]], "line_numbers": [5, 10]}]
```

### `strip_page_dimensions()`

Strips producer-only `width`/`height` fields from bbox dicts:

```python
consumer_bbox = strip_page_dimensions(producer_bbox)
# Removes width, height — keeps document_name, page_number, bbox
```

### `find_line_as_bbox()`

Find a specific OCR line and return its bbox in canonical format:

```python
bbox = result.find_line_as_bbox(
    line_number=42,
    page_number=1,
    document_name="document.pdf"
)
# Returns: {"document_name": "document.pdf", "page_number": 1, "bbox": [[x1,y1,...,x4,y4]]}
```

---

## OCR to Canonical Conversion (Manual)

> **CRITICAL — Azure OCR Coordinate Normalization:**
> Azure Document Intelligence returns bounding box coordinates in **inches** (e.g., `x=1.6045, y=5.4618`).
> These MUST be normalized to 0-1 range by dividing by page dimensions (also in inches).
> Use PyMuPDF to get page dimensions: `rect.width / 72.0` and `rect.height / 72.0` (72 points = 1 inch).
> Failing to normalize will place bboxes at 160%+ offsets, making them invisible.

```python
import fitz  # PyMuPDF

def get_page_dimensions(pdf_path: str) -> dict:
    """Pre-compute {page_number: (width_inches, height_inches)} from PDF."""
    doc = fitz.open(pdf_path)
    dims = {}
    for i in range(len(doc)):
        rect = doc[i].rect
        dims[i + 1] = (rect.width / 72.0, rect.height / 72.0)
    doc.close()
    return dims

def ocr_bbox_to_canonical(ocr_line, document_name: str, page_dimensions: dict) -> dict:
    """Convert OCR bounding box to canonical format with normalization.
    In v0.2.0, bounding_box points are always dicts with "x" and "y" keys."""
    # OCR returns 4 points: [{x,y}, {x,y}, {x,y}, {x,y}] in INCHES
    bbox = ocr_line.bounding_box

    raw = [
        float(bbox[0]["x"]), float(bbox[0]["y"]),  # top-left
        float(bbox[1]["x"]), float(bbox[1]["y"]),  # top-right
        float(bbox[2]["x"]), float(bbox[2]["y"]),  # bottom-right
        float(bbox[3]["x"]), float(bbox[3]["y"]),  # bottom-left
    ]

    # Normalize from inches to 0-1 using actual page dimensions
    pw, ph = page_dimensions.get(ocr_line.page_number, (8.5, 11.0))
    coords = [
        raw[0]/pw, raw[1]/ph, raw[2]/pw, raw[3]/ph,
        raw[4]/pw, raw[5]/ph, raw[6]/pw, raw[7]/ph,
    ]

    return {
        "document_name": document_name,
        "page_number": ocr_line.page_number,  # INTEGER, 1-indexed
        "bbox": [coords]                      # Normalized 0-1
    }
```

## Grouping Multiple Bboxes

When evidence has multiple supporting bboxes, group by page:

```python
def group_bboxes_by_page(bboxes: List[dict]) -> List[dict]:
    """Group bboxes by document and page for PDFViewer."""
    if not bboxes:
        return []

    grouped = {}
    for bbox in bboxes:
        key = f"{bbox['document_name']}_{bbox['page_number']}"

        if key not in grouped:
            grouped[key] = {
                "document_name": bbox["document_name"],
                "page_number": bbox["page_number"],  # INTEGER, 1-indexed
                "bbox": []
            }

        grouped[key]["bbox"].extend(bbox["bbox"])

    return list(grouped.values())  # Return ARRAY
```

## Line-Number-Based Bbox Retrieval (v0.2.0)

### Why Line Numbers?

As of penguin-ai-sdk v0.2.0, the recommended approach for mapping evidence to bounding boxes is **line-number-based retrieval** rather than text matching:

**Benefits:**
- **Reliable**: No fuzzy matching ambiguity — LLM cites line 5, SDK returns exact bbox for line 5
- **Fast**: O(1) lookup by index instead of O(n) text search
- **Traceable**: Direct mapping from LLM citation → OCR line → bbox coordinates
- **Simple**: Single SDK method call instead of 298 lines of matching logic

**Text matching (deprecated) problems:**
- Fuzzy matching can match wrong lines (false positives)
- Context expansion adds adjacent lines (false evidence)
- Bidirectional matching complexity (two-pass algorithm)
- Word overlap heuristics (threshold tuning required)

### Workflow

```
┌─────────────┐
│  OCR with   │
│  full_text  │  ← format: "Invoice Total: $500 || 42"
└──────┬──────┘
       │
       ├─────────────► LLM Extraction
       │               (cites line numbers in schema)
       │
       │               schema: {
       │                 total: "$500",
       │                 line_numbers: [42],
       │                 page_numbers: [1]
       │               }
       │
       ▼
┌─────────────┐
│   SDK:      │
│   get_bboxes│  ← get_bounding_boxes_by_line(42, page=1)
│   _by_line()│
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Canonical  │  ← ocr_result_to_bbox_format() + strip_page_dimensions()
│  Bbox Format│
└──────┬──────┘
       │
       ▼
    PDFViewer
```

### Implementation

See `.claude/skills/ai-engineering-guide/usage/03-DOCUMENT-PROCESSING.md` for complete documentation.

**Utility Module**: `platform-backend-kit/utils/line_number_bbox_utils.py`

### LLM Prompt Pattern

**CRITICAL**: Instruct LLM to cite line numbers from `full_text`:

```python
EXTRACTION_PROMPT = """
CRITICAL: Cite line numbers where you found each piece of evidence.

The full_text format is "content || line_number" (e.g., "Patient: John Smith || 5").

For EACH extracted field that requires evidence:
1. Record the line_numbers (list of integers) where you found it
2. Record the page_numbers (list of integers) for each line
3. Provide your reasoning
4. Provide your confidence (0.0-1.0)

Example output schema:
{
  "icd_code": "J44.0",
  "icd_code_line_numbers": [15, 23],
  "icd_code_page_numbers": [1, 1],
  "icd_code_reasoning": "Found ICD-10 code J44.0 on lines 15 and 23 of page 1",
  "icd_code_confidence": 0.95
}
"""
```

### Complete Usage Example

```python
from penguin.ocr import AzureOCRProvider
from utils.line_number_bbox_utils import create_evidence_citation_from_line_numbers

# 1. OCR with full_text line numbers
ocr = AzureOCRProvider()
result = await ocr.process_file("invoice.pdf")

# full_text now contains: "Invoice Number: 12345 || 1\nTotal: $500 || 2\n..."

# 2. LLM extracts evidence with line numbers
llm_output = {
    "invoice_number": "12345",
    "invoice_number_line_numbers": [1],
    "invoice_number_page_numbers": [1],
    "invoice_number_reasoning": "Found invoice number on line 1",
    "invoice_number_confidence": 0.98
}

# 3. Create evidence citation with bboxes
evidence_citation = create_evidence_citation_from_line_numbers(
    ocr_result=result,
    line_numbers=llm_output["invoice_number_line_numbers"],
    page_number=llm_output["invoice_number_page_numbers"][0],
    document_name="invoice.pdf",
    llm_reasoning=llm_output["invoice_number_reasoning"],
    confidence=llm_output["invoice_number_confidence"],
    criterion_id="invoice_number",
    criterion_name="Invoice Number"
)

# Output (following bbox-format contract):
# {
#   "bboxes": [
#     {
#       "document_name": "invoice.pdf",
#       "page_number": 1,
#       "bbox": [[0.1, 0.15, 0.4, 0.15, 0.4, 0.18, 0.1, 0.18]],
#       "line_numbers": [1]
#     }
#   ],
#   "reasoning": "Found invoice number on line 1",
#   "confidence": 0.98,
#   "criterion_id": "invoice_number",
#   "criterion_name": "Invoice Number"
# }

# 4. Pass to PDFViewer
# <PDFViewer boundingBoxes={evidence_citation.bboxes} ... />
```

## Consumer Usage

```
evidence.bboxes (array)  →  PDFViewer.boundingBoxes  (pass directly)
```

## Validation Rules

1. **`bboxes` MUST be an array** - PDFViewer expects array, not single object
2. **Coordinates MUST be normalized (0-1)** - Not pixel values
3. **page_number MUST be 1-indexed INTEGER** - 1, 2, 3 (not strings, not 0-indexed)
4. **document_name MUST match documentData.files** - Exact string match
5. **bbox array MUST NOT be empty** - At least one 8-point coordinate array

## Common Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| `bboxes` as single object | PDFViewer shows nothing | Use **array** of objects |
| Pixel coordinates | Bbox draws wrong | Normalize to 0-1 |
| Azure OCR inches not normalized | Bboxes at 160%+ offset, invisible | Divide by page dimensions (inches) |
| 0-indexed page_number | Wrong page | Use 1-indexed |
| String page_number ("1") | Type mismatch | Use integer (1) |
| document_name mismatch | Bbox not found | Match exactly with files |
| Empty bbox array | No highlight | Always populate from OCR |
