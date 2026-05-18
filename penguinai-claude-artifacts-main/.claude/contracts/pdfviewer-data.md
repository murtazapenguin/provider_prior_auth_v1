# Contract: pdfviewer-data

## Overview
Defines the documentData format required by the PDFViewer component from data-labelling-library.

**Zero-Transform Rule:** API returns data in EXACT format PDFViewer expects. No frontend transformation.

## Producer
- **api-builder** (Phase 2) - GET /api/v1/items/{id}/pdfs endpoint
- **ai-integrator** (Phase 2.5) - Generates page images during OCR, stores URLs

## Consumers
- **ui-builder** (Phase 1) - PDFViewer component prop (pass directly)
- **quality-tester** (Phase 3) - Verifies PDF viewing works

## Schema (Single Format - API and PDFViewer)

```json
{
  "files": ["document1.pdf", "document2.pdf"],
  "presigned_urls": {
    "document1.pdf": {
      "1": "https://s3.../document1_page1.png?signature=...",
      "2": "https://s3.../document1_page2.png?signature=...",
      "3": "https://s3.../document1_page3.png?signature=..."
    },
    "document2.pdf": {
      "1": "https://s3.../document2_page1.png?signature=..."
    }
  }
}
```

## Field Requirements

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `files` | string[] | YES | List of document filenames (strings, not objects) |
| `presigned_urls` | object | YES | Map of filename → page → URL |
| `presigned_urls[filename]` | object | YES | Map of page number (string) → image URL |
| `presigned_urls[filename][page]` | string | YES | Direct presigned URL to PNG image |

## CRITICAL Requirements

1. **Page images MUST be pre-rendered** - Raw PDF URLs will NOT work
2. **Page numbers are STRINGS** - "1", "2", "3" (not integers)
3. **Page numbers are 1-indexed** - First page is "1", not "0"
4. **URLs must be directly accessible** - S3 presigned URLs
5. **Image format**: PNG (required)
6. **`files` is string array** - NOT array of objects

## Zero-Transform Usage

```javascript
// API returns PDFViewer-ready format
const response = await api.get(`/items/${id}/pdfs`);

// Pass directly to PDFViewer - NO transformation
<PDFViewer
  documentData={response.data}  // Pass as-is
  boundingBoxes={bboxes}
/>
```

## API Endpoint Implementation (api-builder)

```python
# routes/items.py

@router.get("/items/{item_id}/pdfs")
async def get_item_pdfs(item_id: str, db = Depends(get_db)):
    """
    Returns PDFViewer-ready documentData.
    Zero transformation - frontend passes directly to PDFViewer.
    """
    item = await db.items.find_one({"id": item_id})
    if not item:
        raise HTTPException(404, "Item not found")

    # Return in exact PDFViewer format
    return {
        "files": item["document_names"],  # string[]
        "presigned_urls": item["page_urls"]  # {filename: {page: url}}
    }
```

## Page Image Generation (ai-integrator)

```python
import asyncio
import fitz  # PyMuPDF
import mimetypes
import tempfile
import boto3
from app.config import get_settings

async def generate_page_images(
    pdf_path: str,
    document_name: str,
    entity_id: str,  # case_id, invoice_id, document_id (domain-specific)
    org_id: str,
    entity_type: str = "cases"  # Domain-specific: cases, invoices, documents
) -> dict:
    """
    Render PDF pages to PNG images and return presigned URLs.
    Returns format ready for storage and PDFViewer consumption.

    boto3 is synchronous — all S3 calls are wrapped in asyncio.to_thread()
    to avoid blocking the event loop.

    S3 Key Pattern (domain-specific, prefixed by S3_APP_PREFIX):
        {app_prefix}/{org_id}/{entity_type}/{entity_id}/pages/{document_name}/page_{n}.png
    """
    settings = get_settings()
    s3_client = boto3.client("s3", region_name=settings.aws_region)
    doc = fitz.open(pdf_path)
    page_urls = {}

    with tempfile.TemporaryDirectory() as temp_dir:
        for page_num in range(len(doc)):
            page = doc[page_num]
            mat = fitz.Matrix(150/72, 150/72)  # 150 DPI minimum
            pix = page.get_pixmap(matrix=mat)

            # Save temporarily
            temp_path = f"{temp_dir}/page_{page_num + 1}.png"
            pix.save(temp_path)

            # Upload to S3 — app_prefix isolates this app within the shared bucket
            s3_key = f"{settings.s3_app_prefix}/{org_id}/{entity_type}/{entity_id}/pages/{document_name}/page_{page_num + 1}.png"
            content_type, _ = mimetypes.guess_type(temp_path)
            await asyncio.to_thread(
                s3_client.upload_file,
                temp_path, settings.s3_bucket_name, s3_key,
                ExtraArgs={"ContentType": content_type or "image/png"},
            )

            # Get presigned URL - page number as STRING, expiry from S3_PRESIGNED_URL_EXPIRY env var
            page_urls[str(page_num + 1)] = await asyncio.to_thread(
                s3_client.generate_presigned_url,
                "get_object",
                Params={"Bucket": settings.s3_bucket_name, "Key": s3_key},
                ExpiresIn=settings.s3_presigned_url_expiry,
            )

    doc.close()
    return page_urls


async def process_item_documents(item_id: str, documents: list) -> dict:
    """
    Process all documents for an item.
    Returns PDFViewer-ready format for storage.
    """
    files = []
    presigned_urls = {}

    for doc in documents:
        document_name = doc["name"]
        files.append(document_name)
        presigned_urls[document_name] = await generate_page_images(
            doc["path"], document_name, item_id
        )

    # Store in MongoDB in PDFViewer-ready format
    return {
        "document_names": files,
        "page_urls": presigned_urls
    }
```

## Storage Format (MongoDB)

Store in exact format that API will return:

```javascript
// In items collection
{
  "_id": ObjectId("..."),
  "id": "item_123",
  "document_names": ["patient_info.pdf", "medical_records.pdf"],
  "page_urls": {
    "patient_info.pdf": {
      "1": "https://s3.../page_1.png?...",
      "2": "https://s3.../page_2.png?..."
    },
    "medical_records.pdf": {
      "1": "https://s3.../page_1.png?..."
    }
  }
}
```

## Validation Rules

1. Every filename in `files` MUST have entry in `presigned_urls`
2. `files` MUST be string array (not array of objects)
3. Page keys MUST be strings ("1", "2"), not integers
4. Page URLs MUST return HTTP 200 with image content-type
5. Presigned URLs MUST have adequate expiry (min 1 hour)

## Common Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| `files` as array of objects | PDFViewer can't read filenames | Use string array |
| Integer page keys `{1: url}` | `undefined` lookup | Use string keys `{"1": url}` |
| Return raw PDF URLs | Blank viewer | Render to PNG images first |
| 0-indexed pages | Missing page 1 | Use 1-indexed |
| Frontend transformation | Breaks zero-transform | API returns PDFViewer format |

## Why Raw PDFs Don't Work

PDFViewer uses `<img>` tags:

```javascript
// Inside PDFViewer
<img src={documentData.presigned_urls[currentFile][pageNumber]} />
```

This requires direct image URLs (PNG/JPG), not PDF files.

---

## Search Results Contract (searchResults prop)

**Produced by:** api-builder — `GET /api/v1/{items}/{id}/search?q={query}`
**Consumed by:** ui-builder — pass directly as PDFViewer `searchResults` prop

**Types:** `SearchResponse` / `SearchResultItem` — see `document-processing` capability for Pydantic + TypeScript definitions.

### Schema

```json
{
  "document_id": "string",
  "search_string": "query text",
  "total_matches": 3,
  "results": [
    {
      "document_name": "document.pdf",
      "page_number": 1,
      "bbox": [[0.1, 0.2, 0.5, 0.2, 0.5, 0.25, 0.1, 0.25]],
      "text_snippet": "...matched text...",
      "match_score": 95
    }
  ]
}
```

### Field Requirements

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `document_id` | string | YES | Identifier for the document set |
| `search_string` | string | YES | The query that was searched |
| `total_matches` | integer | YES | Total number of matches found |
| `results[].document_name` | string | YES | MUST exactly match a `files[]` entry in documentData |
| `results[].page_number` | integer | YES | INTEGER, 1-indexed (not string) |
| `results[].bbox` | number[][] | YES | Normalized 0-1, 8-point format: `[[x1,y1,x2,y2,x3,y3,x4,y4]]` |
| `results[].text_snippet` | string | YES | Matched text excerpt for display |
| `results[].match_score` | number | YES | Confidence score 0-100 |

### Critical Rules

- `page_number` is **INTEGER** (not string — unlike presigned_urls keys)
- `bbox` coordinates are normalized 0-1 (not pixels)
- `document_name` must **exactly** match a `files[]` entry — case-sensitive
- **Zero-Transform:** pass API response directly as `searchResults` prop — no transformation needed

### Usage

```jsx
const [searchResults, setSearchResults] = useState(null);

const handleSearch = async (query) => {
  const results = await api.get(`/api/v1/items/${id}/search?q=${encodeURIComponent(query)}`);
  setSearchResults(results);  // pass directly — no transformation
};

<PDFViewer
  documentData={documentData}
  searchResults={searchResults}
  setSearchResults={setSearchResults}
  onSearchPerformed={handleSearch}
  userInterfaces={{ enableSearch: true }}
/>
```

---

## Annotation Output Contract (onAnnotationAdd callback)

**Produced by:** ui-builder — PDFViewer fires `onAnnotationAdd(savedData)` on confirmed Save
**Consumed by:** api-builder — `PUT /api/v1/{items}/{id}/annotations`

### Schema (what onAnnotationAdd receives)

```json
[
  {
    "page_number": 1,
    "document_name": "document.pdf",
    "bbox": [
      [0.1, 0.2, 0.5, 0.2, 0.5, 0.25, 0.1, 0.25],
      [0.3, 0.4, 0.6, 0.4, 0.6, 0.45, 0.3, 0.45]
    ]
  }
]
```

### Field Requirements

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `page_number` | integer | YES | INTEGER, 1-indexed |
| `document_name` | string | YES | Matches a `files[]` entry in documentData |
| `bbox` | number[][] | YES | Array of 8-point normalized bboxes for this page/document |

### Notes

- **Complete state:** includes BOTH surviving existing bboxes AND newly drawn bboxes
- **Deleted bboxes are absent:** existing bboxes the user removed are filtered out before firing
- **Replace semantics:** backend should REPLACE all stored bboxes for this item with this payload
- Grouped by `(page_number, document_name)` — one entry per page per document

### Backend Endpoint

```python
@router.put("/items/{item_id}/annotations")
async def save_annotations(
    item_id: str,
    annotations: list[AnnotationGroup],
    db = Depends(get_db)
):
    """Replace all stored annotations for this item."""
    await db.items.update_one(
        {"id": item_id},
        {"$set": {"annotations": [a.model_dump() for a in annotations]}}
    )
    return {"status": "ok"}
```
