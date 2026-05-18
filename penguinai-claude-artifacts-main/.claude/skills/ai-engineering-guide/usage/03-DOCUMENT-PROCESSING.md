← [Previous: 02-TRACING-AND-CALLBACKS.md](02-TRACING-AND-CALLBACKS.md) | [Home](README.md) | [Next: 04-EMBEDDINGS-AND-SEARCH.md](04-EMBEDDINGS-AND-SEARCH.md) →

---

# Document Processing - OCR and Redaction

Extract text from documents and detect/remove personally identifiable information (PII).

**Modules**: `penguin.ocr` and `penguin.redaction`

---

## Overview

This guide covers two essential document processing capabilities:

1. **OCR Module** - Extract text from PDFs, images, and scanned documents
2. **Redaction Module** - Detect and remove PII for privacy compliance

**Common pipeline**: OCR → Redaction → LLM Processing → Store Results

---

## OCR Module

### What is it?

The OCR (Optical Character Recognition) module extracts **text from documents** - PDFs, scanned images, photos of documents, etc. It supports multiple cloud providers, each with different strengths.

### When to use it?

- **Document digitization**: Convert scanned PDFs to searchable text
- **Data extraction**: Pull information from forms, invoices, medical records
- **Image text extraction**: Read text from photos or screenshots
- **Batch processing**: Process hundreds of documents efficiently

### Supported Providers

| Provider | Description |
|----------|-------------|
| **Azure Document Intelligence** | General-purpose OCR with line-level confidence scores |
| **AWS Textract** | AWS service with table/form extraction support |
| **Google Document AI** | Google's OCR with multi-language support |

### Key Concepts

| Concept | Description |
|---------|-------------|
| **OCRResult** | Contains full text, line-by-line data, and metadata |
| **OCRLine** | Individual line with text, confidence score, bounding box |
| **Batch processing** | Process multiple files concurrently with rate limiting |
| **Confidence score** | How certain the OCR is about each piece of text (0-1) |

### Choosing a Provider

- **Azure**: Good default for general documents
- **AWS Textract**: Use when you need table/form extraction
- **Google**: Good for multi-language documents

### Simple Example: Process a PDF

```python
import asyncio
from penguin.ocr import AzureOCRProvider

async def main():
    # Create OCR provider (requires AZURE_OCR_ENDPOINT and AZURE_OCR_SECRET_KEY env vars)
    ocr = AzureOCRProvider()

    # Process a single file
    result = await ocr.process_file("document.pdf")

    # Get the full extracted text (includes line numbers: "text || line_number")
    print("=== Extracted Text ===")
    print(result.full_text[:500])  # First 500 chars
    # Output format: "Invoice || 1\nDate: 2024-01-15 || 2\nTotal: $500.00 || 3"

    # Access line-by-line data with confidence scores
    print("\n=== Line Details ===")
    for line in result.lines[:5]:  # First 5 lines
        print(f"Page {line.page_number}, Line {line.line_number}: {line.content}")
        print(f"  Confidence: {line.confidence:.2%}")

asyncio.run(main())
```

### Batch Processing

Process multiple files concurrently:

```python
import asyncio
from penguin.ocr import AzureOCRProvider

async def main():
    ocr = AzureOCRProvider()

    # Process multiple files concurrently
    files = ["doc1.pdf", "doc2.pdf", "doc3.pdf"]
    results = await ocr.process_batch(
        files,
        max_concurrency=3  # Process 3 files at a time
    )

    for result in results:
        print(f"{result.file_path}: {len(result.full_text)} characters")

asyncio.run(main())
```

### Using AWS Textract

```python
import asyncio
from penguin.ocr import AWSTextractProvider

async def main():
    # AWS Textract with table/form extraction
    ocr = AWSTextractProvider(
        extract_tables=True,
        extract_forms=True
    )

    result = await ocr.process_file("form.pdf")
    print(result.full_text)

asyncio.run(main())
```

### Querying OCR Results

After processing, you can query specific lines and convert them to canonical bbox format for highlighting:

```python
import asyncio
from penguin.ocr import AzureOCRProvider

async def main():
    ocr = AzureOCRProvider()
    result = await ocr.process_file("invoice.pdf")

    # Method 1: Find a specific line (returns OCRLine object)
    line = result.find_line(line_number=5, page_number=1)
    if line:
        print(f"Content: {line.content}")
        print(f"Confidence: {line.confidence}")
        print(f"Bounding box: {line.bounding_box}")

    # Method 2: Get bounding boxes by line number
    # Single line
    bbox = result.get_bounding_boxes_by_line(5, page_number=1)
    print(f"Line 5 bbox: {bbox}")  # [{"x": 100, "y": 200}, ...]

    # Multiple lines
    bboxes = result.get_bounding_boxes_by_line([5, 10, 15], page_number=1)
    print(f"Multiple bboxes: {bboxes}")  # {5: [...], 10: [...], 15: [...]}

    # Method 3: Get line as bbox dict (contract format, normalized 0-1 coordinates)
    bbox_dict = result.find_line_as_bbox(
        line_number=5,
        page_number=1,
        include_page_dimensions=False
    )
    if bbox_dict:
        print(f"Document: {bbox_dict['document_name']}")
        print(f"Page: {bbox_dict['page_number']}")
        print(f"Bbox: {bbox_dict['bbox']}")  # [[x1, y1, x2, y2, ...]]

asyncio.run(main())
```

**Note:** Line numbers are 1-based and reset to 1 on each new page. The `full_text` field includes line numbers in the format: `"text content || line_number"` to make it easy to correlate text with line numbers.

### Bbox Format Conversion

Convert OCR results to canonical bbox format for PDFViewer highlighting:

```python
import asyncio
from penguin.ocr import AzureOCRProvider, ocr_result_to_bbox_format, strip_page_dimensions

async def main():
    ocr = AzureOCRProvider()
    result = await ocr.process_file("document.pdf")

    # Convert specific lines as evidence
    evidence_bbox_list = ocr_result_to_bbox_format(
        result,
        line_numbers=[5, 10, 15],  # Lines with evidence
        page_number=1
    )

    # Strip page dimensions for PDFViewer
    consumer_bbox_list = strip_page_dimensions(evidence_bbox_list)

    # Use in PDFViewer
    for bbox_dict in consumer_bbox_list:
        print(f"Highlight: {bbox_dict['document_name']} page {bbox_dict['page_number']}")
        print(f"Coordinates: {bbox_dict['bbox']}")

asyncio.run(main())
```

**Output format:**

```python
{
    "document_name": "document.pdf",
    "page_number": 1,
    "bbox": [[0.1176, 0.1364, 0.5294, 0.1364, ...]]  # Normalized 0-1
}
```

---

## Redaction Module

### What is it?

The Redaction module **detects and removes Personally Identifiable Information (PII)** from text. This is essential for privacy compliance, especially when processing documents that might contain sensitive data before sending them to LLMs or storing them.

### When to use it?

- **Privacy compliance**: GDPR, HIPAA, CCPA requirements
- **Before LLM processing**: Remove sensitive data before sending to external AI
- **Data anonymization**: Prepare datasets for analysis without exposing PII
- **Document processing**: Clean OCR output before further processing
- **Audit trails**: Log interactions without capturing personal data

### Supported PII Types

| Type | Examples |
|------|----------|
| `NAME` | John Smith, Dr. Jane Doe |
| `EMAIL_ADDRESS` | john@example.com |
| `DOB` | 01/15/1985, January 15, 1985 |
| `DATE` | General dates |
| `LOCATION_ADDRESS` | 123 Main St, New York, NY 10001 |
| `NUMERICAL_PII` | SSN, phone numbers, account numbers |
| `PASSWORD` | Detected password strings |

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Redaction** | Replacing PII with placeholder like `[NAME]` |
| **Detection** | Finding PII without modifying the text |
| **PIIEntity** | Detected entity with text, label, and position |
| **Confidence** | How certain the model is about the detection |

### Processing Pipeline Best Practice

```
OCR → Redaction → LLM Processing → Store Results
```

Always redact before sending to LLMs to prevent leaking sensitive data.

### Simple Example: Redact PII from Text

```python
from penguin.redaction import PenguinPIIRedactor

# Create redactor
redactor = PenguinPIIRedactor()

# Check supported PII types
print("Supported PII types:", redactor.get_supported_labels())
# Output: {'NAME', 'EMAIL_ADDRESS', 'DOB', 'DATE', 'LOCATION_ADDRESS', 'NUMERICAL_PII', 'PASSWORD'}

# Example 1: Simple redaction
text = "John Smith's email is john.smith@company.com and he was born on 01/15/1985."
redacted = redactor.redact(text)
print(f"Original: {text}")
print(f"Redacted: {redacted}")
# Output: "[NAME] [NAME]'s email is [EMAIL_ADDRESS] and he was born on [DOB]."

# Example 2: Detect entities without redacting
entities = redactor.predict(text)
print("\nDetected entities:")
for entity in entities:
    print(f"  '{entity.text}' -> {entity.label} (position: {entity.start}-{entity.end})")

# Example 3: Get full details
result = redactor.redact_with_details(text)
print(f"\nOriginal: {result.original_text}")
print(f"Redacted: {result.redacted_text}")
print(f"Entities found: {len(result.entities)}")
```

### Complete Document Processing Pipeline

Combine OCR and Redaction before LLM processing:

```python
import asyncio
from penguin.core import create_model, HumanMessage
from penguin.ocr import AzureOCRProvider
from penguin.redaction import PenguinPIIRedactor
from pydantic import BaseModel
from typing import List

class MedicalInfo(BaseModel):
    diagnosis: str
    medications: List[str]
    icd_codes: List[str]

async def process_medical_document(pdf_path: str) -> dict:
    # Step 1: OCR the document
    ocr = AzureOCRProvider()
    ocr_result = await ocr.process_file(pdf_path)
    print(f"Extracted {len(ocr_result.full_text)} characters")

    # Step 2: Redact PII
    redactor = PenguinPIIRedactor()
    clean_text = redactor.redact(ocr_result.full_text)
    print(f"Redacted PII, safe text length: {len(clean_text)}")

    # Step 3: Extract structured data with LLM
    llm = create_model(provider="bedrock", model="claude-sonnet-4-5")
    structured_llm = llm.with_structured_output(MedicalInfo)
    result = structured_llm.invoke([
        HumanMessage(content=f"Extract medical information:\n\n{clean_text}")
    ])

    return {
        "diagnosis": result.diagnosis,
        "medications": result.medications,
        "icd_codes": result.icd_codes
    }

# Run
extraction = asyncio.run(process_medical_document("patient_record.pdf"))
print(f"Diagnosis: {extraction['diagnosis']}")
print(f"Medications: {extraction['medications']}")
```

---

## Next Steps

**Continue learning:**
- **[04-EMBEDDINGS-AND-SEARCH.md](04-EMBEDDINGS-AND-SEARCH.md)** - Build RAG pipelines
- **[07-WORKFLOWS-AND-PATTERNS.md#workflow-4](07-WORKFLOWS-AND-PATTERNS.md#workflow-4-document-processing-pipeline)** - Complete workflow example

**Related:**
- **[01-CORE-AND-AGENTS.md](01-CORE-AND-AGENTS.md)** - Core API for LLM processing
- **[06-ML-CAPABILITIES.md#vlm-module](06-ML-CAPABILITIES.md#vlm-module)** - Vision models as OCR alternative

---

← [Previous: 02-TRACING-AND-CALLBACKS.md](02-TRACING-AND-CALLBACKS.md) | [Home](README.md) | [Next: 04-EMBEDDINGS-AND-SEARCH.md](04-EMBEDDINGS-AND-SEARCH.md) →
