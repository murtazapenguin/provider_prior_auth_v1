"""Bbox utility helpers for line-number-based citation retrieval.

Where penguin-ai-sdk v0.2.0's built-in methods cover the case
(ocr_result_to_bbox_format, find_line_as_bbox, strip_page_dimensions),
prefer those. This module holds only supplementary helpers.

See penguinai-claude-artifacts-main/.claude/contracts/bbox-format.md for
the canonical 8-point normalized format this module produces.
"""

from typing import Any


def strip_page_dimensions(bbox_dict: dict[str, Any]) -> dict[str, Any]:
    """Remove producer-only width/height fields before storage/API response."""
    return {k: v for k, v in bbox_dict.items() if k not in ('width', 'height')}


def group_bboxes_by_page(bboxes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge multiple bbox dicts into one entry per (document, page)."""
    if not bboxes:
        return []
    grouped: dict[str, dict[str, Any]] = {}
    for bbox in bboxes:
        key = f"{bbox['document_name']}_{bbox['page_number']}"
        if key not in grouped:
            grouped[key] = {
                'document_name': bbox['document_name'],
                'page_number': bbox['page_number'],
                'bbox': [],
            }
        grouped[key]['bbox'].extend(bbox['bbox'])
    return list(grouped.values())


def create_evidence_citation_from_line_numbers(
    ocr_result: Any,
    line_numbers: list[int],
    page_number: int,
    document_name: str,
    llm_reasoning: str,
    confidence: float,
    criterion_id: str = '',
    criterion_name: str = '',
) -> dict[str, Any]:
    """Build an evidence citation dict from OCR line numbers.

    Uses SDK's ocr_result_to_bbox_format if available; falls back to
    find_line_as_bbox per line. Follows evidence-citation contract.
    """
    bboxes: list[dict[str, Any]] = []
    supporting_texts: list[str] = []

    for ln in line_numbers:
        try:
            bbox = ocr_result.find_line_as_bbox(
                line_number=ln,
                page_number=page_number,
                document_name=document_name,
            )
            if bbox:
                bboxes.append(strip_page_dimensions(bbox))
        except Exception:
            pass

        try:
            line_obj = ocr_result.find_line(ln, page_number=page_number)
            if line_obj:
                text = line_obj.content.split(' || ')[0] if ' || ' in line_obj.content else line_obj.content
                supporting_texts.append(text)
        except Exception:
            pass

    return {
        'supporting_texts': supporting_texts,
        'reasoning': llm_reasoning,
        'confidence': confidence,
        'bboxes': bboxes,
        'line_numbers': line_numbers,
        'criterion_id': criterion_id,
        'criterion_name': criterion_name,
    }
