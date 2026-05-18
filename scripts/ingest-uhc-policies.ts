import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config() // fallback to .env

import path from 'path'
import fs from 'fs'
import pLimit from 'p-limit'
import { prisma } from '../lib/db/client'
import { ingestPolicy } from '../lib/ai/policyIngestion'

// ─── CLI arg parsing ──────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const force = args.includes('--force')
const limitIdx = args.indexOf('--limit')
const limitN = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null

// ─── Path constants ───────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..')
const UHC_MEDICAL_DIR = path.join(REPO_ROOT, 'UHC', 'medical-policies')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stemFromFilename(filename: string): string {
  // botulinum-toxins-a-and-b-cs.pdf → botulinum-toxins-a-and-b
  const base = filename.replace(/-cs\.pdf$/, '')
  // Normalise non-alphanumeric chars to hyphens
  return base.replace(/[^a-zA-Z0-9]+/g, '-')
}

function policyIdFromStem(stem: string): string {
  return `policy-uhc-${stem}`
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function ingestAll(): Promise<void> {
  // Collect and sort files for deterministic ordering
  const allFiles = fs
    .readdirSync(UHC_MEDICAL_DIR)
    .filter((f) => f.endsWith('-cs.pdf'))
    .sort()

  const files = limitN !== null ? allFiles.slice(0, limitN) : allFiles
  const total = files.length

  console.log(
    `Starting UHC medical-policy ingestion: ${total} file(s)` +
      (dryRun ? ' [DRY-RUN]' : '') +
      (force ? ' [FORCE]' : '')
  )

  const limit = pLimit(5)
  let completed = 0

  const tasks = files.map((filename, idx) =>
    limit(async () => {
      const n = idx + 1
      const stem = stemFromFilename(filename)
      const policyId = policyIdFromStem(stem)
      const absPath = path.join(UHC_MEDICAL_DIR, filename)
      const relSourceUrl = `UHC/medical-policies/${filename}`

      try {
        // Skip check — only query DB when we'll actually write (dry-run has no DB access)
        let existing = null
        if (!dryRun) {
          existing = await prisma.policy.findUnique({ where: { id: policyId } })
          if (existing && !force) {
            console.log(`[${n}/${total}] ${policyId} — [SKIP] already ingested`)
            completed++
            return
          }
        }

        // OCR + extract (always run, even in dry-run)
        const result = await ingestPolicy(absPath, policyId)

        const criteriaCount = result.criteria.length
        const label = dryRun ? '[DRY-RUN]' : existing ? '[UPDATE]' : '[CREATE]'
        console.log(`[${n}/${total}] ${policyId} — ${criteriaCount} criteria extracted ${label}`)

        if (dryRun) {
          completed++
          return
        }

        // Build the criterion rows
        const criteriaData = result.criteria.map((c) => ({
          ordinal: c.ordinal,
          text: c.text,
          evidenceHint: c.evidence_hint ?? null,
          uploadHint: c.upload_hint ?? null,
          group: c.group ?? null,
          groupOperator: c.group_operator ?? null,
          sourceLineNumbers: c.source_line_numbers,
          sourceBboxes: c.source_bboxes as unknown as object[],
          requiredCodes: [] as string[],
        }))

        if (!existing) {
          // CREATE path — use nested createMany so it's a single statement
          await prisma.policy.create({
            data: {
              id: policyId,
              payerId: 'payer-uhc',
              policyType: 'MedicalPolicy',
              externalId: stem,
              title: stem.replace(/-/g, ' '),
              effectiveFrom: new Date(),
              sourceUrl: relSourceUrl,
              sourceText: '',
              criteria: {
                createMany: {
                  data: criteriaData,
                },
              },
            },
          })
        } else {
          // UPDATE path — delete criteria then recreate, wrapped in a transaction
          await prisma.$transaction([
            prisma.policyCriterion.deleteMany({ where: { policyId } }),
            prisma.policy.update({
              where: { id: policyId },
              data: {
                title: stem.replace(/-/g, ' '),
                sourceUrl: relSourceUrl,
              },
            }),
            prisma.policyCriterion.createMany({
              data: criteriaData.map((c) => ({ ...c, policyId })),
            }),
          ])
        }

        completed++
      } catch (err) {
        console.error(`[${n}/${total}] ${policyId} — ERROR:`, (err as Error).message)
        // Continue processing other files
      }
    })
  )

  await Promise.all(tasks)

  console.log(`Done. ${completed}/${total} processed.`)
}

ingestAll()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => {
    if (!dryRun) void prisma.$disconnect()
  })
