import * as fs from 'fs'
import * as path from 'path'
import { parse } from 'csv-parse'
import { PrismaClient } from '../../app/generated/prisma/client'

const REPO_ROOT = path.resolve(__dirname, '../../')
const BATCH_SIZE = 1000

// Code-shape classifier: 5-digit numeric → CPT, anything else → HCPCS
function classifyHcpcsRow(codeValue: string): 'CPT' | 'HCPCS' {
  return /^\d{5}$/.test(codeValue) ? 'CPT' : 'HCPCS'
}

interface CodeRow {
  codeType: string
  code: string
  description: string
  category?: string
}

async function flushBatch(prisma: PrismaClient, batch: CodeRow[]): Promise<void> {
  if (batch.length === 0) return
  await prisma.codeReference.createMany({
    data: batch,
    skipDuplicates: true,
  })
}

async function loadIcd10(prisma: PrismaClient): Promise<number> {
  const filePath = path.join(REPO_ROOT, 'ICD-10 – Full Code Set', 'icd10_codes.csv')
  let loaded = 0
  let skipped = 0
  let buffer: CodeRow[] = []

  const stream = fs.createReadStream(filePath).pipe(
    parse({ columns: true, skip_empty_lines: true })
  )

  for await (const row of stream) {
    const code: string = (row.code ?? '').trim()
    const description: string =
      (row.long_description ?? '').trim() || (row.short_description ?? '').trim()

    if (!code || !description) {
      skipped++
      continue
    }

    buffer.push({ codeType: 'ICD10', code, description })

    if (buffer.length >= BATCH_SIZE) {
      await flushBatch(prisma, buffer)
      loaded += buffer.length
      buffer = []
    }
  }

  if (buffer.length > 0) {
    await flushBatch(prisma, buffer)
    loaded += buffer.length
  }

  if (skipped > 0) {
    console.warn(`  ⚠ ICD-10: skipped ${skipped} rows with empty code or description`)
  }

  return loaded
}

async function loadCpt(prisma: PrismaClient): Promise<number> {
  const filePath = path.join(REPO_ROOT, 'CPT Codes', 'cpt-codes.csv')
  let loaded = 0
  let skipped = 0
  const buffer: CodeRow[] = []

  const stream = fs.createReadStream(filePath).pipe(
    parse({ columns: true, skip_empty_lines: true })
  )

  for await (const row of stream) {
    const code: string = (row.code ?? '').trim()
    const description: string = (row.description ?? '').trim()

    if (!code || !description) {
      skipped++
      continue
    }

    buffer.push({
      codeType: 'CPT',
      code,
      description,
      category: (row.category ?? '').trim() || undefined,
    })
  }

  if (buffer.length > 0) {
    await flushBatch(prisma, buffer)
    loaded = buffer.length
  }

  if (skipped > 0) {
    console.warn(`  ⚠ CPT: skipped ${skipped} rows with empty code or description`)
  }

  return loaded
}

/**
 * Backfill from CMS coverage_code_mappings.csv.
 * mapping_type='hcpcs' covers both HCPCS Level II and CPT (HCPCS Level I).
 * Classifier: 5-digit numeric → CPT, else → HCPCS.
 * Returns { cpt: number; hcpcs: number } added counts.
 */
async function loadFromCoverageCodeMappings(
  prisma: PrismaClient
): Promise<{ cpt: number; hcpcs: number }> {
  const filePath = path.join(REPO_ROOT, 'CMS', 'coverage_code_mappings.csv')
  const seen = new Set<string>()
  let cptLoaded = 0
  let hcpcsLoaded = 0
  let skipped = 0
  let buffer: CodeRow[] = []

  const stream = fs.createReadStream(filePath).pipe(
    parse({ columns: true, skip_empty_lines: true })
  )

  const flush = async () => {
    if (buffer.length === 0) return
    // Count before flush (skipDuplicates means some may not insert, but count what we attempted)
    const cptCount = buffer.filter((r) => r.codeType === 'CPT').length
    const hcpcsCount = buffer.filter((r) => r.codeType === 'HCPCS').length
    await prisma.codeReference.createMany({ data: buffer, skipDuplicates: true })
    cptLoaded += cptCount
    hcpcsLoaded += hcpcsCount
    buffer = []
  }

  for await (const row of stream) {
    const mappingType: string = (row.mapping_type ?? '').trim()
    if (mappingType !== 'hcpcs') continue

    const code: string = (row.code_value ?? '').trim()
    const description: string = (row.description ?? '').trim()

    if (!code || !description) {
      skipped++
      continue
    }

    const codeType = classifyHcpcsRow(code)
    const key = `${codeType}:${code}`

    // Skip within-stream duplicates (keep first occurrence = highest policy version seen first)
    if (seen.has(key)) continue
    seen.add(key)

    buffer.push({ codeType, code, description })

    if (buffer.length >= BATCH_SIZE) {
      await flush()
    }
  }

  await flush()

  if (skipped > 0) {
    console.warn(
      `  ⚠ coverage_code_mappings: skipped ${skipped} hcpcs rows with empty code or description`
    )
  }

  return { cpt: cptLoaded, hcpcs: hcpcsLoaded }
}

export async function loadCodeReferences(
  prisma: PrismaClient
): Promise<{ icd10: number; cpt: number; hcpcs: number }> {
  // 1. ICD-10
  const icd10 = await loadIcd10(prisma)

  // 2. CPT from the small sample CSV (21 rows)
  const cptFromFile = await loadCpt(prisma)

  // 3. Backfill CPT + HCPCS from CMS coverage_code_mappings.csv
  //    skipDuplicates handles collisions with already-loaded CPT rows from step 2
  const { cpt: cptFromMappings, hcpcs } = await loadFromCoverageCodeMappings(prisma)

  const cpt = cptFromFile + cptFromMappings

  // 4. Verify demo codes are present — fail loudly if any are missing
  const DEMO_CODES = [
    { codeType: 'CPT', code: '70450' },
    { codeType: 'CPT', code: '73721' },
    { codeType: 'HCPCS', code: 'J0585' },
  ]

  const found = await prisma.codeReference.findMany({
    where: {
      OR: DEMO_CODES.map((c) => ({ codeType: c.codeType, code: c.code })),
    },
    select: { codeType: true, code: true, description: true },
  })

  const foundKeys = new Set(found.map((r) => `${r.codeType}:${r.code}`))
  const missing = DEMO_CODES.filter((c) => !foundKeys.has(`${c.codeType}:${c.code}`))

  if (missing.length > 0) {
    const missingStr = missing.map((c) => `${c.codeType} ${c.code}`).join(', ')
    throw new Error(
      `loadCodeReferences: demo codes not found after load — ${missingStr}. ` +
        `This means the source CSV did not contain these codes. ` +
        `Check CMS/coverage_code_mappings.csv for mapping_type='hcpcs' rows with these code_values.`
    )
  }

  // Log descriptions for the three demo codes
  for (const row of found) {
    console.log(`  ✓ Demo code ${row.codeType} ${row.code}: "${row.description}"`)
  }

  return { icd10, cpt, hcpcs }
}
