"""
LLM Extractor Template using penguin-ai-sdk

This template provides structured data extraction from text
using LLMs with Pydantic output validation.
"""

import asyncio
import os
from typing import List, Optional, TypeVar, Type, Generic
from pydantic import BaseModel, Field
from enum import Enum

# penguin-ai-sdk imports
from penguin.core import create_model


# Generic type for extraction results
T = TypeVar('T', bound=BaseModel)


class ExtractionConfidence(str, Enum):
    """Confidence levels for extractions."""
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class BaseExtraction(BaseModel):
    """Base class for extraction results."""
    confidence: float = Field(ge=0, le=1, description="Confidence score 0-1")
    source_text: str = Field(description="Original text that supports this extraction")


class LLMExtractor(Generic[T]):
    """
    Generic LLM-based extractor using penguin-ai-sdk.

    Supports:
    - AWS Bedrock (Claude models)
    - Google Gemini
    - OpenAI GPT models
    - Azure OpenAI

    Usage:
        extractor = LLMExtractor(
            provider="bedrock",
            model="claude-sonnet-4-5",
            system_prompt="You are a medical coder.",
            output_type=ICDExtractionResult  # Must be a single BaseModel (not List[X])
        )
        result = await extractor.extract(document_text)
    """

    def __init__(
        self,
        provider: str = os.getenv("PENGUIN_LLM_PROVIDER", "bedrock"),
        model: str = os.getenv("PENGUIN_LLM_MODEL", "claude-sonnet-4-5"),
        system_prompt: str = "Extract structured information from the text.",
        output_type: Type[T] = None,
        temperature: float = 0.0,
        max_tokens: int = 4096
    ):
        self.client = create_model(provider=provider, model=model)
        self.system_prompt = system_prompt
        self.output_type = output_type
        self.temperature = temperature
        self.max_tokens = max_tokens

    async def extract(
        self,
        text: str,
        additional_context: str = None
    ) -> T:
        """
        Extract structured data from text.

        Args:
            text: Source text to extract from
            additional_context: Optional additional instructions

        Returns:
            Extracted data matching output_type
        """
        structured_model = self.client.with_structured_output(self.output_type)

        prompt_parts = [self.system_prompt]
        if additional_context:
            prompt_parts.append(f"Context: {additional_context}")
        prompt_parts.append(f"Extract from this text:\n\n{text}")

        result = await structured_model.ainvoke("\n\n".join(prompt_parts))
        return result

    async def extract_line_number_based(
        self,
        full_text_with_line_numbers: str,
        additional_context: str = None
    ) -> T:
        """
        Extract structured data with line-number-based evidence (v0.2.0).

        CRITICAL: Use this when full_text includes line numbers ("content || line_number").
        The LLM will cite line numbers which can be mapped directly to bounding boxes.

        Args:
            full_text_with_line_numbers: OCR full_text with line numbers appended
            additional_context: Optional additional instructions

        Returns:
            Extracted data matching output_type with line_numbers and page_numbers fields

        Example:
            full_text = "Invoice Number: 12345 || 1\\nTotal: $500 || 2\\n..."
            result = await extractor.extract_line_number_based(full_text)
            # result.invoice_number_line_numbers = [1]
            # result.invoice_number_page_numbers = [1]
        """
        structured_model = self.client.with_structured_output(self.output_type)

        prompt_parts = [self.system_prompt]
        if additional_context:
            prompt_parts.append(f"Context: {additional_context}")

        prompt_parts.append(f"""CRITICAL: Cite line numbers where you found each piece of evidence.

The text format is "content || line_number" (e.g., "Patient: John Smith || 5").

For EACH extracted field that requires evidence, you MUST provide:
1. {{field}}_line_numbers: List of line numbers where you found the evidence
2. {{field}}_page_numbers: List of page numbers for each line
3. {{field}}_reasoning: Your explanation
4. {{field}}_confidence: Your confidence score (0.0-1.0)

Text to analyze:

{full_text_with_line_numbers}""")

        result = await structured_model.ainvoke("\n\n".join(prompt_parts))
        return result

    async def extract_with_reasoning(
        self,
        text: str
    ) -> dict:
        """
        Extract with visible reasoning chain (Claude Sonnet 4.5).

        Returns dict with 'reasoning' and 'result' keys.
        Uses with_structured_output for typed extraction.
        """
        structured_model = self.client.with_structured_output(self.output_type)
        prompt = f"{self.system_prompt}\n\nAnalyze step by step:\n\n{text}"
        result = await structured_model.ainvoke(prompt)

        return {
            "result": result
        }

    async def extract_batch(
        self,
        texts: List[str],
        max_concurrency: int = 5
    ) -> List[T]:
        """
        Extract from multiple texts in parallel.
        """
        semaphore = asyncio.Semaphore(max_concurrency)

        async def extract_one(text: str) -> T:
            async with semaphore:
                return await self.extract(text)

        return await asyncio.gather(*[extract_one(t) for t in texts])


# ============================================
# ICD-10 Code Extraction
# ============================================

class ICDCodeExtraction(BaseModel):
    """ICD-10 code extraction result."""
    code: str = Field(description="ICD-10 code (e.g., J06.9)")
    description: str = Field(description="Code description")
    confidence: float = Field(ge=0, le=100, description="Confidence 0-100")
    supporting_evidence: List[str] = Field(description="Supporting text from document")
    page_references: List[int] = Field(default=[], description="Page numbers where found")


class ICDExtractionResult(BaseModel):
    """Complete ICD extraction result."""
    codes: List[ICDCodeExtraction]
    summary: str = Field(description="Brief summary of findings")
    document_type: str = Field(description="Type of medical document")


# ============================================
# Line-Number-Based ICD Extraction (v0.2.0)
# ============================================

class ICDCodeExtractionWithLineNumbers(BaseModel):
    """ICD-10 code extraction with line-number-based evidence (v0.2.0).

    CRITICAL: Use this schema when OCR full_text includes line numbers.
    The LLM cites line numbers which map directly to bounding boxes.

    Example full_text format:
        "Primary Diagnosis: Type 2 Diabetes Mellitus || 42"
    """
    code: str = Field(description="ICD-10 code (e.g., J06.9)")
    description: str = Field(description="Code description")
    line_numbers: List[int] = Field(description="OCR line numbers from full_text where found")
    page_numbers: List[int] = Field(description="Page numbers for each line_number")
    reasoning: str = Field(description="Explanation of why this code applies")
    confidence: float = Field(ge=0.0, le=1.0, description="Confidence 0.0-1.0")


class ICDExtractionResultWithLineNumbers(BaseModel):
    """Complete ICD extraction with line-number evidence (v0.2.0)."""
    codes: List[ICDCodeExtractionWithLineNumbers]
    summary: str = Field(description="Brief summary of findings")
    document_type: str = Field(description="Type of medical document")


ICD_LINE_NUMBER_SYSTEM_PROMPT = """You are an expert medical coder specializing in ICD-10 codes.

CRITICAL: Cite line numbers where you found each code.
The text format is "content || line_number" (e.g., "Diagnosis: Diabetes || 42").

When analyzing medical documents:
1. Identify all diagnoses, conditions, and procedures
2. Map each to the appropriate ICD-10 code
3. Cite the line_numbers where you found the evidence (from full_text format)
4. Cite the page_numbers for each line
5. Provide your reasoning for the code assignment
6. Rate your confidence (0.0-1.0)

Be precise and thorough. Only assign codes when there is clear documentation support.

Example output:
{
  "code": "E11.9",
  "description": "Type 2 Diabetes Mellitus without complications",
  "line_numbers": [42, 43],
  "page_numbers": [2, 2],
  "reasoning": "Primary diagnosis stated on lines 42-43 of page 2",
  "confidence": 0.95
}
"""


async def extract_icd_codes_with_line_numbers(
    full_text_with_line_numbers: str
) -> ICDExtractionResultWithLineNumbers:
    """
    Extract ICD-10 codes with line-number-based evidence (v0.2.0).

    This approach maps LLM-cited line numbers directly to bounding boxes,
    eliminating fuzzy text matching and providing exact evidence locations.

    Args:
        full_text_with_line_numbers: OCR full_text with line numbers
            (format: "content || line_number")

    Returns:
        ICDExtractionResultWithLineNumbers with codes and line numbers

    Example:
        from penguin.ocr import AzureOCRProvider

        ocr = AzureOCRProvider()
        result = await ocr.process_file("medical_record.pdf")

        # full_text now includes line numbers
        # "Primary Diagnosis: Diabetes || 1\nMedications: Metformin || 2\n..."

        extraction = await extract_icd_codes_with_line_numbers(result.full_text)

        for code in extraction.codes:
            print(f"Code: {code.code}")
            print(f"Found on lines: {code.line_numbers}")
            print(f"Pages: {code.page_numbers}")
            print(f"Confidence: {code.confidence}")

            # Map to bboxes using line numbers
            from utils.line_number_bbox_utils import get_bboxes_from_line_numbers
            bboxes = get_bboxes_from_line_numbers(
                ocr_result=result,
                line_numbers=code.line_numbers,
                page_number=code.page_numbers[0],
                document_name="medical_record.pdf"
            )
    """
    extractor = LLMExtractor(
        provider="bedrock",
        model="claude-sonnet-4-5",
        system_prompt=ICD_LINE_NUMBER_SYSTEM_PROMPT,
        output_type=ICDExtractionResultWithLineNumbers
    )

    return await extractor.extract_line_number_based(full_text_with_line_numbers)


ICD_SYSTEM_PROMPT = """You are an expert medical coder specializing in ICD-10 codes.

When analyzing medical documents:
1. Identify all diagnoses, conditions, and procedures
2. Map each to the appropriate ICD-10 code
3. Provide exact supporting text quotes from the document
4. Rate your confidence in each code assignment

Be precise and thorough. Use exact text quotes for supporting_evidence.
Only assign codes when there is clear documentation support."""


async def extract_icd_codes(text: str) -> ICDExtractionResult:
    """
    Extract ICD-10 codes from medical text.

    Args:
        text: Medical document text

    Returns:
        ICDExtractionResult with codes and supporting evidence
    """
    extractor = LLMExtractor(
        provider="bedrock",
        model="claude-sonnet-4-5",
        system_prompt=ICD_SYSTEM_PROMPT,
        output_type=ICDExtractionResult
    )

    return await extractor.extract(text)


# ============================================
# Named Entity Extraction
# ============================================

class EntityType(str, Enum):
    PERSON = "person"
    ORGANIZATION = "organization"
    LOCATION = "location"
    DATE = "date"
    MEDICAL_CONDITION = "medical_condition"
    MEDICATION = "medication"
    PROCEDURE = "procedure"


class ExtractedEntity(BaseModel):
    """A single extracted entity."""
    text: str = Field(description="The entity text")
    entity_type: EntityType
    confidence: float = Field(ge=0, le=1)
    context: str = Field(description="Surrounding context")


class EntityExtractionResult(BaseModel):
    """Entity extraction result."""
    entities: List[ExtractedEntity]


ENTITY_SYSTEM_PROMPT = """Extract named entities from the text.
Identify persons, organizations, locations, dates, medical conditions,
medications, and procedures. Provide the surrounding context for each entity."""


async def extract_entities(text: str) -> EntityExtractionResult:
    """
    Extract named entities from text.

    Args:
        text: Source text

    Returns:
        EntityExtractionResult with all entities
    """
    extractor = LLMExtractor(
        provider="bedrock",
        model="claude-sonnet-4-5",
        system_prompt=ENTITY_SYSTEM_PROMPT,
        output_type=EntityExtractionResult
    )

    return await extractor.extract(text)


# ============================================
# Document Classification
# ============================================

class DocumentCategory(str, Enum):
    MEDICAL_RECORD = "medical_record"
    LAB_REPORT = "lab_report"
    DISCHARGE_SUMMARY = "discharge_summary"
    PRESCRIPTION = "prescription"
    IMAGING_REPORT = "imaging_report"
    OPERATIVE_NOTE = "operative_note"
    PROGRESS_NOTE = "progress_note"
    REFERRAL = "referral"
    INSURANCE = "insurance"
    OTHER = "other"


class ClassificationResult(BaseModel):
    """Document classification result."""
    category: DocumentCategory
    confidence: float = Field(ge=0, le=1)
    indicators: List[str] = Field(description="What indicated this classification")


CLASSIFICATION_PROMPT = """Classify the document type based on its content.
Look for key indicators like headers, formatting, and terminology.
Common medical document types include medical records, lab reports,
discharge summaries, prescriptions, imaging reports, and operative notes."""


async def classify_document(text: str) -> ClassificationResult:
    """
    Classify document type.

    Args:
        text: Document text (first ~5000 chars recommended)

    Returns:
        ClassificationResult with category and confidence
    """
    extractor = LLMExtractor(
        provider="bedrock",
        model="claude-sonnet-4-5",
        system_prompt=CLASSIFICATION_PROMPT,
        output_type=ClassificationResult
    )

    # Use first 5000 chars for classification
    return await extractor.extract(text[:5000])


# ============================================
# Custom Extraction with Tools
# ============================================

from penguin.core import tool, create_agent, run_agent


@tool
def validate_icd_code(code: str) -> dict:
    """Validate an ICD-10 code format and return details.

    Args:
        code: ICD-10 code to validate
    """
    # Mock validation - in production, use real ICD database
    import re
    pattern = r'^[A-Z]\d{2}(\.\d{1,2})?$'

    is_valid = bool(re.match(pattern, code))
    return {
        "code": code,
        "is_valid": is_valid,
        "format": "ICD-10-CM" if is_valid else "invalid"
    }


@tool
def search_icd_database(query: str, limit: int = 5) -> List[dict]:
    """Search ICD-10 database for matching codes.

    Args:
        query: Search query
        limit: Maximum results
    """
    # Mock search - in production, use real database
    return [
        {"code": "J06.9", "description": "Acute upper respiratory infection", "score": 0.95},
        {"code": "J18.9", "description": "Pneumonia, unspecified organism", "score": 0.80}
    ][:limit]


async def extract_with_tools(text: str) -> dict:
    """
    Extract ICD codes with tool-assisted validation.

    Uses create_agent/run_agent for automatic tool calling (v0.2.0).
    The agent handles the tool calling loop automatically via LangGraph.
    """
    model = create_model(provider="bedrock", model="claude-sonnet-4-5")

    # Create agent with tools (LangGraph handles tool calling loop)
    agent = create_agent(model, tools=[validate_icd_code, search_icd_database])

    # Run agent — handles tool calls automatically
    result = await run_agent(
        agent,
        "Extract ICD codes from this text. Use tools to validate and search for codes.\n\n" + text
    )

    return {"content": result}


# CLI usage
if __name__ == "__main__":
    import sys

    async def main():
        sample_text = """
        Patient: John Doe
        Date: 2024-01-15

        Chief Complaint: Fever and cough for 3 days

        Assessment:
        1. Acute upper respiratory infection
        2. Rule out pneumonia

        Plan:
        - Chest X-ray
        - Amoxicillin 500mg TID x 7 days
        - Follow up in 1 week
        """

        print("=== ICD Code Extraction ===")
        icd_result = await extract_icd_codes(sample_text)
        print(f"Found {len(icd_result.codes)} codes:")
        for code in icd_result.codes:
            print(f"  {code.code}: {code.description} ({code.confidence}%)")

        print("\n=== Document Classification ===")
        class_result = await classify_document(sample_text)
        print(f"Category: {class_result.category}")
        print(f"Confidence: {class_result.confidence}")

        print("\n=== Entity Extraction ===")
        entity_result = await extract_entities(sample_text)
        for entity in entity_result.entities:
            print(f"  {entity.entity_type}: {entity.text}")

    asyncio.run(main())
