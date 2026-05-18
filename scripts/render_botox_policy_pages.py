"""
Render Botox policy PDF pages to PNG and update Policy.pageImages in the DB.
Run from repo root: python scripts/render_botox_policy_pages.py
Requires: services/ai/.venv (has pymupdf + asyncpg)
"""
import asyncio
import json
import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF_PATH = os.path.join(REPO_ROOT, "UHC", "medical-policies", "botulinum-toxins-a-and-b-cs.pdf")
OUTPUT_DIR = os.path.join(REPO_ROOT, "public", "policy-pdfs", "policy-uhc-botox-chronic-migraine")
POLICY_ID = "policy-uhc-botox-chronic-migraine"
DOCUMENT_NAME = "botulinum-toxins-a-and-b-cs.pdf"


def render_pages() -> dict:
    import fitz

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    doc = fitz.open(PDF_PATH)
    page_urls: dict[str, str] = {}

    for page_num in range(len(doc)):
        page = doc[page_num]
        mat = fitz.Matrix(150 / 72, 150 / 72)
        pix = page.get_pixmap(matrix=mat)
        filename = f"page_{page_num + 1}.png"
        out_path = os.path.join(OUTPUT_DIR, filename)
        pix.save(out_path)
        page_urls[str(page_num + 1)] = f"/policy-pdfs/{POLICY_ID}/{filename}"
        print(f"  Rendered page {page_num + 1}/{len(doc)}")

    doc.close()

    return {
        "files": [DOCUMENT_NAME],
        "presigned_urls": {DOCUMENT_NAME: page_urls},
    }


async def update_db(page_images: dict) -> None:
    import asyncpg

    db_url = os.environ.get(
        "DATABASE_URL",
        "postgresql://pa_app:pa_app_dev@localhost:5432/pa_app",
    )
    conn_url = db_url.replace("postgresql://", "postgres://").split("?")[0]
    conn = await asyncpg.connect(conn_url)
    try:
        rows = await conn.execute(
            'UPDATE "Policy" SET "pageImages" = $1 WHERE id = $2',
            json.dumps(page_images),
            POLICY_ID,
        )
        print(f"  DB updated: {rows}")
    finally:
        await conn.close()


async def main() -> None:
    print(f"Rendering {PDF_PATH} ...")
    page_images = render_pages()
    print(f"Rendered {len(page_images['presigned_urls'][DOCUMENT_NAME])} pages.")
    print("Updating DB ...")
    await update_db(page_images)
    print("Done. pageImages column populated for policy-uhc-botox-chronic-migraine.")


if __name__ == "__main__":
    asyncio.run(main())
