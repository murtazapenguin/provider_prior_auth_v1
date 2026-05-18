-- AlterTable
ALTER TABLE "Coverage" ADD COLUMN     "fhirResourceId" TEXT,
ADD COLUMN     "fhirVersionId" TEXT,
ADD COLUMN     "lastFetchedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Encounter" ADD COLUMN     "fhirResourceId" TEXT,
ADD COLUMN     "fhirVersionId" TEXT,
ADD COLUMN     "lastFetchedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "fhirResourceId" TEXT,
ADD COLUMN     "fhirVersionId" TEXT,
ADD COLUMN     "lastFetchedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PriorAuth" ADD COLUMN     "fhirServiceRequestId" TEXT;

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "fhirResourceId" TEXT,
ADD COLUMN     "fhirVersionId" TEXT,
ADD COLUMN     "lastFetchedAt" TIMESTAMP(3);
