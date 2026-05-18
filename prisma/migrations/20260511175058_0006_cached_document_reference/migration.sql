-- AlterTable
ALTER TABLE "ClinicalNote" ADD COLUMN     "fhirContentType" TEXT,
ADD COLUMN     "fhirResourceId" TEXT,
ADD COLUMN     "fhirVersionId" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'clinical_note',
ADD COLUMN     "lastFetchedAt" TIMESTAMP(3),
ADD COLUMN     "ocrLineCount" INTEGER,
ADD COLUMN     "pageImages" JSONB,
ADD COLUMN     "pdfUrl" TEXT;
