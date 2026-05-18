-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dob" TIMESTAMP(3) NOT NULL,
    "sex" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coverage" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "groupNumber" TEXT,
    "benefitCategory" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Coverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Encounter" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "encounterDate" TIMESTAMP(3) NOT NULL,
    "placeOfService" TEXT NOT NULL,

    CONSTRAINT "Encounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalNote" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "noteType" TEXT NOT NULL,
    "authoredAt" TIMESTAMP(3) NOT NULL,
    "authorRole" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "ClinicalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "npi" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "specialty" TEXT NOT NULL,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,

    CONSTRAINT "Payer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "policyType" TEXT NOT NULL,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "sourceUrl" TEXT,
    "sourceText" TEXT,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyCode" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "codeType" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "modifier" TEXT,
    "posCodes" TEXT[],

    CONSTRAINT "PolicyCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyCriterion" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "evidenceHint" TEXT,
    "requiredCodes" TEXT[],
    "group" TEXT,
    "groupOperator" TEXT,
    "sourceBboxes" JSONB,
    "sourceLineNumbers" INTEGER[],

    CONSTRAINT "PolicyCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriorAuth" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "statusReason" TEXT,
    "trackingId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "pendingSubmissionExpiresAt" TIMESTAMP(3),
    "payerExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriorAuth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriorAuthCode" (
    "id" TEXT NOT NULL,
    "priorAuthId" TEXT NOT NULL,
    "codeType" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "modifier" TEXT,
    "description" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL,
    "derivedBy" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,

    CONSTRAINT "PriorAuthCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriterionResult" (
    "id" TEXT NOT NULL,
    "priorAuthId" TEXT NOT NULL,
    "criterionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rationale" TEXT,
    "confidence" DOUBLE PRECISION,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CriterionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Citation" (
    "id" TEXT NOT NULL,
    "criterionResultId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "supportingTexts" TEXT[],
    "reasoning" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "bboxes" JSONB NOT NULL,
    "lineNumbers" INTEGER[],

    CONSTRAINT "Citation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "priorAuthId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storageUrl" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extractedText" TEXT,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaEvent" (
    "id" TEXT NOT NULL,
    "priorAuthId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "actor" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeReference" (
    "id" TEXT NOT NULL,
    "codeType" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "CodeReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCallCache" (
    "id" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "responseJson" JSONB NOT NULL,
    "tracedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCallCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Healthcheck" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Healthcheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Patient_externalId_key" ON "Patient"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Provider_npi_key" ON "Provider"("npi");

-- CreateIndex
CREATE UNIQUE INDEX "Payer_name_key" ON "Payer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Payer_shortCode_key" ON "Payer"("shortCode");

-- CreateIndex
CREATE INDEX "PolicyCode_code_codeType_idx" ON "PolicyCode"("code", "codeType");

-- CreateIndex
CREATE INDEX "PriorAuth_status_idx" ON "PriorAuth"("status");

-- CreateIndex
CREATE INDEX "PaEvent_priorAuthId_createdAt_idx" ON "PaEvent"("priorAuthId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CodeReference_codeType_code_key" ON "CodeReference"("codeType", "code");

-- CreateIndex
CREATE UNIQUE INDEX "AiCallCache_task_promptVersion_model_inputHash_key" ON "AiCallCache"("task", "promptVersion", "model", "inputHash");

-- AddForeignKey
ALTER TABLE "Coverage" ADD CONSTRAINT "Coverage_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coverage" ADD CONSTRAINT "Coverage_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalNote" ADD CONSTRAINT "ClinicalNote_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyCode" ADD CONSTRAINT "PolicyCode_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyCriterion" ADD CONSTRAINT "PolicyCriterion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriorAuth" ADD CONSTRAINT "PriorAuth_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriorAuth" ADD CONSTRAINT "PriorAuth_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriorAuth" ADD CONSTRAINT "PriorAuth_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Payer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriorAuthCode" ADD CONSTRAINT "PriorAuthCode_priorAuthId_fkey" FOREIGN KEY ("priorAuthId") REFERENCES "PriorAuth"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionResult" ADD CONSTRAINT "CriterionResult_priorAuthId_fkey" FOREIGN KEY ("priorAuthId") REFERENCES "PriorAuth"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriterionResult" ADD CONSTRAINT "CriterionResult_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "PolicyCriterion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Citation" ADD CONSTRAINT "Citation_criterionResultId_fkey" FOREIGN KEY ("criterionResultId") REFERENCES "CriterionResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_priorAuthId_fkey" FOREIGN KEY ("priorAuthId") REFERENCES "PriorAuth"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaEvent" ADD CONSTRAINT "PaEvent_priorAuthId_fkey" FOREIGN KEY ("priorAuthId") REFERENCES "PriorAuth"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
