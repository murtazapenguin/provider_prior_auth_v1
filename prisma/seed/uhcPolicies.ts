/**
 * loadUhcPolicies — Phase 7 onboarding seed step.
 *
 * Reads markdown files under `policies/uhc/`, parses YAML frontmatter +
 * body, and upserts Policy + PolicyCode + PolicyCriterion rows. Runs after
 * `loadDemoPolicies` (which loads the 6 hand-curated demo policies from
 * `prisma/fixtures/policies/*.json`). The hand-curated demos are
 * authoritative; markdown-sourced UHC policies layer on top with
 * `publishStatus: draft` unless the markdown author has set it to
 * `published`.
 *
 * Markdown spec (contract with services/ai/policy_to_markdown.py):
 *
 *   ---
 *   id: policy-uhc-cardiac-stress-test
 *   payerId: payer-uhc
 *   policyType: MedicalPolicy
 *   externalId: cardiac-stress-test
 *   title: Cardiac Stress Test
 *   effectiveFrom: 2024-01-01
 *   effectiveTo: null
 *   sourceUrl: UHC/medical-policies/cardiac-stress-test.pdf
 *   publishStatus: draft
 *   policyVersion: ai-ingested-v1
 *   codes:
 *     - { codeType: CPT, code: "93016", posCodes: [] }
 *   ---
 *
 *   # Cardiac Stress Test
 *
 *   ## Criterion 1
 *   Patient has documented chest pain...
 *
 *   ### Evidence hint     (optional)
 *   Look for chest-pain ICD code in HPI.
 *
 *   ### Upload hint       (optional)
 *   Upload provider attestation.
 *
 *   ## Criterion 2
 *   ...
 */

import * as fs from 'fs'
import * as path from 'path'
import matter from 'gray-matter'
import { ListObjectsV2Command, GetObjectCommand, S3Client } from '@aws-sdk/client-s3'

import type { PrismaClient } from '../../app/generated/prisma/client'

// ─── Source resolution (Phase 7 S3 layer) ──────────────────────────────────────

/**
 * POLICIES_SOURCE env flag controls where uhcPolicies reads from:
 *   - 'local' → glob policies/uhc/*.md from disk (Phase 7 Stage 2.3 behavior).
 *   - 's3'    → list + get markdown objects under s3://{bucket}/policies/uhc/.
 *   - 'both'  → union, S3 wins on conflict (S3 is canonical per locked decision).
 * Default 'both' for dev safety; production sets 's3'.
 */
type PoliciesSource = 'local' | 's3' | 'both'

function resolvePoliciesSource(): PoliciesSource {
  const raw = process.env.POLICIES_SOURCE?.trim().toLowerCase()
  if (raw === 'local' || raw === 's3' || raw === 'both') return raw
  return 'both'
}

interface MarkdownEntry {
  /** Filename without path, e.g. "cardiac-stress-test.md". Used as the key
   *  for conflict detection between S3 and local. */
  name: string
  /** Raw markdown content (frontmatter + body). */
  content: string
  /** Origin label for log messages. */
  origin: 'local' | 's3'
}

async function loadFromLocal(policiesDir: string): Promise<MarkdownEntry[]> {
  if (!fs.existsSync(policiesDir)) return []
  return fs
    .readdirSync(policiesDir)
    .filter((name) => name.endsWith('.md') && !name.startsWith('_'))
    .sort()
    .map((name) => ({
      name,
      content: fs.readFileSync(path.join(policiesDir, name), 'utf-8'),
      origin: 'local' as const,
    }))
}

async function loadFromS3(bucket: string, keyPrefix: string): Promise<MarkdownEntry[]> {
  const client = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-2' })
  const prefix = keyPrefix.endsWith('/') ? keyPrefix : `${keyPrefix}/`
  const out: MarkdownEntry[] = []
  let continuationToken: string | undefined
  do {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    )
    for (const obj of list.Contents ?? []) {
      if (!obj.Key || !obj.Key.endsWith('.md')) continue
      const name = obj.Key.slice(prefix.length)
      if (name.startsWith('_')) continue
      const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: obj.Key }))
      const body = await got.Body?.transformToString('utf-8')
      if (!body) continue
      out.push({ name, content: body, origin: 's3' })
    }
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined
  } while (continuationToken)
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

// ─── Frontmatter shape (validated at parse time) ──────────────────────────────

interface FrontmatterCode {
  codeType: string
  code: string
  modifier?: string | null
  posCodes?: string[]
}

interface PolicyFrontmatter {
  id: string
  payerId: string
  policyType: string
  externalId: string
  title: string
  effectiveFrom: string | Date
  effectiveTo?: string | Date | null
  sourceUrl?: string | null
  publishStatus?: string
  policyVersion?: string | null
  codes?: FrontmatterCode[]
}

interface ParsedCriterion {
  ordinal: number
  text: string
  evidenceHint: string | null
  uploadHint: string | null
}

// ─── Body parser ──────────────────────────────────────────────────────────────

function parseCriteriaFromBody(body: string): ParsedCriterion[] {
  /**
   * Split the markdown body on `## Criterion N` headings. Each criterion's
   * text runs from the next non-heading paragraph until the next
   * `## Criterion` or `### Evidence hint` / `### Upload hint` subsection.
   *
   * Heading conventions (case-insensitive, leading whitespace allowed):
   *   ## Criterion N           — starts a criterion section
   *   ## Criterion N: <title>  — same; title-after-colon ignored
   *   ### Evidence hint        — evidenceHint subsection
   *   ### Upload hint          — uploadHint subsection
   *
   * Anything not under a `## Criterion N` heading (e.g. the H1 policy
   * title) is ignored.
   */
  const lines = body.split('\n')
  const criteria: ParsedCriterion[] = []
  let current: { ordinal: number; textLines: string[]; section: 'text' | 'evidence' | 'upload' } | null = null
  let evidenceLines: string[] = []
  let uploadLines: string[] = []

  const commit = () => {
    if (!current) return
    const c: ParsedCriterion = {
      ordinal: current.ordinal,
      text: current.textLines.join('\n').trim(),
      evidenceHint: evidenceLines.length > 0 ? evidenceLines.join('\n').trim() : null,
      uploadHint: uploadLines.length > 0 ? uploadLines.join('\n').trim() : null,
    }
    criteria.push(c)
  }

  for (const raw of lines) {
    const line = raw // keep raw to preserve in-text formatting
    const criterionMatch = /^\s*##\s+Criterion\s+(\d+)\b/i.exec(line)
    const evidenceMatch = /^\s*###\s+Evidence\s+hint\b/i.exec(line)
    const uploadMatch = /^\s*###\s+Upload\s+hint\b/i.exec(line)

    if (criterionMatch) {
      // Commit the previous criterion if any.
      commit()
      current = {
        ordinal: parseInt(criterionMatch[1]!, 10),
        textLines: [],
        section: 'text',
      }
      evidenceLines = []
      uploadLines = []
      continue
    }
    if (!current) {
      // Anything before the first `## Criterion N` heading is preamble (e.g. H1).
      continue
    }
    if (evidenceMatch) {
      current.section = 'evidence'
      continue
    }
    if (uploadMatch) {
      current.section = 'upload'
      continue
    }
    // Accumulate into the current subsection.
    if (current.section === 'text') {
      current.textLines.push(line)
    } else if (current.section === 'evidence') {
      evidenceLines.push(line)
    } else if (current.section === 'upload') {
      uploadLines.push(line)
    }
  }
  // Commit the last criterion.
  commit()

  return criteria
}

// ─── Frontmatter validation ───────────────────────────────────────────────────

function validateFrontmatter(fm: unknown, mdPath: string): PolicyFrontmatter {
  if (typeof fm !== 'object' || fm === null) {
    throw new Error(`${mdPath}: frontmatter is missing or not an object`)
  }
  const obj = fm as Record<string, unknown>
  const required = ['id', 'payerId', 'policyType', 'externalId', 'title', 'effectiveFrom'] as const
  for (const key of required) {
    if (obj[key] === undefined || obj[key] === null) {
      throw new Error(`${mdPath}: frontmatter is missing required key '${key}'`)
    }
  }
  return obj as unknown as PolicyFrontmatter
}

// ─── Public loader ────────────────────────────────────────────────────────────

export async function loadUhcPolicies(
  prisma: PrismaClient,
  policiesDir = path.resolve(__dirname, '..', '..', 'policies', 'uhc')
): Promise<{ policies: number; codes: number; criteria: number; skipped: number; source: PoliciesSource }> {
  let policies = 0
  let codes = 0
  let criteria = 0
  let skipped = 0

  const source = resolvePoliciesSource()
  const bucket = process.env.S3_POLICIES_BUCKET ?? process.env.S3_OCR_STAGING_BUCKET ?? ''
  const keyPrefix = process.env.S3_POLICIES_KEY_PREFIX ?? 'policies/uhc/'

  // ── Collect entries from the requested source(s) ─────────────────────────
  let entries: MarkdownEntry[] = []

  if (source === 'local' || source === 'both') {
    entries = entries.concat(await loadFromLocal(policiesDir))
  }
  if (source === 's3' || source === 'both') {
    if (!bucket) {
      if (source === 's3') {
        throw new Error(
          `POLICIES_SOURCE=s3 but no S3_POLICIES_BUCKET or S3_OCR_STAGING_BUCKET configured`
        )
      }
      // 'both' with no bucket: warn + skip the S3 leg.
      console.warn(`  ℹ️  POLICIES_SOURCE=both: no S3 bucket configured; reading from local only`)
    } else {
      const s3Entries = await loadFromS3(bucket, keyPrefix)
      if (source === 's3') {
        entries = s3Entries
      } else {
        // 'both': union with S3 winning conflicts.
        const localByName = new Map(entries.map((e) => [e.name, e]))
        const s3ByName = new Map(s3Entries.map((e) => [e.name, e]))
        const allNames = new Set<string>([...localByName.keys(), ...s3ByName.keys()])
        const merged: MarkdownEntry[] = []
        for (const name of Array.from(allNames).sort()) {
          const s3Entry = s3ByName.get(name)
          const localEntry = localByName.get(name)
          if (s3Entry && localEntry && s3Entry.content !== localEntry.content) {
            console.warn(
              `  ⚠️  ${name}: local and S3 disagree — using S3 (canonical). Local file may need a push.`
            )
          }
          merged.push(s3Entry ?? localEntry!)
        }
        entries = merged
      }
    }
  }

  // ── Parse + upsert each entry ────────────────────────────────────────────
  for (const entry of entries) {
    const mdPath = `${entry.origin}:${entry.name}`

    let parsed: matter.GrayMatterFile<string>
    try {
      parsed = matter(entry.content)
    } catch (err) {
      console.warn(`  ⚠️  Frontmatter parse failed for ${mdPath}: ${(err as Error).message} — skipping`)
      skipped += 1
      continue
    }

    let fm: PolicyFrontmatter
    try {
      fm = validateFrontmatter(parsed.data, mdPath)
    } catch (err) {
      console.warn(`  ⚠️  ${(err as Error).message} — skipping`)
      skipped += 1
      continue
    }

    const parsedCriteria = parseCriteriaFromBody(parsed.content)

    // Coerce dates — YAML may give a Date object or an ISO string.
    const effectiveFrom = new Date(fm.effectiveFrom)
    const effectiveTo = fm.effectiveTo ? new Date(fm.effectiveTo) : null
    const publishStatus = fm.publishStatus ?? 'draft'

    // ── Upsert Policy ──────────────────────────────────────────────────────
    await prisma.policy.upsert({
      where: { id: fm.id },
      update: {
        title: fm.title,
        externalId: fm.externalId,
        policyType: fm.policyType,
        effectiveFrom,
        effectiveTo,
        sourceUrl: fm.sourceUrl ?? null,
        publishStatus,
        publishedAt: publishStatus === 'published' ? new Date() : null,
        publishedBy: publishStatus === 'published' ? 'seed' : null,
        policyVersion: fm.policyVersion ?? null,
      },
      create: {
        id: fm.id,
        payerId: fm.payerId,
        policyType: fm.policyType,
        externalId: fm.externalId,
        title: fm.title,
        effectiveFrom,
        effectiveTo,
        sourceUrl: fm.sourceUrl ?? null,
        publishStatus,
        publishedAt: publishStatus === 'published' ? new Date() : null,
        publishedBy: publishStatus === 'published' ? 'seed' : null,
        policyVersion: fm.policyVersion ?? null,
      },
    })
    policies += 1

    // ── Replace PolicyCode + PolicyCriterion rows (idempotent re-seed) ─────
    await prisma.policyCode.deleteMany({ where: { policyId: fm.id } })
    await prisma.policyCriterion.deleteMany({ where: { policyId: fm.id } })

    const codesIn = fm.codes ?? []
    for (const c of codesIn) {
      await prisma.policyCode.create({
        data: {
          policyId: fm.id,
          codeType: c.codeType.toUpperCase(),
          code: c.code.toUpperCase(),
          modifier: c.modifier ?? null,
          posCodes: c.posCodes ?? [],
        },
      })
      codes += 1
    }

    for (const cr of parsedCriteria) {
      await prisma.policyCriterion.create({
        data: {
          policyId: fm.id,
          ordinal: cr.ordinal,
          text: cr.text,
          evidenceHint: cr.evidenceHint,
          uploadHint: cr.uploadHint,
          requiredCodes: [],
          sourceLineNumbers: [],
        },
      })
      criteria += 1
    }
  }

  return { policies, codes, criteria, skipped, source }
}
