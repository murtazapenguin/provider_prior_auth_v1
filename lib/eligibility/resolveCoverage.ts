import type { PrismaClient } from '@/app/generated/prisma/client'
import { NoActiveCoverageError } from './errors'
import type { CoverageLookup } from './types'

/**
 * Returns the primary active Coverage for a patient on the given encounter
 * date, together with the payer's shortCode needed for policy lookup.
 *
 * "Active" means:
 *   - isPrimary = true
 *   - effectiveFrom <= encounterDate   (inclusive)
 *   - effectiveTo IS NULL  OR  effectiveTo > encounterDate  (strict)
 *
 * Throws `NoActiveCoverageError` when no matching row is found.
 */
export async function resolveCoverage(
  prisma: PrismaClient,
  patientId: string,
  encounterDate: Date
): Promise<CoverageLookup> {
  const coverage = await prisma.coverage.findFirst({
    where: {
      patientId,
      isPrimary: true,
      effectiveFrom: { lte: encounterDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: encounterDate } }],
    },
    include: {
      payer: true,
    },
  })

  if (!coverage) {
    throw new NoActiveCoverageError(patientId, encounterDate)
  }

  return {
    coverageId: coverage.id,
    payerId: coverage.payerId,
    payerShortCode: coverage.payer.shortCode,
    planName: coverage.planName,
    benefitCategory: coverage.benefitCategory,
    memberId: coverage.memberId,
  }
}
