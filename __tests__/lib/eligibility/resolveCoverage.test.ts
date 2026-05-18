import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveCoverage } from '@/lib/eligibility/resolveCoverage'
import { NoActiveCoverageError } from '@/lib/eligibility/errors'

// ─── Fixture data (mirrors prisma/fixtures/coverages.json + PAYERS seed) ──────

const UHC_PAYER = {
  id: 'payer-uhc',
  name: 'United Healthcare',
  shortCode: 'UHC',
}

const COVERAGES = {
  'patient-jordan-avery': {
    id: 'coverage-jordan-avery-uhc',
    patientId: 'patient-jordan-avery',
    payerId: 'payer-uhc',
    payer: UHC_PAYER,
    planName: 'Choice Plus',
    memberId: 'UHC9JA00142',
    groupNumber: 'GRP-00142',
    benefitCategory: 'Medical',
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    effectiveTo: null,
    isPrimary: true,
  },
  'patient-sam-rodriguez': {
    id: 'coverage-sam-rodriguez-uhc',
    patientId: 'patient-sam-rodriguez',
    payerId: 'payer-uhc',
    payer: UHC_PAYER,
    planName: 'Choice Plus',
    memberId: 'UHC9SR00287',
    groupNumber: 'GRP-00287',
    benefitCategory: 'Medical',
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    effectiveTo: null,
    isPrimary: true,
  },
  'patient-priya-shah': {
    id: 'coverage-priya-shah-uhc',
    patientId: 'patient-priya-shah',
    payerId: 'payer-uhc',
    payer: UHC_PAYER,
    planName: 'Choice Plus',
    memberId: 'UHC9PS00531',
    groupNumber: 'GRP-00531',
    benefitCategory: 'Medical',
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    effectiveTo: null,
    isPrimary: true,
  },
} as const

// ─── Helper: create a minimal prisma mock ─────────────────────────────────────

function makePrismaMock(returnValue: unknown | null) {
  return {
    coverage: {
      findFirst: vi.fn().mockResolvedValue(returnValue),
    },
  } as unknown as import('@/app/generated/prisma/client').PrismaClient
}

// ─── Demo date that falls inside all three open-ended coverages ───────────────

const DEMO_DATE = new Date('2026-05-15T12:00:00.000Z')

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('resolveCoverage', () => {
  describe('(a) all three demo patients resolve to expected coverage', () => {
    it('jordan-avery → coverage-jordan-avery-uhc', async () => {
      const prisma = makePrismaMock(COVERAGES['patient-jordan-avery'])
      const result = await resolveCoverage(prisma, 'patient-jordan-avery', DEMO_DATE)

      expect(result).toEqual({
        coverageId: 'coverage-jordan-avery-uhc',
        payerId: 'payer-uhc',
        payerShortCode: 'UHC',
        planName: 'Choice Plus',
        benefitCategory: 'Medical',
        memberId: 'UHC9JA00142',
      })

      // Verify the where-clause passes the correct patientId and date filters
      expect(prisma.coverage.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            patientId: 'patient-jordan-avery',
            isPrimary: true,
            effectiveFrom: { lte: DEMO_DATE },
          }),
        })
      )
    })

    it('sam-rodriguez → coverage-sam-rodriguez-uhc', async () => {
      const prisma = makePrismaMock(COVERAGES['patient-sam-rodriguez'])
      const result = await resolveCoverage(prisma, 'patient-sam-rodriguez', DEMO_DATE)

      expect(result).toEqual({
        coverageId: 'coverage-sam-rodriguez-uhc',
        payerId: 'payer-uhc',
        payerShortCode: 'UHC',
        planName: 'Choice Plus',
        benefitCategory: 'Medical',
        memberId: 'UHC9SR00287',
      })
    })

    it('priya-shah → coverage-priya-shah-uhc', async () => {
      const prisma = makePrismaMock(COVERAGES['patient-priya-shah'])
      const result = await resolveCoverage(prisma, 'patient-priya-shah', DEMO_DATE)

      expect(result).toEqual({
        coverageId: 'coverage-priya-shah-uhc',
        payerId: 'payer-uhc',
        payerShortCode: 'UHC',
        planName: 'Choice Plus',
        benefitCategory: 'Medical',
        memberId: 'UHC9PS00531',
      })
    })
  })

  describe('(b) inactive coverage is skipped', () => {
    it('does not return a coverage whose effectiveTo has passed', async () => {
      // Simulate prisma returning null (the DB would filter it out via the
      // effectiveTo > encounterDate predicate). Verify we get NoActiveCoverageError,
      // not a stale record.
      const prisma = makePrismaMock(null)
      const pastDate = new Date('2026-06-01T00:00:00.000Z')

      await expect(
        resolveCoverage(prisma, 'patient-jordan-avery', pastDate)
      ).rejects.toThrow(NoActiveCoverageError)

      // Confirm the OR clause is passed so the DB knows to enforce the expiry check
      expect(prisma.coverage.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: pastDate } }],
          }),
        })
      )
    })

    it('does not return a coverage where effectiveTo === encounterDate (strict greater-than)', async () => {
      // Boundary: effectiveTo must be STRICTLY greater than encounterDate.
      // We verify the where-clause uses { gt } not { gte }.
      const exactDate = new Date('2026-05-15T00:00:00.000Z')
      const prisma = makePrismaMock(null)

      await expect(
        resolveCoverage(prisma, 'patient-jordan-avery', exactDate)
      ).rejects.toThrow(NoActiveCoverageError)

      expect(prisma.coverage.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: exactDate } }],
          }),
        })
      )
    })
  })

  describe('(c) NoActiveCoverageError thrown when none active', () => {
    it('throws NoActiveCoverageError when findFirst returns null', async () => {
      const prisma = makePrismaMock(null)

      await expect(
        resolveCoverage(prisma, 'patient-unknown', DEMO_DATE)
      ).rejects.toThrow(NoActiveCoverageError)
    })

    it('error carries the patientId and encounterDate', async () => {
      const prisma = makePrismaMock(null)

      try {
        await resolveCoverage(prisma, 'patient-unknown', DEMO_DATE)
        throw new Error('Expected NoActiveCoverageError to be thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(NoActiveCoverageError)
        const e = err as NoActiveCoverageError
        expect(e.patientId).toBe('patient-unknown')
        expect(e.encounterDate).toBe(DEMO_DATE)
        expect(e.message).toContain('patient-unknown')
        expect(e.name).toBe('NoActiveCoverageError')
      }
    })

    it('error is instanceof Error as well', async () => {
      const prisma = makePrismaMock(null)

      await expect(
        resolveCoverage(prisma, 'patient-unknown', DEMO_DATE)
      ).rejects.toBeInstanceOf(Error)
    })
  })

  describe('resolved coverage tuples (demo patients)', () => {
    it('prints all three demo patient coverage tuples', async () => {
      const patients = [
        'patient-jordan-avery',
        'patient-sam-rodriguez',
        'patient-priya-shah',
      ] as const

      for (const patientId of patients) {
        const prisma = makePrismaMock(COVERAGES[patientId])
        const result = await resolveCoverage(prisma, patientId, DEMO_DATE)
        console.log(
          `[demo] ${patientId}: coverageId=${result.coverageId}, payerShortCode=${result.payerShortCode}, planName="${result.planName}", benefitCategory=${result.benefitCategory}, memberId=${result.memberId}`
        )
      }
    })
  })
})
