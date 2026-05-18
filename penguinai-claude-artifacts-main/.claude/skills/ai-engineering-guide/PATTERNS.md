# AI Engineering Code Patterns

This document contains detailed code patterns for document processing using the penguin-ai-sdk.

---

## Table of Contents

1. [OCR Patterns](#ocr-patterns)
2. [LLM Patterns](#llm-patterns)
3. [Tool Definition Patterns](#tool-definition-patterns)
4. [Bounding Box Patterns](#bounding-box-patterns)
5. [Error Handling Patterns](#error-handling-patterns)
6. [Async Patterns](#async-patterns)

---

## OCR Patterns

### AWS Textract

```python
import asyncio
from penguin.ocr import AWSTextractProvider, OCRResult

class TextractProcessor:
    """AWS Textract OCR processor with automatic PDF handling."""

    def __init__(
        self,
        region_name: str = "us-east-1",
        s3_bucket: str = None,
        extract_tables: bool = True,
        extract_forms: bool = True
    ):
        self.ocr = AWSTextractProvider(
            region_name=region_name,
            s3_bucket=s3_bucket,
            extract_tables=extract_tables,
            extract_forms=extract_forms,
            use_async_for_large_files=True,
            size_threshold_mb=10
        )

    async def process_single(self, file_path: str) -> OCRResult:
        """Process a single document."""
        return await self.ocr.process_file(file_path)

    async def process_batch(
        self,
        file_paths: list,
        max_concurrency: int = 5
    ) -> list:
        """Process multiple documents in parallel."""
        return await self.ocr.process_batch(
            file_paths,
            max_concurrency=max_concurrency
        )

    def extract_text_by_page(self, result: OCRResult) -> dict:
        """Group extracted text by page number."""
        pages = {}
        for line in result.lines:
            page = line.page_number
            if page not in pages:
                pages[page] = []
            pages[page].append({
                "text": line.content,
                "confidence": line.confidence,
                "bbox": line.bounding_box
            })
        return pages
```

### Azure Document Intelligence

```python
from penguin.ocr import AzureOCRProvider

class AzureProcessor:
    """Azure Document Intelligence processor."""

    def __init__(
        self,
        endpoint: str = None,
        key: str = None,
        model_id: str = "prebuilt-read"
    ):
        import os
        self.ocr = AzureOCRProvider(
            endpoint=endpoint or os.getenv("AZURE_OCR_ENDPOINT"),
            key=key or os.getenv("AZURE_OCR_SECRET_KEY"),
            model_id=model_id
        )

    async def process(self, file_path: str) -> dict:
        result = await self.ocr.process_file(file_path)
        # Note: full_text contains "content || line_number" per line (v0.2.0)
        return {
            "text": result.full_text,
            "lines": [
                {
                    "content": line.content,
                    "page": line.page_number,
                    "line_number": line.line_number,
                    "bbox": line.bounding_box,
                    "confidence": line.confidence
                }
                for line in result.lines
            ],
            "provider": result.provider
        }
```

### Google Document AI

```python
from penguin.ocr.providers.google import GoogleDocumentAIProvider

class GoogleProcessor:
    """Google Document AI processor."""

    def __init__(
        self,
        project_id: str,
        location: str = "us",
        processor_id: str = None
    ):
        self.ocr = GoogleDocumentAIProvider(
            project_id=project_id,
            location=location,
            processor_id=processor_id
        )

    async def process(self, file_path: str) -> dict:
        result = await self.ocr.process_file(file_path)
        # Note: full_text contains "content || line_number" per line (v0.2.0)
        return {
            "text": result.full_text,
            "lines": result.lines,
            "metadata": result.metadata
        }
```

---

## LLM Patterns

### Basic Completion

```python
from penguin.core import create_model
from penguin.core import HumanMessage, SystemMessage

async def simple_extraction(text: str, prompt: str) -> str:
    """Simple text-to-text extraction."""
    model = create_model(provider="bedrock", model="claude-sonnet-4-5")

    result = await model.ainvoke([
        SystemMessage(content=prompt),
        HumanMessage(content=text)
    ])

    return result.content
```

### Structured Output with Pydantic

```python
from penguin.core import create_model
from pydantic import BaseModel, Field
from typing import List, Optional
from enum import Enum

class Severity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

class MedicalFinding(BaseModel):
    """Structured medical finding from document."""
    finding: str = Field(description="Description of the finding")
    location: str = Field(description="Body location or system")
    severity: Severity = Field(description="Clinical severity")
    icd_code: Optional[str] = Field(description="Related ICD-10 code")
    confidence: float = Field(ge=0, le=1, description="Confidence 0-1")
    source_text: str = Field(description="Original text from document")

class ExtractionResult(BaseModel):
    """Complete extraction result."""
    findings: List[MedicalFinding]
    summary: str
    document_type: str

async def extract_structured(text: str) -> ExtractionResult:
    """Extract structured data from medical text."""
    model = create_model(provider="bedrock", model="claude-sonnet-4-5")
    structured_model = model.with_structured_output(ExtractionResult)

    prompt = f"""You are a medical document analyzer.
    Extract all medical findings with ICD-10 codes when applicable.
    Be precise with source_text - use exact quotes.

    Analyze this document:

    {text}"""

    result = await structured_model.ainvoke(prompt)
    return result
```

### Multi-turn Conversation

```python
from penguin.core import create_model
from penguin.core import HumanMessage, SystemMessage, AIMessage

class ConversationalExtractor:
    """Multi-turn extraction with context using message history."""

    def __init__(self, system_prompt: str):
        self.model = create_model(provider="bedrock", model="claude-sonnet-4-5")
        self.messages = [SystemMessage(content=system_prompt)]

    async def extract_with_followup(self, text: str) -> dict:
        # Initial extraction
        self.messages.append(HumanMessage(content=f"Analyze this document and identify key entities:\n\n{text}"))
        response1 = await self.model.ainvoke(self.messages)
        self.messages.append(AIMessage(content=response1.content))

        # Follow-up for clarification
        self.messages.append(HumanMessage(content="Now provide ICD-10 codes for each identified condition."))
        response2 = await self.model.ainvoke(self.messages)
        self.messages.append(AIMessage(content=response2.content))

        # Final summary
        self.messages.append(HumanMessage(content="Summarize the findings in a structured format."))
        response3 = await self.model.ainvoke(self.messages)

        return {
            "entities": response1.content,
            "codes": response2.content,
            "summary": response3.content
        }
```

### Streaming Response

```python
from penguin.core import create_model
from penguin.core import HumanMessage

async def stream_extraction(text: str):
    """Stream extraction results."""
    model = create_model(provider="bedrock", model="claude-sonnet-4-5")

    async for chunk in model.astream([
        HumanMessage(content=f"Extract key information:\n\n{text}")
    ]):
        if chunk.content:
            yield chunk.content
```

---

## Tool Definition Patterns

### Simple Tool

```python
from penguin.core import tool

@tool
def lookup_icd_code(description: str) -> dict:
    """Look up ICD-10 code from description.

    Args:
        description: Medical condition description
    """
    return {
        "code": "J06.9",
        "description": "Acute upper respiratory infection, unspecified",
        "category": "Diseases of the respiratory system"
    }
```

### Tool with Complex Types

```python
from penguin.core import tool
from typing import List, Optional
from pydantic import BaseModel

class SearchResult(BaseModel):
    code: str
    description: str
    score: float

@tool
def search_medical_codes(
    query: str,
    code_system: str = "ICD-10",
    limit: int = 10,
    min_score: float = 0.5
) -> List[SearchResult]:
    """Search medical coding database.

    Args:
        query: Search query text
        code_system: Coding system (ICD-10, CPT, SNOMED)
        limit: Maximum results
        min_score: Minimum relevance score
    """
    return [
        SearchResult(code="J06.9", description="...", score=0.95)
    ]
```

### Agent with Tools (v0.2.0 — LangGraph)

```python
from penguin.core import tool, create_agent, run_agent, create_model

@tool
def get_patient_history(patient_id: str) -> dict:
    """Get patient medical history."""
    return {"conditions": [...], "medications": [...]}

@tool
def validate_diagnosis(code: str, symptoms: list[str]) -> bool:
    """Validate if diagnosis code matches symptoms."""
    return True

async def agent_with_tools(query: str):
    # Create model
    model = create_model(provider="bedrock", model="claude-sonnet-4-5")

    # Create agent with tools (uses LangGraph under the hood)
    agent = create_agent(model, tools=[get_patient_history, validate_diagnosis])

    # Run agent — handles tool calling loop automatically
    result = await run_agent(agent, query)
    return result
```

### StateGraph Agent (Advanced)

For full control over agent behavior, use `StateGraph` with `bind_tools` and `ToolNode` (all from `penguin.core`):

```python
import asyncio
from typing import TypedDict
from penguin.core import (
    create_model, StateGraph, MessagesState, ToolNode,
    START, END, HumanMessage, tool
)

@tool
def lookup_patient(patient_id: str) -> str:
    """Look up patient information by ID."""
    db = {"P001": "Alice, 45F, hypertension", "P002": "Bob, 32M, diabetes"}
    return db.get(patient_id, "Patient not found")

tools = [lookup_patient]

# Create model with tools bound
model = create_model(provider="bedrock", model="claude-sonnet-4-5")
model_with_tools = model.bind_tools(tools)

# Define state
class State(TypedDict):
    messages: list

# Agent node (calls LLM)
def agent_node(state: State):
    response = model_with_tools.invoke(state["messages"])
    return {"messages": [response]}

# Routing: continue to tools or stop
def should_continue(state: State):
    last = state["messages"][-1]
    return "tools" if last.tool_calls else END

# Build the graph
graph = StateGraph(State)
graph.add_node("agent", agent_node)
graph.add_node("tools", ToolNode(tools))

graph.add_edge(START, "agent")
graph.add_conditional_edges("agent", should_continue)
graph.add_edge("tools", "agent")  # Loop back after tool execution

app = graph.compile()

# Run
async def main():
    result = await app.ainvoke(
        {"messages": [HumanMessage(content="Look up patient P001")]},
        config={"configurable": {"thread_id": "session-1"}}
    )
    print(result["messages"][-1].content)
```

### Tracing with PenguinTracer (Graphs + Sessions)

Tracing is automatic when Langfuse env vars are set. Use `PenguinTracer` for session grouping:

```python
from penguin.core.tracing import PenguinTracer

tracer = PenguinTracer(project="prior-auth")  # or set LANGFUSE_PROJECT env var

async def process_case(case_id: str, user_id: str):
    with tracer.session(session_id=f"case-{case_id}", user_id=user_id) as s:
        result = await app.ainvoke(
            {"messages": [HumanMessage(content="Look up patient P001")]},
            config={
                "configurable": {"thread_id": case_id},
                **s.config,   # Merges: callbacks + langfuse_session_id, langfuse_user_id
            }
        )
    return result["messages"][-1].content
```

---

## Bounding Box Patterns (v0.2.0)

**CRITICAL:** Use line-number-based bbox retrieval ONLY. Text matching is deprecated.

### Line-Number-Based Bbox Retrieval (RECOMMENDED)

```python
from utils.line_number_bbox_utils import get_bboxes_from_line_numbers

def get_bboxes_for_extraction(
    ocr_result,
    line_numbers: List[int],
    page_number: int,
    document_name: str
) -> List[dict]:
    """
    Get bounding boxes for LLM-cited line numbers (v0.2.0).

    This is the ONLY recommended approach for bbox retrieval.

    Args:
        ocr_result: OCR result from penguin-ai-sdk
        line_numbers: Line numbers cited by LLM (1-indexed)
        page_number: Page number where lines are located (1-indexed)
        document_name: Name of the document

    Returns:
        List of bboxes in canonical 3-field format with line_numbers
    """
    return get_bboxes_from_line_numbers(
        ocr_result=ocr_result,
        line_numbers=line_numbers,
        page_number=page_number,
        document_name=document_name,
        include_line_numbers_field=True
    )
```

### LLM Schema with Line Numbers

**CRITICAL:** LLM schemas MUST include line_numbers and page_numbers for each evidence field.

```python
from pydantic import BaseModel, Field
from typing import List

class ExtractionWithEvidence(BaseModel):
    """Extraction schema with line-number-based evidence (v0.2.0)."""

    # Field value
    patient_name: str = Field(description="Patient's full name")

    # Evidence fields (REQUIRED for each field with evidence)
    patient_name_line_numbers: List[int] = Field(
        description="OCR line numbers where patient name was found"
    )
    patient_name_page_numbers: List[int] = Field(
        description="Page numbers for each line_number"
    )
    patient_name_reasoning: str = Field(
        description="Explanation of why this is the patient name"
    )
    patient_name_confidence: float = Field(
        ge=0.0, le=1.0,
        description="Confidence score 0.0-1.0"
    )
```

### Complete Evidence Citation

```python
from utils.line_number_bbox_utils import create_evidence_citation_from_line_numbers

async def create_evidence_for_field(
    ocr_result,
    field_name: str,
    llm_extraction: dict,
    document_name: str
) -> dict:
    """
    Create complete evidence citation from LLM extraction (v0.2.0).

    Args:
        ocr_result: OCR result from penguin-ai-sdk
        field_name: Name of the extracted field (e.g., "patient_name")
        llm_extraction: LLM output with line_numbers, page_numbers, reasoning, confidence
        document_name: Name of the document

    Returns:
        Evidence citation following evidence-citation contract
    """
    line_numbers = llm_extraction[f"{field_name}_line_numbers"]
    page_numbers = llm_extraction[f"{field_name}_page_numbers"]
    reasoning = llm_extraction[f"{field_name}_reasoning"]
    confidence = llm_extraction[f"{field_name}_confidence"]

    evidence = create_evidence_citation_from_line_numbers(
        ocr_result=ocr_result,
        line_numbers=line_numbers,
        page_number=page_numbers[0],
        document_name=document_name,
        llm_reasoning=reasoning,
        confidence=confidence,
        criterion_id=field_name,
        criterion_name=field_name.replace("_", " ").title()
    )

    # Extract supporting texts from line numbers
    supporting_texts = []
    for line_num in line_numbers:
        line_obj = ocr_result.find_line(line_num, page_number=page_numbers[0])
        if line_obj:
            # Strip line number suffix from full_text format
            text = line_obj.content.split(" || ")[0] if " || " in line_obj.content else line_obj.content
            supporting_texts.append(text)

    evidence["supporting_texts"] = supporting_texts

    return evidence
```

**See `usage/03-DOCUMENT-PROCESSING.md` for complete documentation.**

---

## Error Handling Patterns

### Retry with Exponential Backoff

```python
import asyncio
from functools import wraps

def retry_async(max_retries: int = 3, base_delay: float = 1.0):
    """Decorator for async retry with exponential backoff."""

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            last_error = None

            for attempt in range(max_retries):
                try:
                    return await func(*args, **kwargs)
                except Exception as e:
                    last_error = e
                    if attempt < max_retries - 1:
                        delay = base_delay * (2 ** attempt)
                        await asyncio.sleep(delay)

            raise last_error

        return wrapper
    return decorator

# Usage
@retry_async(max_retries=3)
async def process_with_retry(file_path: str):
    return await ocr.process_file(file_path)
```

### Error Handling (NO FALLBACKS)

> **CRITICAL: Never implement fallback to alternative libraries.**
> If penguin-ai-sdk is unavailable, STOP and ask the user how to proceed.

```python
from loguru import logger

class DocumentProcessor:
    """Processor with proper error handling - NO FALLBACKS."""

    def __init__(self):
        try:
            from penguin.ocr import AzureOCRProvider
            self.ocr = AzureOCRProvider()
        except ImportError as e:
            # DO NOT fallback to pytesseract or other libraries
            # Raise clear error so user can decide how to proceed
            raise RuntimeError(
                "penguin-ai-sdk not available. Cannot process documents. "
                "Please install: pip install penguin-ai-sdk or contact user for guidance."
            ) from e

    async def process(self, file_path: str) -> dict:
        try:
            result = await self.ocr.process_file(file_path)
            return {"success": True, "data": result}
        except Exception as e:
            logger.error(f"OCR failed: {e}")
            # Return error, do NOT try alternative libraries
            return {"success": False, "error": str(e)}
```

### Validation and Error Reporting

```python
from pydantic import BaseModel, ValidationError
from typing import List, Union

class ProcessingError(BaseModel):
    stage: str
    message: str
    details: dict = {}

class ProcessingResult(BaseModel):
    success: bool
    data: dict = None
    errors: List[ProcessingError] = []

async def validated_process(file_path: str) -> ProcessingResult:
    errors = []

    # Validate input
    if not file_path.endswith(('.pdf', '.png', '.jpg')):
        errors.append(ProcessingError(
            stage="validation",
            message="Unsupported file type",
            details={"file": file_path}
        ))
        return ProcessingResult(success=False, errors=errors)

    # OCR
    try:
        ocr_result = await ocr.process_file(file_path)
    except Exception as e:
        errors.append(ProcessingError(
            stage="ocr",
            message=str(e),
            details={"file": file_path}
        ))
        return ProcessingResult(success=False, errors=errors)

    # LLM
    try:
        extraction = await extract_codes(ocr_result.full_text)
    except Exception as e:
        errors.append(ProcessingError(
            stage="llm",
            message=str(e)
        ))
        return ProcessingResult(success=False, errors=errors)

    return ProcessingResult(
        success=True,
        data={"ocr": ocr_result, "extraction": extraction}
    )
```

---

## Async Patterns

### Concurrent Processing

```python
import asyncio
from typing import List

async def process_documents_concurrent(
    file_paths: List[str],
    max_concurrent: int = 5
) -> List[dict]:
    """Process multiple documents with controlled concurrency."""

    semaphore = asyncio.Semaphore(max_concurrent)

    async def process_one(path: str) -> dict:
        async with semaphore:
            return await process_document(path)

    tasks = [process_one(path) for path in file_paths]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    return [
        {"success": True, "data": r} if not isinstance(r, Exception)
        else {"success": False, "error": str(r)}
        for r in results
    ]
```

### Timeout Handling

```python
import asyncio

async def process_with_timeout(file_path: str, timeout: float = 60.0) -> dict:
    """Process with timeout."""
    try:
        result = await asyncio.wait_for(
            process_document(file_path),
            timeout=timeout
        )
        return {"success": True, "data": result}
    except asyncio.TimeoutError:
        return {"success": False, "error": f"Processing timed out after {timeout}s"}
```

### Progress Tracking

```python
from typing import AsyncIterator, Tuple

async def process_with_progress(
    file_paths: List[str]
) -> AsyncIterator[Tuple[int, int, dict]]:
    """Process documents with progress updates.

    Yields: (current, total, result)
    """
    total = len(file_paths)

    for i, path in enumerate(file_paths):
        result = await process_document(path)
        yield (i + 1, total, result)

# Usage
async def main():
    async for current, total, result in process_with_progress(files):
        print(f"Progress: {current}/{total}")
        print(f"Result: {result}")
```

---

## Complete Example: ICD Code Extraction Pipeline

```python
"""Complete ICD-10 code extraction pipeline using penguin-ai-sdk v0.2.0."""

import asyncio
from penguin.ocr import AWSTextractProvider
from penguin.core import create_model
from pydantic import BaseModel, Field
from typing import List, Optional

# Data Models
class BoundingBox(BaseModel):
    coords: List[float] = Field(description="8-point bbox [x1,y1,...,x4,y4]")
    page: int

class ICDCode(BaseModel):
    id: str
    question_number: str
    criteria: str
    answer: bool
    confidence: int = Field(ge=0, le=100)
    status: str = "pending"
    reason: List[str]
    supporting_sentence: List[str]
    # Line-number evidence fields
    line_numbers: List[int] = Field(description="OCR line numbers where evidence was found")
    page_numbers: List[int] = Field(description="Page numbers for each line_number")
    bboxes: List[BoundingBox] = []

class ProcessedDocument(BaseModel):
    id: str
    intake_id: str
    patient_name: str
    full_text: str  # Contains "content || line_number" per line
    codes: List[ICDCode]
    pages: dict

# Pipeline
class ICDExtractionPipeline:
    SYSTEM_PROMPT = """You are a medical coding expert.
    Extract ICD-10 relevant criteria from medical documents.

    CRITICAL: Cite line numbers where you found each piece of evidence.
    The full_text format is "content || line_number".

    For each finding:
    1. Identify the medical criteria being evaluated
    2. Determine if the criteria is met (True/False)
    3. Provide confidence (0-100)
    4. List reasoning steps
    5. Quote exact supporting text from the document
    6. Record the line_numbers and page_numbers where evidence was found
    """

    def __init__(self):
        self.ocr = AWSTextractProvider(
            extract_tables=True,
            use_async_for_large_files=True
        )
        self.model = create_model(provider="bedrock", model="claude-sonnet-4-5")

    async def process(self, file_path: str, document_id: str) -> ProcessedDocument:
        # Step 1: OCR
        ocr_result = await self.ocr.process_file(file_path)

        # Step 2: Extract codes with structured output
        codes = await self._extract_codes(ocr_result.full_text)

        # Step 3: Map bounding boxes
        codes_with_bboxes = self._map_bboxes(codes, ocr_result, file_path)

        # Step 4: Generate page URLs (placeholder)
        pages = self._generate_pages(file_path, len(set(l.page_number for l in ocr_result.lines)))

        return ProcessedDocument(
            id=f"doc_{document_id}",
            intake_id=document_id,
            patient_name="Patient",
            full_text=ocr_result.full_text,
            codes=codes_with_bboxes,
            pages=pages
        )

    async def _extract_codes(self, text: str) -> List[ICDCode]:
        # with_structured_output() returns a single object — use wrapper model for lists
        class ICDCodeList(BaseModel):
            codes: List[ICDCode]

        structured_model = self.model.with_structured_output(ICDCodeList)
        prompt = f"{self.SYSTEM_PROMPT}\n\nDocument:\n\n{text}"
        result = await structured_model.ainvoke(prompt)
        return result.codes

    def _map_bboxes(self, codes: List[ICDCode], ocr_result, document_name: str) -> List[ICDCode]:
        """Map bboxes using line-number approach.

        CRITICAL: LLM must return line_numbers and page_numbers for each code.
        """
        from utils.line_number_bbox_utils import get_bboxes_from_line_numbers

        for code in codes:
            if not code.line_numbers or not code.page_numbers:
                print(f"[BBOX] Warning: No line_numbers for {code.id}. LLM must cite line numbers.")
                code.bboxes = []
                continue

            page_number = code.page_numbers[0] if code.page_numbers else 1

            bbox_dicts = get_bboxes_from_line_numbers(
                ocr_result=ocr_result,
                line_numbers=code.line_numbers,
                page_number=page_number,
                document_name=document_name,
                include_line_numbers_field=True
            )

            bboxes = []
            for bbox_dict in bbox_dicts:
                for coords_8point in bbox_dict["bbox"]:
                    bboxes.append(BoundingBox(
                        coords=coords_8point,
                        page=bbox_dict["page_number"]
                    ))

            code.bboxes = bboxes

        return codes

    def _generate_pages(self, file_path: str, num_pages: int) -> dict:
        base = file_path.replace(".pdf", "")
        return {
            str(i): f"{base}_page_{i}.png"
            for i in range(1, num_pages + 1)
        }

# Usage
async def main():
    pipeline = ICDExtractionPipeline()
    result = await pipeline.process("medical_record.pdf", "9701")
    print(result.model_dump_json(indent=2))

if __name__ == "__main__":
    asyncio.run(main())
```
