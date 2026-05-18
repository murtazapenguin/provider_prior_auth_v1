import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config({ path: path.resolve(process.cwd(), '.env') })

import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../app/generated/prisma/client'
import { loadCodeReferences } from './seed/codeReference'
import { loadDemoFixtures } from './seed/fixtures'
import { loadDemoPolicies } from './seed/demoPolicies'
import { loadUhcPolicies } from './seed/uhcPolicies'

const resetAiCache = process.argv.includes('--reset-ai-cache')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('🌱 Seeding database...')
  if (resetAiCache) console.log('  --reset-ai-cache: AiCallCache will be cleared')

  // Clear tables in FK-dependency order (children before parents)
  console.log('\n🗑️  Clearing existing data...')
  await prisma.$transaction([
    prisma.citation.deleteMany(),
    prisma.criterionResult.deleteMany(),
    prisma.attachment.deleteMany(),
    prisma.paEvent.deleteMany(),
    prisma.priorAuthCode.deleteMany(),
    prisma.priorAuth.deleteMany(),
    prisma.policyCriterion.deleteMany(),
    prisma.policyCode.deleteMany(),
    prisma.policy.deleteMany(),
    prisma.coverage.deleteMany(),
    prisma.cachedDocumentReference.deleteMany(),
    prisma.encounter.deleteMany(),
    prisma.provider.deleteMany(),
    prisma.patient.deleteMany(),
    prisma.payer.deleteMany(),
    prisma.codeReference.deleteMany(),
    ...(resetAiCache ? [prisma.aiCallCache.deleteMany()] : []),
  ])
  console.log('  ✓ Tables cleared')

  // Load reference codes
  console.log('\n📋 Loading code references...')
  const codeRefCounts = await loadCodeReferences(prisma)
  console.log(`  ✓ ICD-10: ${codeRefCounts.icd10} | CPT: ${codeRefCounts.cpt} | HCPCS: ${codeRefCounts.hcpcs}`)

  // Load demo fixtures (patients, encounters, notes, providers, payers)
  console.log('\n👥 Loading demo fixtures...')
  const fixtureCounts = await loadDemoFixtures(prisma)
  console.log(`  ✓ Patients: ${fixtureCounts.patients} | Encounters: ${fixtureCounts.encounters} | Notes: ${fixtureCounts.notes}`)

  // Load hand-curated demo policies
  console.log('\n📜 Loading demo policies...')
  const policyCounts = await loadDemoPolicies(prisma)
  console.log(`  ✓ Policies: ${policyCounts.policies} | Codes: ${policyCounts.codes} | Criteria: ${policyCounts.criteria}`)

  // Load AI-ingested UHC policies (Phase 7 onboarding).
  // Source resolved from POLICIES_SOURCE env: 's3' | 'local' | 'both' (default 'both').
  console.log('\n🏥 Loading UHC markdown policies...')
  const uhcCounts = await loadUhcPolicies(prisma)
  if (uhcCounts.policies === 0 && uhcCounts.skipped === 0) {
    console.log(`  (no UHC markdown files found via source=${uhcCounts.source} — skipping)`)
  } else {
    console.log(
      `  ✓ UHC Policies: ${uhcCounts.policies} | Codes: ${uhcCounts.codes} | Criteria: ${uhcCounts.criteria}` +
        (uhcCounts.skipped > 0 ? ` | Skipped: ${uhcCounts.skipped}` : '') +
        ` (source=${uhcCounts.source})`
    )
  }

  console.log('\n✅ Seed complete.')
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
