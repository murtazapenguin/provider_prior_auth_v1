"""Content-type-aware document normalization to PDF.

Input shapes we normalize for the FHIR DocumentReference ingest pipeline:
  - application/pdf                       → bytes-equal passthrough
  - text/plain                            → PyMuPDF text-on-page render
  - text/rtf, application/rtf             → libreoffice headless
  - text/html, application/xhtml+xml      → libreoffice headless
  - application/x-ccda+xml, text/xml CCDA → extract <section><text> → HTML → libreoffice

HARD RULES (CLAUDE.md / role brief):
- PyMuPDF (`fitz`) is the only non-Penguin lib for PDF work because
  `penguin.ocr` uses it internally.
- HTML / RTF / CCDA → PDF is done via `libreoffice --headless --convert-to pdf`
  (subprocess).  NO weasyprint, reportlab, pdfkit, pdf2image.
- No content is logged at info/debug — only filenames and types.
- All paths are constructed inside caller-provided tempdirs; this module never
  writes outside `out_path` or its parent.

The caller (`document_intake.ingest_documents`) chooses the canonical basename
(`{fhirResourceId}.pdf`) so the OCR result's `find_line_as_bbox` returns
`document_name` matching the basename in `pageImages.files[0]` — required by
the canonical `bbox-format` + `pdfviewer-data` contracts.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
import xml.etree.ElementTree as ET
from html import escape
from pathlib import Path

logger = logging.getLogger(__name__)


# ─── Content-type detection ───────────────────────────────────────────────────

PDF_TYPES = {"application/pdf"}
RTF_TYPES = {"text/rtf", "application/rtf"}
HTML_TYPES = {"text/html", "application/xhtml+xml"}
CCDA_TYPES = {
    "application/x-ccda+xml",
    "application/ccda+xml",
    "application/hl7-cda+xml",
}
PLAIN_TEXT_TYPES = {"text/plain", "text/markdown"}
XML_TYPES = {"application/xml", "text/xml"}


class LibreOfficeUnavailableError(RuntimeError):
    """Raised when a content type needs libreoffice but it's not on PATH.

    Mac install: brew install --cask libreoffice
    Linux: apt-get install libreoffice (or distro equivalent).
    """


class UnsupportedContentTypeError(ValueError):
    """Raised when the content type can't be normalized to PDF."""


def _find_soffice() -> str | None:
    """Return absolute path to the libreoffice binary, or None.

    `soffice` is the canonical binary; `libreoffice` is a symlink on most distros.
    """
    return shutil.which("soffice") or shutil.which("libreoffice")


# ─── PDF passthrough ──────────────────────────────────────────────────────────

def _passthrough_pdf(pdf_bytes: bytes, out_path: Path) -> None:
    """Write PDF bytes byte-for-byte to disk."""
    out_path.write_bytes(pdf_bytes)


# ─── Plain text → PDF via PyMuPDF (no libreoffice needed) ─────────────────────

def _text_to_pdf(text: str, out_path: Path) -> None:
    """Render plain text as a US-letter PDF using PyMuPDF.

    Auto-paginates when the text overflows a single page.  Uses a generous
    50pt margin so OCR has clean line geometry.
    """
    import fitz  # PyMuPDF — used by penguin.ocr internally, only allowed PDF lib

    doc = fitz.open()
    page_w, page_h = fitz.paper_size("letter")
    margin_pt = 50
    fontsize = 11
    leading = fontsize * 1.35

    # Wrap roughly at 90 chars per line to keep within margins at 11pt.
    wrapped_lines: list[str] = []
    for raw_line in text.splitlines() or [""]:
        # Soft-wrap long lines so the renderer never overflows horizontally.
        words = raw_line.split(" ")
        line = ""
        for w in words:
            if len(line) + len(w) + 1 > 90 and line:
                wrapped_lines.append(line)
                line = w
            else:
                line = w if not line else f"{line} {w}"
        wrapped_lines.append(line)

    lines_per_page = max(1, int((page_h - 2 * margin_pt) // leading))

    page = doc.new_page(width=page_w, height=page_h)
    y = margin_pt
    line_idx = 0
    for line in wrapped_lines:
        if line_idx >= lines_per_page:
            page = doc.new_page(width=page_w, height=page_h)
            y = margin_pt
            line_idx = 0
        page.insert_text(
            (margin_pt, y + fontsize),  # baseline
            line or " ",  # don't emit empty strings — PyMuPDF skips them
            fontsize=fontsize,
            fontname="helv",
        )
        y += leading
        line_idx += 1

    doc.save(str(out_path))
    doc.close()


# ─── LibreOffice subprocess wrapper ───────────────────────────────────────────

def _libreoffice_convert(src_path: Path, out_dir: Path, *, timeout_s: int = 60) -> Path:
    """Run libreoffice headless to convert `src_path` → PDF inside `out_dir`.

    Returns the produced PDF path (libreoffice names it after the source stem).

    Raises:
        LibreOfficeUnavailableError if no soffice on PATH.
        subprocess.CalledProcessError if libreoffice fails.
        FileNotFoundError if the expected PDF wasn't produced.
    """
    soffice = _find_soffice()
    if soffice is None:
        raise LibreOfficeUnavailableError(
            "libreoffice (soffice) is not on PATH.  Install with "
            "`brew install --cask libreoffice` (Mac) or your distro's package manager."
        )

    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        soffice,
        "--headless",
        "--norestore",
        "--nolockcheck",
        "--nodefault",
        "--nofirststartwizard",
        "--convert-to",
        "pdf",
        "--outdir",
        str(out_dir),
        str(src_path),
    ]
    logger.info(
        "libreoffice convert src=%s out_dir=%s", src_path.name, out_dir.name
    )
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        check=False,
        timeout=timeout_s,
    )
    if proc.returncode != 0:
        logger.warning(
            "libreoffice convert failed rc=%s stderr=%s",
            proc.returncode,
            proc.stderr[:500],
        )
        raise subprocess.CalledProcessError(
            proc.returncode, cmd, output=proc.stdout, stderr=proc.stderr
        )

    expected = out_dir / f"{src_path.stem}.pdf"
    if not expected.exists():
        raise FileNotFoundError(
            f"libreoffice produced no PDF at {expected} for source {src_path}"
        )
    return expected


# ─── RTF → PDF ────────────────────────────────────────────────────────────────

def _rtf_to_pdf(rtf_bytes: bytes, out_path: Path) -> None:
    """Normalize RTF → PDF via libreoffice headless."""
    tmp_dir = out_path.parent
    src = tmp_dir / "_normalize_in.rtf"
    src.write_bytes(rtf_bytes)
    try:
        produced = _libreoffice_convert(src, tmp_dir)
        if produced.resolve() != out_path.resolve():
            shutil.move(str(produced), str(out_path))
    finally:
        try:
            src.unlink()
        except OSError:
            pass


# ─── HTML → PDF ───────────────────────────────────────────────────────────────

def _html_to_pdf(html_str: str, out_path: Path) -> None:
    """Normalize HTML → PDF via libreoffice headless."""
    tmp_dir = out_path.parent
    src = tmp_dir / "_normalize_in.html"
    src.write_text(html_str, encoding="utf-8")
    try:
        produced = _libreoffice_convert(src, tmp_dir)
        if produced.resolve() != out_path.resolve():
            shutil.move(str(produced), str(out_path))
    finally:
        try:
            src.unlink()
        except OSError:
            pass


# ─── CCDA XML → HTML extractor ────────────────────────────────────────────────
# The CDA / CCDA spec has rich XSL stylesheets, but pulling one in is a rabbit
# hole.  For demo data we extract <section><title> + <section><text> nodes and
# render them as a simple HTML document — preserves the clinical narrative,
# loses presentation polish.  Good enough for OCR + evidence extraction since
# both consume the rendered text, not the visual structure.

_CDA_NS = {
    "cda": "urn:hl7-org:v3",
}


def _ccda_to_html(ccda_xml_bytes: bytes, *, title: str = "Clinical Document") -> str:
    """Extract section narratives from a CCDA / HL7 CDA XML payload as HTML.

    Strategy:
        1. Parse with `xml.etree.ElementTree`.
        2. Walk every <section> under <component>, capturing <title> + <text>.
        3. Render as `<h2>` (title) + `<div>` (text) under a single `<body>`.

    Falls back to a `<pre>` block of the raw text content if no `<section>`
    elements are found — guarantees we always produce SOME viewable PDF.
    """
    try:
        root = ET.fromstring(ccda_xml_bytes)
    except ET.ParseError as e:
        # Fall back: render the raw text inside <pre>.  Demo doesn't ship
        # malformed CCDA but we never want a crash here.
        logger.warning("CCDA parse failed (%s) — falling back to raw text", e)
        raw_text = ccda_xml_bytes.decode("utf-8", errors="replace")
        return (
            f"<!doctype html><html><body><h1>{escape(title)}</h1>"
            f"<pre>{escape(raw_text)}</pre></body></html>"
        )

    sections_html: list[str] = []

    # Try namespaced first; many fixtures omit the xmlns declaration so try
    # non-namespaced as a fallback.
    for ns in (_CDA_NS, {}):
        nodes = root.findall(".//cda:section", ns) if ns else root.findall(".//section")
        for sec in nodes:
            sec_title = sec.find("cda:title", ns) if ns else sec.find("title")
            sec_text = sec.find("cda:text", ns) if ns else sec.find("text")
            title_str = (sec_title.text or "").strip() if sec_title is not None else ""
            # Concatenate all descendant text under <text>, preserving paragraph
            # breaks where possible.
            text_parts: list[str] = []
            if sec_text is not None:
                for elem in sec_text.iter():
                    if elem.text:
                        text_parts.append(elem.text.strip())
                    if elem.tail:
                        text_parts.append(elem.tail.strip())
            text_str = "\n".join(p for p in text_parts if p)
            if title_str or text_str:
                sections_html.append(
                    f"<section><h2>{escape(title_str)}</h2>"
                    f"<div><pre>{escape(text_str)}</pre></div></section>"
                )
        if sections_html:
            break  # we found sections in one ns, don't try the other

    if not sections_html:
        # No <section> tags — render whatever text we can find.
        flat_text = " ".join(
            t.strip() for t in root.itertext() if t and t.strip()
        )
        sections_html = [
            f"<section><h2>Document</h2><div><pre>{escape(flat_text)}</pre></div></section>"
        ]

    return (
        "<!doctype html><html><head>"
        '<meta charset="utf-8">'
        f"<title>{escape(title)}</title>"
        "</head><body>"
        f"<h1>{escape(title)}</h1>"
        + "\n".join(sections_html)
        + "</body></html>"
    )


def _ccda_to_pdf(ccda_xml_bytes: bytes, out_path: Path, title: str) -> None:
    """Normalize CCDA XML → PDF via HTML intermediate + libreoffice."""
    html_str = _ccda_to_html(ccda_xml_bytes, title=title)
    _html_to_pdf(html_str, out_path)


# ─── Public entry point ───────────────────────────────────────────────────────

def normalize_to_pdf(
    raw_bytes: bytes,
    content_type: str,
    out_path: Path,
    *,
    title: str = "Document",
) -> Path:
    """Normalize raw document bytes to a PDF written at `out_path`.

    The output filename (basename of `out_path`) becomes the `document_name`
    referenced in `pageImages.files[0]` and the OCR result's `find_line_as_bbox`
    return value — caller must pick a canonical name (`{fhirResourceId}.pdf`).

    Args:
        raw_bytes: The raw content bytes (e.g. from a FHIR Binary fetch).
        content_type: MIME type of `raw_bytes`.  Lower-cased before dispatch.
        out_path: Final PDF destination.  Parent must exist.
        title: Title used when wrapping HTML/CCDA renders.

    Returns:
        `out_path` (Path) on success.

    Raises:
        UnsupportedContentTypeError: if the content type isn't on our supported list.
        LibreOfficeUnavailableError: if the path needs libreoffice but it's missing.
        Any subprocess / IO error from the underlying conversion.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    ct = (content_type or "").lower().split(";")[0].strip()

    if ct in PDF_TYPES:
        _passthrough_pdf(raw_bytes, out_path)
        return out_path

    if ct in PLAIN_TEXT_TYPES:
        text = raw_bytes.decode("utf-8", errors="replace")
        _text_to_pdf(text, out_path)
        return out_path

    if ct in RTF_TYPES:
        _rtf_to_pdf(raw_bytes, out_path)
        return out_path

    if ct in HTML_TYPES:
        html_str = raw_bytes.decode("utf-8", errors="replace")
        _html_to_pdf(html_str, out_path)
        return out_path

    if ct in CCDA_TYPES:
        _ccda_to_pdf(raw_bytes, out_path, title=title)
        return out_path

    if ct in XML_TYPES:
        # Try to detect CCDA by sniffing the root element.  This guards
        # against servers returning `text/xml` for CDA documents.
        try:
            root = ET.fromstring(raw_bytes)
            tag = root.tag.lower()
            if "clinicaldocument" in tag:
                _ccda_to_pdf(raw_bytes, out_path, title=title)
                return out_path
        except ET.ParseError:
            pass
        raise UnsupportedContentTypeError(
            f"XML content_type={ct} is not recognized as CCDA — refusing to normalize"
        )

    raise UnsupportedContentTypeError(
        f"Unsupported content_type={ct} for document normalization"
    )
