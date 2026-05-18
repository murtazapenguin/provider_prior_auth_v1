# AI Integrator Templates

> Referenced by `.claude/agents/ai-integrator.md`. Read during implementation, not during planning.

---

## Document Processor Template

> **IMPORTANT:** All bboxes MUST use the **canonical 3-field format** defined in `.claude/contracts/bbox-format.md`.
> This ensures direct compatibility with PDFViewer - no frontend transformation needed.

```python
# services/ai_processor.py
from penguin.ocr import AzureOCRProvider
from penguin.core import create_model
from pydantic import BaseModel
from typing import List, Optional
import os
import fitz  # PyMuPDF - NOT pdf2image
import tempfile

class Evidence(BaseModel):
    """Nested evidence structure per extraction-result contract."""
    supporting_texts: List[str]  # Array of verbatim OCR text
    reasoning: Optional[str] = None
    confidence: float
    bboxes: List[dict]  # Canonical 3-field format

class ExtractionField(BaseModel):
    field_name: str
    value: str
    evidence: Evidence  # Nested evidence object

class DocumentProcessor:
    def __init__(self, document_name: str):
        self.ocr = AzureOCRProvider()
        # Provider/model from HANDOFF.md Phase 0 or env vars
        self.model = create_model(
            provider=os.getenv("PENGUIN_LLM_PROVIDER", "bedrock"),
            model=os.getenv("PENGUIN_LLM_MODEL", "claude-sonnet-4-5")
        )
        self.document_name = document_name  # Required for bbox format

    async def process(
        self,
        file_path: str,
        entity_id: str,  # case_id, invoice_id, etc. (domain-specific)
        org_id: str,
        entity_type: str = "cases"  # Domain-specific: cases, invoices, documents
    ) -> dict:
        # 1. Convert PDF to images with fitz, upload to S3, get presigned URLs
        pages = await self._convert_to_images_and_upload(
            file_path, entity_id, org_id, entity_type
        )

        # 2. OCR with Azure
        ocr_result = await self.ocr.process_file(file_path)

        # 3. LLM Extraction — pass FULL text (contains "content || line_number" per line), never truncate
        # CRITICAL: LLM MUST cite line_numbers and page_numbers
        raw_results = await self._extract(ocr_result.full_text)

        # 4. Build nested evidence with canonical bboxes using line-number approach (v0.2.0)
        extracted_fields = []
        for result in raw_results:
            # CRITICAL: result MUST have line_numbers and page_numbers fields
            # LLM schema must include these fields per field for evidence
            if not hasattr(result, 'line_numbers') or not result.line_numbers:
                raise ValueError(
                    f"LLM must return line_numbers for field {result.field_name}. "
                    "Update LLM schema and prompt to cite line numbers."
                )

            bboxes = self._map_bboxes_from_line_numbers(
                line_numbers=result.line_numbers,
                page_number=result.page_numbers[0] if result.page_numbers else 1,
                ocr_result=ocr_result
            )

            # Extract supporting texts from line numbers
            supporting_texts = []
            for line_num in result.line_numbers:
                line_obj = ocr_result.find_line(
                    line_num,
                    page_number=result.page_numbers[0] if result.page_numbers else None
                )
                if line_obj:
                    # Strip line number suffix from full_text format
                    text = line_obj.content.split(" || ")[0] if " || " in line_obj.content else line_obj.content
                    supporting_texts.append(text)

            extracted_fields.append({
                "field_name": result.field_name,
                "value": result.value,
                "evidence": {
                    "supporting_texts": supporting_texts,  # Array of verbatim OCR text
                    "reasoning": result.reasoning,
                    "confidence": result.confidence,
                    "bboxes": bboxes  # Canonical 3-field format with line_numbers
                }
            })

        return {
            "result_id": f"result_{entity_id}",
            "item_id": entity_id,
            "status": "completed",
            "full_text": ocr_result.full_text,
            "page_urls": pages,  # PDFViewer format
            "extracted_fields": extracted_fields,  # Nested evidence structure
        }

    async def _convert_to_images_and_upload(
        self,
        pdf_path: str,
        entity_id: str,
        org_id: str,
        entity_type: str
    ) -> dict:
        """
        Convert PDF pages to images using fitz, upload to S3, return presigned URLs.

        This is the PRODUCTION implementation - page images are stored in S3
        and returned as presigned URLs for PDFViewer consumption.

        boto3 is synchronous — all S3 calls are wrapped in asyncio.to_thread()
        to avoid blocking the event loop. StorageService handles browser presigned
        URL flows; direct boto3 is used here for server-side uploads.

        S3 Key Pattern (domain-specific, prefixed by S3_APP_PREFIX):
            {app_prefix}/{org_id}/{entity_type}/{entity_id}/pages/{document_name}/page_{n}.png
        """
        import asyncio
        import boto3
        import mimetypes
        from app.config import get_settings

        settings = get_settings()
        s3_client = boto3.client("s3", region_name=settings.aws_region)
        doc = fitz.open(pdf_path)
        presigned_urls = {}

        with tempfile.TemporaryDirectory() as temp_dir:
            for page_num in range(len(doc)):
                page = doc[page_num]

                # Render at 150 DPI
                mat = fitz.Matrix(150/72, 150/72)
                pix = page.get_pixmap(matrix=mat)

                # Save locally first
                local_path = f"{temp_dir}/page_{page_num + 1}.png"
                pix.save(local_path)

                # Upload to S3 — asyncio.to_thread() because boto3 is synchronous
                s3_key = f"{settings.s3_app_prefix}/{org_id}/{entity_type}/{entity_id}/pages/{self.document_name}/page_{page_num + 1}.png"
                content_type, _ = mimetypes.guess_type(local_path)
                await asyncio.to_thread(
                    s3_client.upload_file,
                    local_path, settings.s3_bucket_name, s3_key,
                    ExtraArgs={"ContentType": content_type or "image/png"},
                )

                # Generate presigned URL (1 hour expiry)
                # Page number as STRING for JSON key consistency
                presigned_urls[str(page_num + 1)] = await asyncio.to_thread(
                    s3_client.generate_presigned_url,
                    "get_object",
                    Params={"Bucket": settings.s3_bucket_name, "Key": s3_key},
                    ExpiresIn=settings.s3_presigned_url_expiry,
                )

        doc.close()
        return presigned_urls  # Returns S3 presigned URLs for PDFViewer

    async def _extract(self, text: str) -> List:
        # Customize system prompt per domain (from HANDOFF.md Phase 0)
        # with_structured_output() returns a single object — use wrapper for lists
        class ExtractionFieldList(BaseModel):
            fields: List[ExtractionField]

        structured_model = self.model.with_structured_output(ExtractionFieldList)
        prompt = f"Extract structured data from this document.\n\n{text}"
        result = await structured_model.ainvoke(prompt)
        return result.fields

    def _map_bboxes_from_line_numbers(
        self,
        line_numbers: List[int],
        page_number: int,
        ocr_result
    ) -> List[dict]:
        """
        Map line numbers to bounding boxes using penguin-ai-sdk (v0.2.0).

        **DO NOT Use Text Matching**: This approach is DEPRECATED and unreliable.
        Use line-number-based bbox retrieval ONLY.

        Args:
            line_numbers: List of line numbers cited by LLM (1-indexed)
            page_number: Page number where lines are located (1-indexed)
            ocr_result: OCR result object from penguin-ai-sdk

        Returns:
            List of bboxes in CANONICAL 3-field format per .claude/contracts/bbox-format.md
            with line_numbers field included for traceability

        Benefits:
        - Reliable: No fuzzy matching ambiguity
        - Fast: O(1) lookup by index instead of O(n) text search
        - Traceable: Direct mapping from LLM citation → OCR line → bbox
        """
        from utils.line_number_bbox_utils import get_bboxes_from_line_numbers  # project-local (from platform-backend-kit)
        from loguru import logger

        try:
            # Use SDK utility to get bboxes in canonical format
            bboxes = get_bboxes_from_line_numbers(
                ocr_result=ocr_result,
                line_numbers=line_numbers,
                page_number=page_number,
                document_name=self.document_name,
                include_line_numbers_field=True  # Include for traceability
            )

            return bboxes

        except ValueError as e:
            # Line number not found in OCR result
            logger.warning(f"Failed to get bboxes for line numbers {line_numbers}: {e}")
            return []
        except Exception as e:
            # Unexpected error
            logger.error(f"Unexpected error getting bboxes for line numbers {line_numbers}: {e}")
            return []
```

---

## Celery Task Template

```python
# tasks/processing_task.py
from celery import shared_task
from services.ai_processor import DocumentProcessor

@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=10,
    retry_backoff=True,
    retry_backoff_max=90,
)
def process_document(self, file_path: str, item_id: str, org_id: str):
    """Process document via OCR + LLM. Dispatched on upload, returns via WebSocket."""
    try:
        import asyncio
        import os

        # Extract document name for canonical bbox format
        document_name = os.path.basename(file_path)
        processor = DocumentProcessor(document_name=document_name)

        # Pass org_id for multi-tenant S3 paths
        result = asyncio.run(processor.process(file_path, item_id, org_id))

        # Store result in MongoDB
        # Update work item status to "review"
        # Notify via WebSocket: {"status": "completed", "result_id": "..."}
        return result

    except Exception as exc:
        if self.request.retries < self.max_retries:
            # Notify via WebSocket: {"status": "retrying"}
            raise self.retry(exc=exc)
        else:
            # Final failure — update status to "failed", log to AuditLog
            # Notify via WebSocket: {"status": "failed", "message": str(exc)}
            raise
```

---

## Upload Route Integration (Async Pattern)

```python
# In the upload route — dispatch Celery task, return 202
@router.post("/items/{item_id}/process", status_code=202)
async def process_item(item_id: str):
    item = await db.work_items.find_one({"id": item_id})
    if not item:
        raise HTTPException(404, "Item not found")

    task = process_document.delay(item["file_path"], item_id, item["org_id"])

    await db.processing_jobs.insert_one({
        "job_id": task.id,
        "item_id": item_id,
        "org_id": item["org_id"],
        "status": "pending",
    })

    return {"job_id": task.id, "status": "pending", "message": "Processing started"}
```

---

## Output Format

When complete, the Phase 2.5 section in HANDOFF.md must include:

```json
{
  "pipeline": {
    "ocr_provider": "Azure Document Intelligence",
    "llm_provider": "{Phase 0 selected provider}",
    "extraction_schema": "ExtractionResult"
  },
  "celery_task": {
    "name": "process_document",
    "queue": "default",
    "retry_policy": "3 retries, exponential backoff (10s, 30s, 90s)"
  },
  "bbox_format": {
    "type": "canonical",
    "reference": ".claude/contracts/bbox-format.md",
    "schema": {
      "document_name": "string (must match documentData.files)",
      "page_number": "int (1-indexed, e.g., 1, 2, 3)",
      "bbox": "[[x1,y1,x2,y2,x3,y3,x4,y4]]"
    },
    "note": "3 fields only - label/color handled by frontend"
  },
  "extraction_format": {
    "type": "nested evidence",
    "reference": ".claude/contracts/extraction-result.md",
    "schema": {
      "field_name": "string",
      "value": "any",
      "evidence": {
        "supporting_texts": "string[] (array)",
        "reasoning": "string (optional)",
        "confidence": "float (0-1)",
        "bboxes": "array of canonical bbox objects"
      }
    }
  },
  "env_vars": [
    "AZURE_OCR_ENDPOINT",
    "AZURE_OCR_SECRET_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY"
  ],
  "files_created": [
    "backend/services/ai_processor.py",
    "backend/tasks/processing_task.py"
  ],
  "test_results": {
    "sample_pdf_processed": true,
    "ocr_working": true,
    "llm_working": true,
    "bbox_mapping": true,
    "bbox_renders_in_pdfviewer": true
  }
}
```

---

## Return Format

When complete, return:

```markdown
## AI Integrator Complete

### Files Created
- services/ai_processor.py - Document processing service
- tasks/processing_task.py - Celery task with retry policy

### Configuration
- OCR Provider: Azure Document Intelligence
- LLM Provider: {Phase 0 selected provider and model}
- Environment variables added to .env

### Production Verification
- TODO/FIXME grep: 0 results
- Forbidden imports grep: 0 results
- All AI via penguin-ai-sdk: Yes

### Integration
- Upload route dispatches Celery task (HTTP 202)
- ExtractionResult stored in MongoDB
- Bounding boxes mapped for PDFViewer
- WebSocket notifications on completion/failure

### Test Results
- Sample PDF processed: [YES/NO]
- OCR extraction: [Working/Failed]
- LLM structured output: [Working/Failed]
- Bounding box mapping: [Working/Failed]

### HANDOFF.md
- Phase 2.5 section appended with pipeline config, task details, bbox format

Ready for Phase 3: quality-tester
```
