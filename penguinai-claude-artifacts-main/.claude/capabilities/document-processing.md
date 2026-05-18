# Capability: document_processing

## Description
Users can view PDF documents or images with page navigation. Documents are rendered as PNG page images for display in PDFViewer.

## Question
"Will users upload or view documents (PDFs/images)?"

## Options
- PDF documents
- Images
- None (skip this capability)

## Contracts Required
- `pdfviewer-data` — Document viewer data structure
- `page-images` — PNG page generation during OCR

## Schema Fields
When enabled, add these fields to the item schema:

```python
document_names: list[str]       # PDF filenames for PDFViewer
page_urls: dict                 # {filename: {page_num: presigned_url}}
```

## API Endpoints
When enabled, implement:

| Method | Endpoint | Response Contract |
|--------|----------|-------------------|
| GET | `/api/v1/{items}/{id}/pdfs` | pdfviewer-data |
| GET | `/api/v1/{items}/{id}/search?q={query}` | searchResults (pdfviewer-data contract) |
| PUT | `/api/v1/{items}/{id}/annotations` | `{"status": "ok"}` |

## API Formats

| Endpoint | Method | Request Content-Type | Request Fields | Response Content-Type |
|----------|--------|---------------------|----------------|----------------------|
| `/api/v1/{items}/{id}/pdfs` | GET | - | - | application/json |
| `/api/v1/{items}/{id}/search` | GET | - | `q` (query param) | application/json |
| `/api/v1/{items}/{id}/annotations` | PUT | application/json | `AnnotationGroup[]` array | application/json |

**Response — GET /pdfs:**
```json
{
  "files": ["doc1.pdf", "doc2.pdf"],
  "presigned_urls": {
    "doc1.pdf": { "1": "https://s3.../page_1.png", "2": "https://s3.../page_2.png" },
    "doc2.pdf": { "1": "https://s3.../page_1.png" }
  }
}
```

**Note:** Page numbers in `presigned_urls` are STRING keys (JSON requirement). Values are S3 presigned URLs to PNG page images.

**Response — GET /search?q=query:**
```json
{
  "document_id": "item_123",
  "search_string": "query text",
  "total_matches": 3,
  "results": [
    {
      "document_name": "doc1.pdf",
      "page_number": 1,
      "bbox": [[0.1, 0.2, 0.5, 0.2, 0.5, 0.25, 0.1, 0.25]],
      "text_snippet": "...matched text...",
      "match_score": 95
    }
  ]
}
```

**Request — PUT /annotations body:**
```json
[
  {
    "page_number": 1,
    "document_name": "doc1.pdf",
    "bbox": [[0.1, 0.2, 0.5, 0.2, 0.5, 0.25, 0.1, 0.25]]
  }
]
```

## UI Components
When enabled, include:
- PDFViewer component from data-labelling-library
- Document selector (if multiple documents)
- Page navigation controls

### enableSearch (PDF Text Search)
Set `userInterfaces.enableSearch: true`. Requires:
- `onSearchPerformed` prop — fires when user submits query; caller must hit backend search API and call `setSearchResults(response)`
- `setSearchResults` prop — React state setter so PDFViewer can clear results on Escape
- `searchResults` prop — pass backend `/search` response directly (see pdfviewer-data contract)

### enableToolbar (Bounding Box Annotation)
Set `userInterfaces.enableToolbar: true`. Requires:
- `onAnnotationAdd` prop — fires with `AnnotationGroup[]` when user confirms Save
- `PUT /api/v1/{items}/{id}/annotations` endpoint on backend to persist the saved data
- `boundingBoxes` prop — pass existing stored bboxes so user can edit/delete them

## Data Types

> **Canonical schemas (Pydantic + TypeScript):** See `.claude/contracts/pdfviewer-data.md`
>
> Includes: `PDFViewerDataResponse`, `SearchResultItem`, `SearchResponse`, `AnnotationGroup`

## S3 Upload Rules

- **Always set `ContentType`** when uploading to S3 (use `mimetypes.guess_type()`). Without it, S3 serves as `application/octet-stream`, which triggers browser ORB (Opaque Response Blocking) when loaded in `<img>` tags.
- **Store S3 keys in MongoDB**, NOT presigned URLs. Presigned URLs expire (~1 hour). Generate them on demand in the `/pdfs` endpoint.

## Dependencies
- Requires ai-integrator to generate page images during OCR
- PDFViewer expects PNG images, not raw PDF files
