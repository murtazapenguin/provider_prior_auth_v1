---
name: ai-engineering-guide
description: Build AI applications using PenguinAI SDK - provider-agnostic library for AWS Bedrock, OpenAI, Gemini, Azure. Use for LLM clients, OCR, embeddings, vector search, or document processing. Triggers on penguin, penguinai, LLM, OCR, document AI, or AI pipelines.
---

# AI Engineering Guide

Provider-agnostic AI orchestration library for building production AI applications.

---

## ⛔ CRITICAL REQUIREMENTS - MANDATORY

> **ABSOLUTE RULE - NO EXCEPTIONS:**
>
> **NEVER TRUNCATE OCR/DOCUMENT TEXT:**
> - ❌ `full_text[:8000]` - NEVER do this
> - ❌ `text[:5000]` - NEVER arbitrarily cut text
> - ✅ Pass the FULL document text to LLM
> - ✅ If too long, increase `max_tokens` parameter
> - ✅ If still too long, use continuation (process in parts, combine results)
> - ✅ Use models with larger context windows (Claude 200k, Gemini 1M)
>
> **NO FALLBACKS - ASK USER:**
> - ❌ NEVER implement fallback to alternative libraries when penguin-ai-sdk is unavailable
> - ❌ NEVER silently switch to pytesseract, openai, langchain, etc.
> - ✅ If penguin-ai-sdk is not available, **STOP and ask the user**
> - ✅ Report the error clearly: "penguin-ai-sdk not available. How should I proceed?"
> - ✅ Let user decide: install SDK, use different approach, or skip AI features
>
> ALL AI functionality MUST use `penguin-ai-sdk`. This includes:
> - LLM calls (chat, extraction, agents)
> - OCR (Optical Character Recognition)
> - PDF text extraction
> - Document classification
> - Entity extraction
> - Embeddings and vector search
>
> **FORBIDDEN LIBRARIES - DO NOT USE:**
> | ❌ Forbidden | ✅ Use Instead |
> |--------------|----------------|
> | `pytesseract` | `penguin.ocr` |
> | `openai` | `penguin.core` |
> | `anthropic` | `penguin.core` |
> | `google.generativeai` | `penguin.core` |
> | `boto3` for Bedrock | `penguin.core` |
> | `azure.ai.formrecognizer` | `penguin.ocr` |
> | `langchain` (direct) | Allowed ONLY via `penguin.core` re-exports |
> | Direct API calls | `penguin.*` modules |
>
> The `penguin-ai-sdk` is the **ONLY** approved library for AI operations. LangChain is used internally by v0.2.0 but MUST only be accessed through `penguin.core` re-exports.

---

## Overview

PenguinAI SDK v0.2.0 is a unified AI orchestration library built on LangChain + LangGraph + Langfuse:

- **Core** (`penguin.core`) - Multi-provider LLM (`create_model`), `@tool` decorator, agents (`create_agent`/`run_agent`) — replaces old `penguin.llm`, `penguin.tools`, `penguin.agents`
- **Callbacks** (`penguin.core.callbacks`) - Security guardrails (`create_security_callbacks`) — replaces old `penguin.middleware`
- **Tracing** (`penguin.core.tracing`) - Zero-config Langfuse observability (automatic when env vars set), optional `PenguinTracer` for session grouping, `@observe` for custom function tracing — replaces old `penguin.observability`
- **OCR** (`penguin.ocr`) - Document text extraction (Azure, AWS Textract, Google)
- **Embeddings** (`penguin.embeddings`) - Text vectors (Bedrock Titan, sentence-transformers)
- **Vector DB** (`penguin.vector_db`) - Semantic search (S3 Vectors)
- **Redaction** (`penguin.redaction`) - PII detection and removal
- **Evals** (`penguin.evals`) - LLM-as-judge evaluation with prebuilt criteria templates (`criteria.for_qa()`, `criteria.for_rag()`, etc.) and Langfuse score export

---

## Quick Start

```python
import asyncio
from penguin.core import create_model, HumanMessage

async def main():
    model = create_model(provider="bedrock", model="claude-sonnet-4-5")
    result = await model.ainvoke([HumanMessage(content="Hello")])
    print(result.content)

asyncio.run(main())
```

---

## Installation

```bash
# CPU (Mac/Laptops) — wheel is bundled in the repository root
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install "./packages/penguin_ai_sdk-0.2.0-py3-none-any.whl[cpu]"
```

---

## Key Imports

```python
# Core (LLM, Tools, Agents) — v0.2.0
from penguin.core import create_model, tool, create_agent, run_agent
from penguin.core import HumanMessage, SystemMessage

# State Graphs (advanced agent patterns) — v0.2.0
from penguin.core import StateGraph, MessagesState, ToolNode, START, END, MemorySaver
# Alias also available: create_state_graph (same as StateGraph)

# Tracing (automatic when env vars set) — v0.2.0
from penguin.core.tracing import observe, flush_traces  # @observe for custom functions
from penguin.core.tracing import PenguinTracer           # Optional: session grouping
from penguin.core.callbacks import create_security_callbacks

# OCR & Embeddings
from penguin.ocr import AzureOCRProvider, AWSTextractProvider
from penguin.embeddings import create_embedding_client

# Vector DB
from penguin.vector_db import create_vector_client

# Utilities
from penguin.redaction import PenguinPIIRedactor
from penguin.data_assets import load_asset
```

---

## Providers

| Capability | Default Provider | Model | Selection |
|------------|------------------|-------|-----------|
| **OCR** | Azure Document Intelligence | prebuilt-read | Default |
| **LLM** | **User-selected** | **User-selected** | **Set in HANDOFF.md Phase 0** |

**Supported LLM Providers:** `bedrock` (Claude), `gemini`, `openai`, `azure_openai`

### Bedrock Model IDs (Inference Profiles)

> **CRITICAL:** Bedrock on-demand invocation requires **inference profile IDs**, not raw model IDs. Raw model IDs require provisioned throughput and will fail with `ValidationException`.

| ❌ Raw Model ID (WRONG) | ✅ Inference Profile ID (CORRECT) |
|--------------------------|-----------------------------------|
| `anthropic.claude-3-5-sonnet-20241022-v2:0` | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` |
| `anthropic.claude-3-haiku-20240307-v1:0` | `us.anthropic.claude-3-haiku-20240307-v1:0` |

Inference profile IDs are prefixed with the region group (e.g., `us.`). When the user selects Bedrock as LLM provider, always ask for the **full inference profile ID** and record it in `PENGUIN_LLM_MODEL` env var.

### Environment Variables

```bash
# Azure Document Intelligence (OCR) — always needed for document processing
AZURE_OCR_ENDPOINT=https://penguin-ocr-stage.cognitiveservices.azure.com/
AZURE_OCR_SECRET_KEY=your-azure-key

# LLM — set based on user-selected provider from HANDOFF.md Phase 0:
# If bedrock:       AWS_PROFILE=default, AWS_REGION=us-east-1
# If gemini:        GOOGLE_API_KEY=your-key
# If openai:        OPENAI_API_KEY=your-key
# If azure_openai:  AZURE_OPENAI_ENDPOINT=..., AZURE_OPENAI_API_KEY=...

# Tracing (Langfuse) — v0.2.0
# Tracing is AUTOMATIC — set these env vars and every create_model() call is traced.
# No code changes needed. User MUST create a Langfuse project at https://langfuse.penguinai.co.
LANGFUSE_PUBLIC_KEY=pk-...          # From Langfuse project settings
LANGFUSE_SECRET_KEY=sk-...          # From Langfuse project settings
LANGFUSE_HOST=https://langfuse.penguinai.co
LANGFUSE_PROJECT=your-project-name  # Optional — used as filter tag in Langfuse dashboard
```

---

## Document Processing Pipeline

For document AI workflows (OCR → LLM → Structured Output):

### Basic Pipeline (Azure OCR + LLM via penguin-ai-sdk v0.2.0)

```python
import os
from penguin.ocr import AzureOCRProvider
from penguin.core import create_model
from pydantic import BaseModel
from typing import List, Optional

class EvidenceCitation(BaseModel):
    supporting_texts: List[str]  # Array of OCR excerpts
    reasoning: Optional[str] = None
    confidence: float
    bboxes: List[dict]  # 3-field canonical format

class ICDCode(BaseModel):
    code: str
    description: str
    evidence: EvidenceCitation  # Nested evidence with supporting_texts array

class ICDCodeList(BaseModel):
    """Wrapper for list output — with_structured_output() returns a single object."""
    codes: List[ICDCode]

class DocumentProcessor:
    def __init__(self):
        self.ocr = AzureOCRProvider()  # Azure Document Intelligence
        # Read provider/model from HANDOFF.md Phase 0 or env vars
        self.model = create_model(
            provider=os.getenv("PENGUIN_LLM_PROVIDER", "bedrock"),
            model=os.getenv("PENGUIN_LLM_MODEL", "claude-sonnet-4-5")
        )

    async def process(self, file_path: str) -> List[ICDCode]:
        # Step 1: OCR with Azure
        ocr_result = await self.ocr.process_file(file_path)

        # Step 2: LLM Extraction with structured output
        # NOTE: with_structured_output() returns a single Pydantic object,
        # so wrap lists in a container model (ICDCodeList)
        structured_model = self.model.with_structured_output(ICDCodeList)
        prompt = f"Extract ICD-10 codes from the document.\n\n{ocr_result.full_text}"
        result = await structured_model.ainvoke(prompt)

        return result.codes  # Unwrap from container
```

### OCR Result Format

All OCR providers return normalized results:

```python
class OCRResult:
    file_path: str           # Original file path
    full_text: str           # Complete extracted text (each line formatted as "content || line_number")
    provider: str            # "aws_textract" | "azure_document_intelligence" | "google_document_ai"
    lines: List[OCRLine]     # Line-by-line results
    metadata: Dict           # Provider-specific data

class OCRLine:
    content: str                    # Text content
    page_number: int                # 1-indexed page number
    line_number: int                # Sequential line number within page (starts at 1)
    bounding_box: List[Dict]        # [{x, y}, {x, y}, {x, y}, {x, y}]
    confidence: Optional[float]     # 0.0 - 1.0, None if not available
```

> **`full_text` format:** Each line in `full_text` is formatted as `"content || line_number"`,
> where `line_number` is the 1-based line index within the page. This allows LLMs to reference
> specific lines by number when extracting evidence, which can then be mapped back to bounding boxes
> using `get_bounding_boxes_by_line()`.

> **IMPORTANT — Azure OCR Coordinate Units:**
> Azure Document Intelligence returns bounding box coordinates in **inches**, NOT normalized 0-1.
> You MUST normalize coordinates by dividing by page dimensions before storing.
> See "Bounding Box Normalization" below.

### `get_bounding_boxes_by_line()`

Retrieve bounding boxes for specific OCR line numbers (v0.2.0). This pairs with the `full_text` line-number format to let you map LLM-cited line numbers back to spatial coordinates.

```python
# Signature
OCRResult.get_bounding_boxes_by_line(
    line_numbers: Union[int, List[int]],   # 1-based line number(s)
    page_number: Optional[int] = None      # restrict to a page (None = all pages)
) -> Union[List[Dict[str, float]], Dict[int, List[Dict[str, float]]]]

# Single line → returns bounding box directly
bbox = result.get_bounding_boxes_by_line(5, page_number=1)
# [{"x": 100, "y": 200}, {"x": 500, "y": 200}, ...]

# Multiple lines → returns dict mapping line_number → bounding box
bboxes = result.get_bounding_boxes_by_line([5, 10, 15], page_number=1)
# {5: [...], 10: [...], 15: [...]}
```

Raises `ValueError` if any requested line number is not found or is ≤ 0.

### Bounding Box Format

> **IMPORTANT:** All bboxes MUST use the **canonical format** defined in `.claude/contracts/bbox-format.md`.
> This ensures direct compatibility with PDFViewer - no frontend transformation needed.

Coordinates MUST be normalized (0-1) relative to page dimensions.

#### Bounding Box Normalization (Azure OCR → 0-1)

Azure OCR returns coordinates in **inches** (e.g., `x=1.6, y=5.4`). PDFViewer expects **normalized 0-1** coordinates. You MUST convert using actual PDF page dimensions:

```python
import fitz  # PyMuPDF

# Pre-compute page dimensions (inches) from the PDF
def get_page_dimensions(pdf_path: str) -> dict:
    """Return {page_number: (width_inches, height_inches)} for all pages."""
    doc = fitz.open(pdf_path)
    dims = {}
    for page_num in range(len(doc)):
        rect = doc[page_num].rect
        # PyMuPDF returns points (72 points = 1 inch)
        dims[page_num + 1] = (rect.width / 72.0, rect.height / 72.0)
    doc.close()
    return dims

def to_canonical_bbox(ocr_line, document_name: str, page_dimensions: dict) -> dict:
    """
    Convert OCR line to CANONICAL bbox format for PDFViewer.
    See .claude/contracts/bbox-format.md for full specification.

    Azure OCR coordinates are in inches — normalize to 0-1 using page dimensions.
    In v0.2.0, bounding_box points are always dicts with "x" and "y" keys.
    """
    bbox = ocr_line.bounding_box  # [{x,y}, {x,y}, {x,y}, {x,y}] — 4 dict points
    raw = []
    for pt in bbox:
        raw.extend([float(pt["x"]), float(pt["y"])])

    # Normalize: divide x by page_width, y by page_height (both in inches)
    pw, ph = page_dimensions.get(ocr_line.page_number, (8.5, 11.0))
    coords = [
        raw[0]/pw, raw[1]/ph, raw[2]/pw, raw[3]/ph,
        raw[4]/pw, raw[5]/ph, raw[6]/pw, raw[7]/ph,
    ]

    return {
        "document_name": document_name,        # Must match documentData.files
        "page_number": ocr_line.page_number,   # INTEGER, 1-indexed
        "bbox": [coords]                       # Array of 8-point arrays, normalized 0-1
    }
```

### Canonical Format Schema (3 Fields)

```json
{
  "document_name": "document.pdf",
  "page_number": 1,
  "bbox": [[0.1, 0.2, 0.3, 0.2, 0.3, 0.25, 0.1, 0.25]]
}
```

> **Note:** Label and color mapping is handled by the frontend, not included in bbox objects.

**Rules:**
- `document_name` MUST exactly match filename in `documentData.files`
- `page_number` MUST be 1-indexed INTEGER (e.g., 1, 2, 3)
- Coordinates MUST be normalized (0-1), not pixel values
- Empty `bbox` arrays are FORBIDDEN

---

## Bbox Retrieval: Line-Number Approach (v0.2.0)

**CRITICAL**: Use line-number-based bbox retrieval ONLY. Text matching is deprecated.

### Why Line Numbers?

The penguin-ai-sdk v0.2.0 provides direct line-number-based bbox retrieval which is:
- **Reliable**: No fuzzy matching ambiguity — LLM cites line 5, SDK returns exact bbox for line 5
- **Fast**: O(1) lookup by index instead of O(n) text search through all OCR lines
- **Traceable**: Direct mapping from LLM citation → OCR line → bbox coordinates
- **Simple**: Single SDK method call instead of 298 lines of matching logic

**Problems with text matching (deprecated):**
- Fuzzy matching can match wrong lines (false positives)
- Context expansion adds adjacent lines (false evidence)
- Bidirectional matching complexity (two-pass algorithm)
- Word overlap heuristics (threshold tuning required)
- OCR lines don't align with sentence boundaries (fragmentation issues)

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
       │                 total_line_numbers: [42],
       │                 total_page_numbers: [1],
       │                 total_reasoning: "Found on line 42",
       │                 total_confidence: 0.95
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

See `usage/` directory (single source of truth):
- **`03-DOCUMENT-PROCESSING.md`** — OCR, bbox retrieval, full_text line number format
- **`07-WORKFLOWS-AND-PATTERNS.md`** — Complete document processing workflows

**Utility Module**: `platform-backend-kit/utils/line_number_bbox_utils.py`

### LLM Prompt Pattern

**CRITICAL**: Instruct LLM to cite line numbers from `full_text`:

```python
EXTRACTION_PROMPT = """
CRITICAL: Cite line numbers where you found each piece of evidence.

The full_text format is "content || line_number" (e.g., "Patient: John Smith || 5").

For EACH extracted field that requires evidence:
1. Record the {field}_line_numbers (list of integers) where you found it
2. Record the {field}_page_numbers (list of integers) for each line
3. Provide your {field}_reasoning
4. Provide your {field}_confidence (0.0-1.0)

Example output schema:
{
  "patient_name": "John Smith",
  "patient_name_line_numbers": [5, 6],
  "patient_name_page_numbers": [1, 1],
  "patient_name_reasoning": "Found patient name on lines 5-6 of page 1",
  "patient_name_confidence": 0.98
}
"""
```

### Complete Usage Example

```python
from penguin.ocr import AzureOCRProvider
from utils.line_number_bbox_utils import create_evidence_citation_from_line_numbers

# 1. OCR with full_text line numbers
ocr = AzureOCRProvider()
result = await ocr.process_file("medical_record.pdf")

# full_text now contains: "Patient: John Smith || 1\nDOB: 1980-01-15 || 2\n..."

# 2. LLM extracts evidence with line numbers
llm_output = {
    "patient_name": "John Smith",
    "patient_name_line_numbers": [1],
    "patient_name_page_numbers": [1],
    "patient_name_reasoning": "Found patient name on line 1",
    "patient_name_confidence": 0.98
}

# 3. Create evidence citation with bboxes
evidence_citation = create_evidence_citation_from_line_numbers(
    ocr_result=result,
    line_numbers=llm_output["patient_name_line_numbers"],
    page_number=llm_output["patient_name_page_numbers"][0],
    document_name="medical_record.pdf",
    llm_reasoning=llm_output["patient_name_reasoning"],
    confidence=llm_output["patient_name_confidence"],
    criterion_id="patient_name",
    criterion_name="Patient Name"
)

# Output (following bbox-format contract):
# {
#   "bboxes": [
#     {
#       "document_name": "medical_record.pdf",
#       "page_number": 1,
#       "bbox": [[0.1, 0.15, 0.4, 0.15, 0.4, 0.18, 0.1, 0.18]],
#       "line_numbers": [1]
#     }
#   ],
#   "reasoning": "Found patient name on line 1",
#   "confidence": 0.98,
#   "criterion_id": "patient_name",
#   "criterion_name": "Patient Name"
# }

# 4. Pass to PDFViewer
# <PDFViewer boundingBoxes={evidence_citation.bboxes} ... />
```

---

## Celery Worker Initialization

> **CRITICAL:** Celery workers run as **separate processes**. Any startup logic (reference data loading, model initialization, SDK setup) that runs in `main.py` does NOT automatically run in the worker.

**Required pattern:** Use Celery's `worker_process_init` signal to initialize worker processes:

```python
# celery_app.py
from celery import Celery
from celery.signals import worker_process_init

app = Celery('tasks')

@worker_process_init.connect
def init_worker(**kwargs):
    """Called once per worker process at startup."""
    # Load reference data, initialize caches, etc.
    from utils.reference_data import load_reference_data
    load_reference_data()
```

**Common failures when this is missed:**
- Reference data lookups return `None` — data loaded in FastAPI but not in worker
- SDK clients fail — initialized in main process but not in forked worker
- Env vars missing — worker has different environment from main process

---

## Logging (Required for Debugging)

Add logging to all AI operations:

```python
from loguru import logger

# Log at key points:
logger.info(f"[OCR] Starting for {document_id}")
logger.info(f"[LLM] Extracting codes, text length: {len(text)}")
logger.error(f"[ERROR] Failed: {str(e)}")
```

Use `LOG_LEVEL=DEBUG` in `.env` for verbose output.

---

## Reference Documentation

For complete API documentation and examples, see:

- **[usage/](usage/)** - Comprehensive SDK v0.2.0 documentation (9 modules):
  - `README.md` — Overview and index
  - `00-GETTING-STARTED.md` — Installation, first example
  - `01-CORE-AND-AGENTS.md` — `create_model`, tools, agents, LangGraph
  - `02-TRACING-AND-CALLBACKS.md` — Langfuse tracing, security callbacks
  - `03-DOCUMENT-PROCESSING.md` — OCR, redaction, pipelines
  - `04-EMBEDDINGS-AND-SEARCH.md` — Embeddings, vector DB
  - `05-DATA-AND-COMPLIANCE.md` — Data assets, evals, compliance
  - `06-ML-CAPABILITIES.md` — AutoML, fine-tuning, VLM, blueprints
  - `07-WORKFLOWS-AND-PATTERNS.md` — Common production workflows
- **[PATTERNS.md](PATTERNS.md)** - Detailed code patterns for document processing
- **[templates/](templates/)** - Ready-to-use templates:
  - `ocr_processor.py` - Multi-provider OCR processor
  - `llm_extractor.py` - LLM extraction with structured output
  - `document_pipeline.py` - Full end-to-end document pipeline
