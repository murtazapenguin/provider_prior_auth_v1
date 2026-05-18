# Capability: evidence_display

## Description
Users can see where extracted data came from. Clicking on evidence highlights the source location in the document with bounding boxes.

## Question
"Should users see where data came from (citations with highlights)?"

## Options
- Yes — show source highlights
- No — skip this capability

## Contracts Required
- `bbox-format` — Canonical 8-point bounding box format
- `evidence-citation` — Evidence object with supporting_texts, reasoning, bboxes

## Schema Fields
When enabled, add these fields to extraction results:

```python
# Per extracted field / criterion
supporting_texts: list[str]     # Verbatim OCR text excerpts
reasoning: str                  # LLM explanation (if reasoning_display enabled)
bboxes: list[dict]              # Array of bbox objects for PDFViewer
```

## Bbox Object Schema
```json
{
  "document_name": "document.pdf",
  "page_number": 1,
  "bbox": [[x1, y1, x2, y2, x3, y3, x4, y4]]
}
```

## API Endpoints

Evidence data is embedded in extraction results — no separate endpoints.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/{items}/{id}/results` | Returns extraction results with embedded `evidence` objects |

Evidence fields (`supporting_texts`, `reasoning`, `bboxes`) are part of each extracted field's `evidence` object.

## API Formats

| Endpoint | Method | Request Content-Type | Request Fields | Response Content-Type |
|----------|--------|---------------------|----------------|----------------------|
| `/api/v1/{items}/{id}/results` | GET | - | - | application/json |

**Evidence embedded in extraction result:**
```json
{
  "extracted_fields": [
    {
      "field_name": "string",
      "value": "any",
      "evidence": {
        "supporting_texts": ["verbatim OCR text"],
        "reasoning": "LLM explanation",
        "confidence": 0.95,
        "bboxes": [
          { "document_name": "doc.pdf", "page_number": 1, "bbox": [[x1,y1,x2,y2,x3,y3,x4,y4]] }
        ]
      }
    }
  ]
}
```

## Data Types

> **Canonical schemas (Pydantic + TypeScript):** See `.claude/contracts/evidence-citation.md`
>
> Includes: `BboxObject`, `EvidenceCitation`
>
> **Bbox format spec:** See `.claude/contracts/bbox-format.md`

## UI Components
When enabled, include:
- Clickable evidence links/buttons
- PDFViewer bbox highlighting integration
- "View Source" functionality

## Dependencies
- Requires `document_processing` capability
- ai-integrator must map LLM outputs to OCR bounding boxes
- Empty bboxes arrays are FORBIDDEN

## OCR Line Matching (CRITICAL)

> OCR lines do NOT align with sentence boundaries. A supporting sentence often spans multiple OCR lines.
> **Single-direction exact matching (`sentence in line_text`) will fail.** Use bidirectional containment + word overlap.

| Matching Strategy | Works? | Why |
|-------------------|--------|-----|
| `sentence in ocr_line` | ❌ | Sentence spans multiple lines — never fully contained in one |
| `ocr_line in sentence` | ⚠️ Partial | Catches substrings but misses partial overlap |
| Bidirectional + word overlap | ✅ | Handles all cases: contained, substring, and partial match |

See `.claude/skills/ai-engineering-guide/SKILL.md` "Bbox Matching" section for the implementation pattern.

## Azure OCR Coordinate Normalization (CRITICAL)

> Azure Document Intelligence returns bounding box coordinates in **inches**, not normalized 0-1.
> You MUST normalize using actual PDF page dimensions (via PyMuPDF: `rect.width/72, rect.height/72`).
> Without normalization, bboxes render at 160%+ offset and are invisible.

See `.claude/contracts/bbox-format.md` "OCR to Canonical Conversion" for the normalization code.

## Validation Rules
- Coordinates must be normalized (0-1) — NOT inches, NOT pixels
- page_number must be 1-indexed
- document_name must match documentData.files exactly
