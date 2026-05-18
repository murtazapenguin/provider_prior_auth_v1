# Reference: Production Seed Data Pattern

> **CRITICAL:** Seed data must follow production patterns — multi-tenant, S3-integrated, with real bboxes.
>
> **NOTE:** Uses **generic canonical names** from `orchestrator/templates.md`. Customize collection names and fields per your project domain.

## Requirements

1. **Multi-tenant:** All seeded documents MUST include `org_id`
2. **S3 Integration:** PDFs and page images uploaded to S3, not local filesystem — see `.claude/patterns/s3-integration.md`
3. **Real Bboxes:** Extraction results MUST include canonical bboxes (never empty arrays for TRUE verdicts) — see `.claude/contracts/bbox-format.md`
4. **Golden Case:** Link seed data to test fixtures for verification

## S3 Key Patterns

All apps share a single bucket (`workflow-builder-platform-backend-uploads`). Each app gets its own folder via `S3_APP_PREFIX`:

```
# Generic pattern (customize per project)
{app_prefix}/{org_id}/items/{item_id}/{filename}.pdf
{app_prefix}/{org_id}/items/{item_id}/pages/{doc_name}/page_{n}.png

# Example for PA Review (S3_APP_PREFIX=pa-review):
# pa-review/{org_id}/cases/{case_id}/{filename}.pdf
# pa-review/{org_id}/cases/{case_id}/pages/{doc_name}/page_{n}.png
```

## Production Seed Script Pattern

```python
# scripts/seed_data.py
# Customize collection names and fields per your project domain.
# See customization comments marked with "# Customize:" below.

import asyncio
import boto3, mimetypes
from app.config import get_settings
from utils.db_utils import db
from auth import get_password_hash
from datetime import datetime
from uuid import uuid4

async def seed_production():
    """
    Customization Guide:
    - Collection names: work_items → cases, documents, invoices, etc.
    - Primary key: item_id → case_id, document_id, invoice_id, etc.
    - Domain fields: title → patient_name, invoice_number, etc.
    - Extraction: extracted_fields → criteria_evaluations, line_items, etc.
    """
    org_id = "org_default"

    # 1. Users with org_id (REQUIRED - standard schema)
    await db.users.delete_many({})
    await db.users.insert_many([
        {
            "_id": str(uuid4()),
            "email": "demo@penguinai.co",
            "org_id": org_id,
            "role": "reviewer",  # Customize: roles per project
            "hashed_password": get_password_hash("demo123"),
            "created_at": datetime.utcnow()
        },
        {
            "_id": str(uuid4()),
            "email": "admin@penguinai.co",
            "org_id": org_id,
            "role": "admin",
            "hashed_password": get_password_hash("admin123"),
            "created_at": datetime.utcnow()
        }
    ])

    # 2. Upload PDFs to S3 (REQUIRED for document processing apps)
    golden_item_id = "golden_001"  # Customize: golden_case_id, etc.
    local_pdf = "data/test_fixtures/golden_case/input/document.pdf"
    settings = get_settings()
    s3_pdf_key = f"{settings.s3_app_prefix}/{org_id}/items/{golden_item_id}/document.pdf"
    s3_client = boto3.client("s3", region_name=settings.aws_region)
    content_type, _ = mimetypes.guess_type(local_pdf)
    await asyncio.to_thread(
        s3_client.upload_file,
        local_pdf, settings.s3_bucket_name, s3_pdf_key,
        ExtraArgs={"ContentType": content_type or "application/pdf"},
    )

    # 3. Generate and upload page images
    page_urls = await generate_and_upload_page_images(
        pdf_path=local_pdf,
        org_id=org_id,
        item_id=golden_item_id,
        document_name="document.pdf"
    )

    # 4. Create work item with S3 references
    # Customize: db.work_items → db.cases, db.documents, db.invoices, etc.
    await db.work_items.delete_many({})
    await db.work_items.insert_one({
        "_id": str(uuid4()),
        "item_id": golden_item_id,
        "org_id": org_id,
        "title": "Golden Test Item",  # Customize: patient_name, invoice_number, etc.
        "status": "ready_for_review",  # Use status enums from HANDOFF.md Phase 0
        "source_files": ["document.pdf"],
        "page_urls": {"document.pdf": page_urls},
        "pdf_s3_key": s3_pdf_key,
        "created_at": datetime.utcnow()
    })

    # 5. Extraction results with nested evidence and canonical bboxes
    # Customize: db.extraction_results → db.evaluations, db.extractions, etc.
    await db.extraction_results.delete_many({})
    await db.extraction_results.insert_one({
        "_id": str(uuid4()),
        "result_id": f"result_{golden_item_id}",
        "item_id": golden_item_id,
        "org_id": org_id,
        "status": "completed",
        "extracted_fields": [
            {
                "field_name": "example_field_1",
                "value": "Example extracted value",
                "evidence": {
                    "supporting_texts": ["Source text from the document"],
                    "reasoning": "Explanation of why this value was extracted",
                    "confidence": 0.95,
                    "bboxes": [{
                        "document_name": "document.pdf",
                        "page_number": 1,  # INTEGER, 1-indexed
                        "bbox": [[0.1, 0.15, 0.4, 0.15, 0.4, 0.18, 0.1, 0.18]]
                    }]
                }
            }
        ],
        "ai_decision": "APPROVE",
        "created_at": datetime.utcnow()
    })

    print(f"Seeded: 2 users, 1 work item with S3 integration, 1 extraction result with bboxes")


async def generate_and_upload_page_images(
    pdf_path: str,
    org_id: str,
    item_id: str,
    document_name: str,
    entity_type: str = "items"  # Customize: cases, invoices, documents, etc.
) -> dict:
    """
    Convert PDF to page images using fitz, upload to S3, return presigned URLs.
    boto3 is synchronous — all S3 calls wrapped in asyncio.to_thread().
    """
    import fitz  # PyMuPDF - NOT pdf2image
    import tempfile

    settings = get_settings()
    s3_client = boto3.client("s3", region_name=settings.aws_region)
    doc = fitz.open(pdf_path)
    presigned_urls = {}

    with tempfile.TemporaryDirectory() as temp_dir:
        for page_num in range(len(doc)):
            page = doc[page_num]
            mat = fitz.Matrix(150/72, 150/72)  # 150 DPI
            pix = page.get_pixmap(matrix=mat)

            local_path = f"{temp_dir}/page_{page_num + 1}.png"
            pix.save(local_path)

            s3_key = f"{settings.s3_app_prefix}/{org_id}/{entity_type}/{item_id}/pages/{document_name}/page_{page_num + 1}.png"
            content_type, _ = mimetypes.guess_type(local_path)
            await asyncio.to_thread(
                s3_client.upload_file,
                local_path, settings.s3_bucket_name, s3_key,
                ExtraArgs={"ContentType": content_type or "image/png"},
            )
            presigned_urls[str(page_num + 1)] = await asyncio.to_thread(
                s3_client.generate_presigned_url,
                "get_object",
                Params={"Bucket": settings.s3_bucket_name, "Key": s3_key},
                ExpiresIn=settings.s3_presigned_url_expiry,
            )

    doc.close()
    return presigned_urls


if __name__ == "__main__":
    asyncio.run(seed_production())
```

## Customization Examples

| Generic Name | PA Review | Invoice Processing | Document Classification |
|--------------|-----------|-------------------|------------------------|
| `db.work_items` | `db.cases` | `db.invoices` | `db.documents` |
| `item_id` | `case_id` | `invoice_id` | `document_id` |
| `title` | `patient_name` | `vendor_name` | `document_title` |
| `extracted_fields` | `criteria_evaluations` | `line_items` | `classifications` |
| `field_name` | `question_id` | `line_item_id` | `category` |
| `value` | `verdict` (bool) | `amount` (float) | `class_label` (str) |

## Golden Case Fixture Integration

```
data/test_fixtures/
├── golden_case/
│   ├── input/
│   │   └── document.pdf          # Source PDF for seeding
│   ├── expected_output.json      # Expected extraction output
│   └── README.md
```

`expected_output.json` should define:
- `expected_decision`: APPROVE | DENY (or per-domain outcome)
- `min_bboxes`: Minimum bbox count (never 0)
- `required_fields`: Fields that must have bboxes
