-- AlterTable: add pageImages + ocrLineCount to Attachment so uploaded PDFs can
-- carry the same OCR/page-image payload as CachedDocumentReference (Phase 2 of
-- the PDF-viewer + bbox-overlay work).
ALTER TABLE "Attachment" ADD COLUMN "pageImages" JSONB;
ALTER TABLE "Attachment" ADD COLUMN "ocrLineCount" INTEGER;
