import * as fs from 'fs'
import * as path from 'path'
import { PrismaClient, Prisma } from '../../app/generated/prisma/client'

// ─── Types matching the JSON policy fixtures ───────────────────────────────────

interface PolicyCodeFixture {
  id: string
  codeType: string
  code: string
  modifier: string | null
  posCodes: string[]
}

interface PolicyCriterionFixture {
  id: string
  ordinal: number
  text: string
  evidenceHint: string | null
  requiredCodes: string[]
  group: string | null
  groupOperator: string | null
  sourceLineNumbers: number[]
}

interface PolicyFixture {
  id: string
  payerId: string
  policyType: string
  externalId: string | null
  title: string
  effectiveFrom: string
  effectiveTo: string | null
  sourceUrl: string | null
  sourceText: string | null
  codes: PolicyCodeFixture[]
  criteria: PolicyCriterionFixture[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fixturesPath(...parts: string[]): string {
  return path.resolve(__dirname, '..', 'fixtures', ...parts)
}

function readJson<T>(relPath: string): T {
  const absPath = fixturesPath(relPath)
  const raw = fs.readFileSync(absPath, 'utf-8')
  return JSON.parse(raw) as T
}

// ─── Main loader ──────────────────────────────────────────────────────────────

export async function loadDemoPolicies(
  prisma: PrismaClient
): Promise<{ policies: number; codes: number; criteria: number }> {
  const policyFiles = [
    'policies/head_ct.json',
    'policies/knee_mri.json',
    'policies/botox.json',
    'policies/stelara_crohns.json',
    'policies/iop_behavioral_health.json',
    'policies/power_wheelchair.json',
  ]

  let totalPolicies = 0
  let totalCodes = 0
  let totalCriteria = 0

  for (const filename of policyFiles) {
    const fixture = readJson<PolicyFixture>(filename)

    // ── 1. Policy ────────────────────────────────────────────────────────────
    await prisma.policy.upsert({
      where: { id: fixture.id },
      update: {},
      create: {
        id: fixture.id,
        payerId: fixture.payerId,
        policyType: fixture.policyType,
        externalId: fixture.externalId ?? null,
        title: fixture.title,
        effectiveFrom: new Date(fixture.effectiveFrom),
        effectiveTo: fixture.effectiveTo ? new Date(fixture.effectiveTo) : null,
        sourceUrl: fixture.sourceUrl ?? null,
        sourceText: fixture.sourceText ?? null,
      },
    })
    totalPolicies++

    // ── 2. PolicyCodes ───────────────────────────────────────────────────────
    for (const code of fixture.codes) {
      await prisma.policyCode.upsert({
        where: { id: code.id },
        update: {},
        create: {
          id: code.id,
          policyId: fixture.id,
          codeType: code.codeType,
          code: code.code,
          modifier: code.modifier ?? null,
          posCodes: code.posCodes,
        },
      })
      totalCodes++
    }

    // ── 3. PolicyCriteria ────────────────────────────────────────────────────
    for (const criterion of fixture.criteria) {
      await prisma.policyCriterion.upsert({
        where: { id: criterion.id },
        update: {},
        create: {
          id: criterion.id,
          policyId: fixture.id,
          ordinal: criterion.ordinal,
          text: criterion.text,
          evidenceHint: criterion.evidenceHint ?? null,
          requiredCodes: criterion.requiredCodes,
          group: criterion.group ?? null,
          groupOperator: criterion.groupOperator ?? null,
          sourceBboxes: Prisma.DbNull,
          sourceLineNumbers: criterion.sourceLineNumbers,
        },
      })
      totalCriteria++
    }
  }

  // Sanity-check: fail loudly if counts don't match expectations
  const EXPECTED = { policies: 6, codes: 8, criteria: 25 }
  if (
    totalPolicies !== EXPECTED.policies ||
    totalCodes !== EXPECTED.codes ||
    totalCriteria !== EXPECTED.criteria
  ) {
    throw new Error(
      `loadDemoPolicies: count mismatch. ` +
        `Expected policies=${EXPECTED.policies} codes=${EXPECTED.codes} criteria=${EXPECTED.criteria}. ` +
        `Got policies=${totalPolicies} codes=${totalCodes} criteria=${totalCriteria}. ` +
        `Check fixture JSON files in prisma/fixtures/policies/.`
    )
  }

  return { policies: totalPolicies, codes: totalCodes, criteria: totalCriteria }
}
