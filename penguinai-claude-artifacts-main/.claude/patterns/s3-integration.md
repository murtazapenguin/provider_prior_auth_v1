# Pattern: S3 Integration

**S3 integration is MANDATORY for all document_processing / file_storage apps. No local fallback.**

---

## S3-Only Rule

| What | Required | Forbidden |
|------|----------|-----------|
| API file responses | S3 presigned URLs | Local file paths |
| PDFViewer data | `presigned_urls` from S3 | Local image paths |
| Document storage | S3 bucket | Local filesystem |
| Page images | S3 presigned URLs | `file://` URLs |

**Allowed local paths (temporary/input only):**
- `data/test_fixtures/` — reading source files for seeding
- `tempfile.TemporaryDirectory()` — temporary processing (auto-cleaned)

**NEVER return local file paths in API responses.**

---

## Environment Variables

```env
S3_BUCKET_NAME=workflow-builder-platform-backend-uploads
S3_APP_PREFIX=your-app-name          # Per-app folder within the shared bucket
S3_PRESIGNED_URL_EXPIRY=3600         # Presigned URL TTL in seconds (default: 3600)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
```

---

## StorageService (platform-backend-kit)

| Method | Purpose |
|--------|---------|
| `generate_upload_url(request, user_id)` | Presigned PUT URL for browser-to-S3 uploads |
| `confirm_upload(file_id, user_id)` | Confirm upload completed, update metadata |
| `generate_download_url(file_id, user_id)` | Presigned GET URL for downloading objects |

---

## Server-Side Upload (Celery Tasks)

For uploading page images or processed files from Celery workers, use direct `boto3`:

```python
import boto3, mimetypes, asyncio
from app.config import get_settings

settings = get_settings()
s3_client = boto3.client("s3", region_name=settings.aws_region)
content_type, _ = mimetypes.guess_type(local_path)
await asyncio.to_thread(
    s3_client.upload_file,
    local_path, settings.s3_bucket_name, s3_key,
    ExtraArgs={"ContentType": content_type or "image/png"}
)
```

**Always set ContentType** — without it, S3 serves `application/octet-stream`, which triggers browser ORB (Opaque Response Blocking) when loaded in `<img>` tags.

---

## S3 Key Pattern

All apps share one bucket. Each app gets its own folder via `S3_APP_PREFIX`:

```
{app_prefix}/{org_id}/items/{item_id}/{filename}.pdf
{app_prefix}/{org_id}/items/{item_id}/pages/{doc_name}/page_{n}.png
```

Customize `items` → `cases`, `documents`, `invoices`, etc. per project.

---

## Generate Presigned Download URL

```python
presigned_url = await asyncio.to_thread(
    s3_client.generate_presigned_url,
    "get_object",
    Params={"Bucket": settings.s3_bucket_name, "Key": s3_key},
    ExpiresIn=settings.s3_presigned_url_expiry,  # from S3_PRESIGNED_URL_EXPIRY env var
)
```

---

## Page Image Generation (PDF → PNG → S3)

See `.claude/contracts/pdfviewer-data.md` for the complete `generate_page_images()` implementation.

**Key points:**
- Use PyMuPDF (`fitz`) at 150 DPI minimum
- Page number keys in `presigned_urls` are **strings** (`"1"`, `"2"`)
- Store S3 keys in MongoDB, generate presigned URLs on demand (they expire)

---

## Where It's Used
- **backend-guide/SKILL.md** — S3 section
- **contracts/pdfviewer-data.md** — page image generation
- **capabilities/document-processing.md** — S3 upload rules
