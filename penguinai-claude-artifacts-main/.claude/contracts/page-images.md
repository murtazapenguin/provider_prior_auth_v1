# Contract: page-images

## Overview
Defines requirements for generating and storing PDF page images for PDFViewer.

## Producer
- **ai-integrator** (Phase 2.5) - Generates page images during OCR processing

## Consumers
- **api-builder** (Phase 2) - Returns presigned URLs via /pdfs endpoint
- **ui-builder** (Phase 1) - PDFViewer loads and displays images
- **quality-tester** (Phase 3) - Verifies images load correctly

## Processing Pipeline

```
PDF File → PyMuPDF Render → PNG Image → S3 Upload → Store S3 KEY (not URL) → Generate Presigned URL on demand → PDFViewer
```

## CRITICAL: Store S3 Keys, NOT Presigned URLs

> **ABSOLUTE RULE:** Store **S3 keys** in MongoDB, NEVER presigned URLs.
> Presigned URLs expire (typically 1 hour). If you store them, page images break after expiry.
> Generate presigned URLs on-demand in the `/pdfs` API endpoint.

| ❌ WRONG (store presigned URL) | ✅ CORRECT (store S3 key) |
|-------------------------------|--------------------------|
| `"1": "https://bucket.s3.amazonaws.com/...?X-Amz-..."` | `"1": "org_id/cases/abc/pages/doc.pdf/page_1.png"` |
| Expires in 1 hour | Permanent — generate URL on demand |

```python
# ✅ CORRECT — Store S3 key in MongoDB
page_urls[str(page_num + 1)] = s3_key  # e.g., "app-prefix/org_id/cases/abc/pages/doc.pdf/page_1.png"

# ❌ WRONG — Store presigned URL in MongoDB
page_urls[str(page_num + 1)] = generate_presigned_url(bucket, s3_key)  # Expires!
```

## S3 Upload: Always Set ContentType

> When uploading page images to S3, always set `ContentType` to `image/png`.
> Without it, S3 serves as `application/octet-stream`, which triggers browser ORB (Opaque Response Blocking) when loaded in `<img>` tags.

```python
import mimetypes

content_type, _ = mimetypes.guess_type(local_path)
s3_client.upload_file(local_path, bucket, s3_key,
    ExtraArgs={"ContentType": content_type or "image/png"})
```

## Storage Schema

### S3 Key Pattern (Domain-Specific)

All apps share a single S3 bucket (`workflow-builder-platform-backend-uploads`). Each app gets its own folder via `S3_APP_PREFIX`:

```
{app_prefix}/{org_id}/{domain_entity}/{entity_id}/pages/{document_name}/page_{n}.png
```

| Project Type | App Prefix | Example Pattern |
|--------------|------------|-----------------|
| PA Review | `pa-review` | `pa-review/{org_id}/cases/{case_id}/pages/{document_name}/page_{n}.png` |
| Invoice Processing | `invoice-processor` | `invoice-processor/{org_id}/invoices/{invoice_id}/pages/{document_name}/page_{n}.png` |
| Document Classification | `doc-classifier` | `doc-classifier/{org_id}/documents/{document_id}/pages/{document_name}/page_{n}.png` |

### Example (PA Review)
```
org_default/cases/91091190/pages/patient_info.pdf/page_1.png
org_default/cases/91091190/pages/patient_info.pdf/page_2.png
org_default/cases/91091190/pages/medical_records.pdf/page_1.png
```

## Image Requirements

| Property | Requirement | Reason |
|----------|-------------|--------|
| Format | PNG | Quality, transparency support |
| DPI | 150 minimum | Readable text, reasonable file size |
| Color | RGB | Standard web display |
| Max Size | 5MB per image | Performance |

## Generation Code

> **IMPORTANT:** Use `StorageService` from `platform-backend-kit/app/modules/storage/service.py` for presigned URL flows.
> For server-side uploads in Celery tasks (page image generation), use direct boto3 with settings from `app.config.get_settings()`.
>
> **ASYNC RULE:** boto3 is synchronous. In `async def` functions (FastAPI handlers, async Celery wrappers),
> wrap ALL S3 calls in `await asyncio.to_thread()` to avoid blocking the event loop.
> In synchronous Celery tasks, call boto3 directly (no wrapping needed).

```python
import asyncio
import fitz  # PyMuPDF
import tempfile
import mimetypes
import boto3
from pathlib import Path
from app.config import get_settings

async def generate_page_images(
    pdf_path: str,
    entity_id: str,  # case_id, invoice_id, document_id (domain-specific)
    org_id: str,
    entity_type: str = "cases",  # Domain-specific: cases, invoices, documents
    dpi: int = 150
) -> dict:
    """
    Generate page images from PDF and upload to S3.

    boto3 is synchronous — all S3 calls are wrapped in asyncio.to_thread()
    to avoid blocking the event loop.

    Args:
        pdf_path: Path to PDF file
        entity_id: Domain-specific ID (case_id, invoice_id, etc.)
        org_id: Organization ID for multi-tenant path
        entity_type: Domain entity name (cases, invoices, documents)
        dpi: Image resolution (minimum 150)

    Returns:
        Dict mapping page numbers (strings) to S3 KEYS (not presigned URLs)
    """
    settings = get_settings()
    s3_client = boto3.client("s3", region_name=settings.aws_region)
    doc = fitz.open(pdf_path)
    document_name = Path(pdf_path).name
    page_urls = {}

    with tempfile.TemporaryDirectory() as temp_dir:
        for page_num in range(len(doc)):
            page = doc[page_num]

            # Render page to image
            mat = fitz.Matrix(dpi / 72, dpi / 72)
            pix = page.get_pixmap(matrix=mat)

            # Save to temp file
            temp_path = f"{temp_dir}/page_{page_num + 1}.png"
            pix.save(temp_path)

            # S3 key — app_prefix isolates this app within the shared bucket
            s3_key = f"{settings.s3_app_prefix}/{org_id}/{entity_type}/{entity_id}/pages/{document_name}/page_{page_num + 1}.png"

            # Upload to S3 — asyncio.to_thread() because boto3 is synchronous
            content_type, _ = mimetypes.guess_type(temp_path)
            await asyncio.to_thread(
                s3_client.upload_file,
                temp_path, settings.s3_bucket_name, s3_key,
                ExtraArgs={"ContentType": content_type or "image/png"},
            )

            # Store S3 KEY (not presigned URL) — URLs are generated on demand in /pdfs endpoint
            page_urls[str(page_num + 1)] = s3_key

    doc.close()
    return page_urls
```

## Database Storage

Store page image metadata with the case:

```python
# In MongoDB cases collection
{
    "case_id": "91091190",
    "page_images": {
        "patient_info.pdf": {
            "page_count": 3,
            "s3_prefix": "default/91091190/page_images/patient_info.pdf/",
            "generated_at": "2024-01-15T10:30:00Z"
        },
        "medical_records.pdf": {
            "page_count": 1,
            "s3_prefix": "default/91091190/page_images/medical_records.pdf/",
            "generated_at": "2024-01-15T10:30:05Z"
        }
    }
}
```

## API Endpoint

```python
@router.get("/{case_id}/pdfs")
async def get_case_pdfs(case_id: str):
    """Return PDF metadata with presigned URLs for page images."""
    case = await db.cases.find_one({"case_id": case_id})

    files = []
    for doc_name, meta in case.get("page_images", {}).items():
        pages = {}
        for page_num in range(1, meta["page_count"] + 1):
            s3_key = f"{meta['s3_prefix']}page_{page_num}.png"
            pages[str(page_num)] = generate_presigned_url(s3_key)

        files.append({
            "name": doc_name,
            "pages": pages
        })

    return {"case_id": case_id, "files": files}
```

## When to Generate

Page images should be generated:

1. **During initial OCR processing** (recommended)
   - Generate while processing PDF for text extraction
   - Single pass through document

2. **On first view request** (lazy generation)
   - Generate when user first views case
   - Higher latency on first view

3. **Batch pre-processing** (background job)
   - Process all PDFs in advance
   - Best performance, highest storage

## Validation Checklist

Before marking Phase 2.5 complete:

- [ ] All PDFs have page images generated
- [ ] Images stored in S3 with correct key pattern
- [ ] Presigned URLs return HTTP 200
- [ ] Images render correctly in PDFViewer
- [ ] Page count matches actual PDF pages
- [ ] Image quality sufficient for text reading

## Common Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| Skip page image generation | Blank PDFViewer | Generate during OCR |
| Store locally, not S3 | Won't work in production | Always use S3 |
| **Store presigned URLs in MongoDB** | **Images break after 1h expiry** | **Store S3 keys, generate URLs on demand** |
| Missing ContentType on upload | Browser ORB blocks images | Set `ContentType=image/png` via mimetypes |
| Short presigned URL expiry | Broken images mid-session | Min 1 hour expiry |
| Wrong DPI (too low) | Unreadable text | Use 150+ DPI |
| Not tracking page count | Can't iterate pages | Store metadata |
