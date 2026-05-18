/**
 * Match engine tests — all three demo scenarios.
 *
 * Strategy: we inject a mock PrismaClient so no real DB connection is needed.
 * The mock returns the policy fixture data and records write calls.  The
 * canned responses in lib/ai/evidenceExtraction.ts drive the AI outputs.
 *
 * We mock @/lib/audit/log to avoid the module importing the DB singleton at
 * import time (which would fail without DATABASE_URL).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock audit module before any import that transitively loads it ───────────
// Must appear before the dynamic imports inside tests.
vi.mock('@/lib/audit/log', () => ({
  recordEvent: vi.fn().mockResolvedValue(undefined),
}))

// ─── Also mock @/lib/db/client so Prisma pool init doesn't run ────────────────
vi.mock('@/lib/db/client', () => ({
  prisma: {},
}))

import { recordEvent } from '@/lib/audit/log'

// ─── Load fixture data (used to build the mock Prisma return values) ──────────

import headCtPolicyFixture from '../../../prisma/fixtures/policies/head_ct.json'
import kneeMriPolicyFixture from '../../../prisma/fixtures/policies/knee_mri.json'
import botoxPolicyFixture from '../../../prisma/fixtures/policies/botox.json'

import headCtEncounterFixture from '../../../prisma/fixtures/encounters/head_ct.json'
import kneeMriEncounterFixture from '../../../prisma/fixtures/encounters/knee_mri.json'
import botoxEncounterFixture from '../../../prisma/fixtures/encounters/botox.json'

// ─── Types matching fixture shapes ──────────────────────────────────────────

interface PolicyCriterionFixture {
  id: string
  ordinal: number
  text: string
  evidenceHint?: string
  requiredCodes?: string[]
  group?: string | null
  groupOperator?: string | null
  sourceLineNumbers?: number[]
}

interface PolicyCodeFixture {
  id: string
  codeType: string
  code: string
  modifier?: string | null
  posCodes?: string[]
}

interface PolicyFixture {
  id: string
  payerId: string
  policyType: string
  externalId?: string | null
  title: string
  effectiveFrom: string
  effectiveTo?: string | null
  sourceUrl?: string | null
  sourceText?: string | null
  codes: PolicyCodeFixture[]
  criteria: PolicyCriterionFixture[]
}

interface ClinicalNoteFixture {
  id: string
  noteType: string
  authoredAt: string
  authorRole: string
  source: string
  text: string
}

interface EncounterFixture {
  encounterId: string
  encounterDate: string
  placeOfService: string
  providerId: string
  patientId: string
  notes: ClinicalNoteFixture[]
}

// ─── Convert fixture shapes to Prisma model shapes ────────────────────────────

function policyToModel(pf: PolicyFixture, payerId: string) {
  return {
    id: pf.id,
    payerId: payerId,
    policyType: pf.policyType,
    externalId: pf.externalId ?? null,
    title: pf.title,
    effectiveFrom: new Date(pf.effectiveFrom),
    effectiveTo: pf.effectiveTo ? new Date(pf.effectiveTo) : null,
    sourceUrl: pf.sourceUrl ?? null,
    sourceText: pf.sourceText ?? null,
    applicableCodes: pf.codes.map((c) => ({
      id: c.id,
      policyId: pf.id,
      codeType: c.codeType,
      code: c.code,
      modifier: c.modifier ?? null,
      posCodes: c.posCodes ?? [],
    })),
    criteria: pf.criteria.map((cr) => ({
      id: cr.id,
      policyId: pf.id,
      ordinal: cr.ordinal,
      text: cr.text,
      evidenceHint: cr.evidenceHint ?? null,
      requiredCodes: cr.requiredCodes ?? [],
      group: cr.group ?? null,
      groupOperator: cr.groupOperator ?? null,
      sourceBboxes: null,
      sourceLineNumbers: cr.sourceLineNumbers ?? [],
      results: [],
    })),
  }
}

function encounterToModel(ef: EncounterFixture) {
  return {
    id: ef.encounterId,
    patientId: ef.patientId,
    providerId: ef.providerId,
    encounterDate: new Date(ef.encounterDate),
    placeOfService: ef.placeOfService,
    notes: ef.notes.map((n) => ({
      id: n.id,
      encounterId: ef.encounterId,
      noteType: n.noteType,
      authoredAt: new Date(n.authoredAt),
      authorRole: n.authorRole,
      source: n.source,
      text: n.text,
    })),
  }
}

// ─── Build scenario-specific mocks ───────────────────────────────────────────

interface ScenarioSetup {
  paId: string
  payerId: string
  primaryCode: { codeType: string; code: string }
  policyFixture: PolicyFixture
  encounterFixture: EncounterFixture
}

function buildMockPrisma(setup: ScenarioSetup) {
  const { paId, payerId, primaryCode, policyFixture, encounterFixture } = setup

  const policyModel = policyToModel(policyFixture, payerId)
  const encounterModel = encounterToModel(encounterFixture)

  const pa = {
    id: paId,
    encounterId: encounterModel.id,
    providerId: encounterModel.providerId,
    payerId: payerId,
    status: 'draft',
    statusReason: null,
    trackingId: null,
    submittedAt: null,
    pendingSubmissionExpiresAt: null,
    payerExpiresAt: null,
    simulatorNextTransitionAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    codes: [
      {
        id: `pacode-${paId}`,
        priorAuthId: paId,
        codeType: primaryCode.codeType,
        code: primaryCode.code,
        modifier: null,
        description: 'test',
        isPrimary: true,
        derivedBy: 'manual',
        confidence: null,
      },
    ],
    encounter: encounterModel,
    attachments: [],
    payer: { id: payerId, name: 'United Healthcare', shortCode: 'UHC' },
  }

  // Capture written rows so assertions can inspect them.
  const writtenCriterionResults: Array<{ data: unknown }> = []
  const writtenCitations: Array<{ data: unknown }> = []
  const writtenEvents: Array<{ data: unknown }> = []

  let criterionResultAutoId = 0

  const mockPrisma = {
    priorAuth: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(pa),
    },
    policy: {
      findMany: vi.fn().mockResolvedValue([policyModel]),
    },
    criterionResult: {
      create: vi.fn().mockImplementation((args: { data: unknown }) => {
        writtenCriterionResults.push(args)
        const id = `cr-${++criterionResultAutoId}`
        return Promise.resolve({ id, ...(args.data as object) })
      }),
    },
    citation: {
      create: vi.fn().mockImplementation((args: { data: unknown }) => {
        writtenCitations.push(args)
        return Promise.resolve({ id: `cit-${writtenCitations.length}`, ...(args.data as object) })
      }),
    },
    paEvent: {
      create: vi.fn().mockImplementation((args: { data: unknown }) => {
        writtenEvents.push(args)
        return Promise.resolve({ id: `evt-${writtenEvents.length}`, ...(args.data as object) })
      }),
    },
    _written: { criterionResults: writtenCriterionResults, citations: writtenCitations, events: writtenEvents },
  }

  return mockPrisma
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runMatchEngine', () => {
  beforeEach(() => {
    // Clear recordEvent call history between tests so per-test assertions
    // reflect only the calls made in that test.
    vi.mocked(recordEvent).mockClear()
  })

  // ── Scenario 1: Head CT — all criteria should pass ────────────────────────
  describe('Scenario 1 — Head CT (encounter-head-ct)', () => {
    it('returns all_passed with 3 passing criteria', async () => {
      const { runMatchEngine } = await import('@/lib/policies/matchEngine')

      const setup: ScenarioSetup = {
        paId: 'pa-test-head-ct',
        payerId: 'payer-uhc',
        primaryCode: { codeType: 'CPT', code: '70450' },
        policyFixture: headCtPolicyFixture as PolicyFixture,
        encounterFixture: headCtEncounterFixture as EncounterFixture,
      }

      const mock = buildMockPrisma(setup)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await runMatchEngine(mock as any, setup.paId)

      expect(result.overallStatus).toBe('all_passed')
      expect(result.missingItems).toHaveLength(0)
      expect(result.criteriaResults).toHaveLength(3)

      const statuses = result.criteriaResults.map((r) => r.status)
      expect(statuses).toEqual(['passed', 'passed', 'passed'])

      // Confidence should be > 0.9 for all three head CT criteria
      for (const cr of result.criteriaResults) {
        expect(cr.confidence).toBeGreaterThan(0.9)
      }
    })

    it('persists 3 CriterionResult rows, 3 Citation rows, and 3 audit events', async () => {
      const { runMatchEngine } = await import('@/lib/policies/matchEngine')

      const setup: ScenarioSetup = {
        paId: 'pa-test-head-ct-persist',
        payerId: 'payer-uhc',
        primaryCode: { codeType: 'CPT', code: '70450' },
        policyFixture: headCtPolicyFixture as PolicyFixture,
        encounterFixture: headCtEncounterFixture as EncounterFixture,
      }

      const mock = buildMockPrisma(setup)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await runMatchEngine(mock as any, setup.paId)

      expect(mock.criterionResult.create).toHaveBeenCalledTimes(3)
      expect(mock.citation.create).toHaveBeenCalledTimes(3)

      // Audit: recordEvent called once per criterion
      expect(vi.mocked(recordEvent)).toHaveBeenCalledTimes(3)
      expect(vi.mocked(recordEvent)).toHaveBeenCalledWith(
        expect.objectContaining({
          priorAuthId: setup.paId,
          type: 'criterion_evaluated',
          actor: 'system:match_engine',
        })
      )
    })

    it('returns the correct policyId', async () => {
      const { runMatchEngine } = await import('@/lib/policies/matchEngine')

      const setup: ScenarioSetup = {
        paId: 'pa-test-head-ct-policy',
        payerId: 'payer-uhc',
        primaryCode: { codeType: 'CPT', code: '70450' },
        policyFixture: headCtPolicyFixture as PolicyFixture,
        encounterFixture: headCtEncounterFixture as EncounterFixture,
      }

      const mock = buildMockPrisma(setup)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await runMatchEngine(mock as any, setup.paId)

      expect(result.policyId).toBe('policy-uhc-evicore-head-ct')
    })
  })

  // ── Scenario 2: Knee MRI — conservative therapy criterion → needs_info ────
  describe('Scenario 2 — Knee MRI (encounter-knee-mri)', () => {
    it('returns has_needs_info overall', async () => {
      const { runMatchEngine } = await import('@/lib/policies/matchEngine')

      const setup: ScenarioSetup = {
        paId: 'pa-test-knee-mri',
        payerId: 'payer-uhc',
        primaryCode: { codeType: 'CPT', code: '73721' },
        policyFixture: kneeMriPolicyFixture as PolicyFixture,
        encounterFixture: kneeMriEncounterFixture as EncounterFixture,
      }

      const mock = buildMockPrisma(setup)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await runMatchEngine(mock as any, setup.paId)

      expect(result.overallStatus).toBe('has_needs_info')
    })

    it('marks criterion-knee-mri-1 as needs_info and others as passed', async () => {
      const { runMatchEngine } = await import('@/lib/policies/matchEngine')

      const setup: ScenarioSetup = {
        paId: 'pa-test-knee-mri-criteria',
        payerId: 'payer-uhc',
        primaryCode: { codeType: 'CPT', code: '73721' },
        policyFixture: kneeMriPolicyFixture as PolicyFixture,
        encounterFixture: kneeMriEncounterFixture as EncounterFixture,
      }

      const mock = buildMockPrisma(setup)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await runMatchEngine(mock as any, setup.paId)

      expect(result.criteriaResults).toHaveLength(3)

      const byId = Object.fromEntries(result.criteriaResults.map((r) => [r.criterionId, r]))
      expect(byId['criterion-knee-mri-1'].status).toBe('needs_info')
      expect(byId['criterion-knee-mri-2'].status).toBe('passed')
      expect(byId['criterion-knee-mri-3'].status).toBe('passed')
    })

    it('includes the conservative therapy criterion in missingItems', async () => {
      const { runMatchEngine } = await import('@/lib/policies/matchEngine')

      const setup: ScenarioSetup = {
        paId: 'pa-test-knee-mri-missing',
        payerId: 'payer-uhc',
        primaryCode: { codeType: 'CPT', code: '73721' },
        policyFixture: kneeMriPolicyFixture as PolicyFixture,
        encounterFixture: kneeMriEncounterFixture as EncounterFixture,
      }

      const mock = buildMockPrisma(setup)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await runMatchEngine(mock as any, setup.paId)

      expect(result.missingItems).toHaveLength(1)
      // The criterion text contains "conservative therapy"
      expect(result.missingItems[0]).toContain('conservative therapy')
    })

    it('persists 3 CriterionResult rows, 3 Citation rows, and 3 audit events', async () => {
      const { runMatchEngine } = await import('@/lib/policies/matchEngine')

      const setup: ScenarioSetup = {
        paId: 'pa-test-knee-mri-persist',
        payerId: 'payer-uhc',
        primaryCode: { codeType: 'CPT', code: '73721' },
        policyFixture: kneeMriPolicyFixture as PolicyFixture,
        encounterFixture: kneeMriEncounterFixture as EncounterFixture,
      }

      const mock = buildMockPrisma(setup)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await runMatchEngine(mock as any, setup.paId)

      expect(mock.criterionResult.create).toHaveBeenCalledTimes(3)
      expect(mock.citation.create).toHaveBeenCalledTimes(3)

      expect(vi.mocked(recordEvent)).toHaveBeenCalledTimes(3)
      expect(vi.mocked(recordEvent)).toHaveBeenCalledWith(
        expect.objectContaining({
          priorAuthId: setup.paId,
          type: 'criterion_evaluated',
          actor: 'system:match_engine',
        })
      )
    })
  })

  // ── Scenario 3: Botox — amitriptyline duration → needs_info ──────────────
  describe('Scenario 3 — Botox (encounter-botox)', () => {
    it('returns has_needs_info overall', async () => {
      const { runMatchEngine } = await import('@/lib/policies/matchEngine')

      const setup: ScenarioSetup = {
        paId: 'pa-test-botox',
        payerId: 'payer-uhc',
        primaryCode: { codeType: 'HCPCS', code: 'J0585' },
        policyFixture: botoxPolicyFixture as PolicyFixture,
        encounterFixture: botoxEncounterFixture as EncounterFixture,
      }

      const mock = buildMockPrisma(setup)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await runMatchEngine(mock as any, setup.paId)

      expect(result.overallStatus).toBe('has_needs_info')
    })

    it('passes diagnosis and dose criteria; flags amitriptyline duration as needs_info', async () => {
      const { runMatchEngine } = await import('@/lib/policies/matchEngine')

      const setup: ScenarioSetup = {
        paId: 'pa-test-botox-criteria',
        payerId: 'payer-uhc',
        primaryCode: { codeType: 'HCPCS', code: 'J0585' },
        policyFixture: botoxPolicyFixture as PolicyFixture,
        encounterFixture: botoxEncounterFixture as EncounterFixture,
      }

      const mock = buildMockPrisma(setup)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await runMatchEngine(mock as any, setup.paId)

      expect(result.criteriaResults).toHaveLength(3)

      const byId = Object.fromEntries(result.criteriaResults.map((r) => [r.criterionId, r]))
      // Criterion 1: chronic migraine diagnosis → passes
      expect(byId['criterion-botox-1'].status).toBe('passed')
      // Criterion 2: preventive therapy failure (amitriptyline is ambiguous) → needs_info
      expect(byId['criterion-botox-2'].status).toBe('needs_info')
      // Criterion 3: dose ≤155 units → passes
      expect(byId['criterion-botox-3'].status).toBe('passed')
    })

    it('flags the preventive therapy criterion in missingItems', async () => {
      const { runMatchEngine } = await import('@/lib/policies/matchEngine')

      const setup: ScenarioSetup = {
        paId: 'pa-test-botox-missing',
        payerId: 'payer-uhc',
        primaryCode: { codeType: 'HCPCS', code: 'J0585' },
        policyFixture: botoxPolicyFixture as PolicyFixture,
        encounterFixture: botoxEncounterFixture as EncounterFixture,
      }

      const mock = buildMockPrisma(setup)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await runMatchEngine(mock as any, setup.paId)

      expect(result.missingItems).toHaveLength(1)
      // The criterion text includes "prophylactic therapy"
      expect(result.missingItems[0]).toMatch(/prophylactic therapy/i)
    })

    it('persists 3 CriterionResult rows, 3 Citation rows, and 3 audit events', async () => {
      const { runMatchEngine } = await import('@/lib/policies/matchEngine')

      const setup: ScenarioSetup = {
        paId: 'pa-test-botox-persist',
        payerId: 'payer-uhc',
        primaryCode: { codeType: 'HCPCS', code: 'J0585' },
        policyFixture: botoxPolicyFixture as PolicyFixture,
        encounterFixture: botoxEncounterFixture as EncounterFixture,
      }

      const mock = buildMockPrisma(setup)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await runMatchEngine(mock as any, setup.paId)

      expect(mock.criterionResult.create).toHaveBeenCalledTimes(3)
      expect(mock.citation.create).toHaveBeenCalledTimes(3)

      expect(vi.mocked(recordEvent)).toHaveBeenCalledTimes(3)
      expect(vi.mocked(recordEvent)).toHaveBeenCalledWith(
        expect.objectContaining({
          priorAuthId: setup.paId,
          type: 'criterion_evaluated',
          actor: 'system:match_engine',
        })
      )
    })

    it('returns the correct policyId', async () => {
      const { runMatchEngine } = await import('@/lib/policies/matchEngine')

      const setup: ScenarioSetup = {
        paId: 'pa-test-botox-policy',
        payerId: 'payer-uhc',
        primaryCode: { codeType: 'HCPCS', code: 'J0585' },
        policyFixture: botoxPolicyFixture as PolicyFixture,
        encounterFixture: botoxEncounterFixture as EncounterFixture,
      }

      const mock = buildMockPrisma(setup)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await runMatchEngine(mock as any, setup.paId)

      expect(result.policyId).toBe('policy-uhc-botox-chronic-migraine')
    })
  })

  // ── Edge cases ────────────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('throws if PA has no codes', async () => {
      const { runMatchEngine } = await import('@/lib/policies/matchEngine')

      const pa = {
        id: 'pa-no-codes',
        encounterId: 'enc-1',
        payerId: 'payer-uhc',
        status: 'draft',
        statusReason: null,
        trackingId: null,
        submittedAt: null,
        pendingSubmissionExpiresAt: null,
        payerExpiresAt: null,
        simulatorNextTransitionAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        codes: [],
        encounter: {
          id: 'enc-1',
          patientId: 'p1',
          providerId: 'prov1',
          encounterDate: new Date(),
          placeOfService: '11',
          notes: [],
        },
        attachments: [],
        payer: { id: 'payer-uhc', name: 'UHC', shortCode: 'UHC' },
      }

      const mockPrisma = {
        priorAuth: { findUniqueOrThrow: vi.fn().mockResolvedValue(pa) },
        policy: { findMany: vi.fn().mockResolvedValue([]) },
        criterionResult: { create: vi.fn() },
        citation: { create: vi.fn() },
        paEvent: { create: vi.fn() },
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect(runMatchEngine(mockPrisma as any, 'pa-no-codes')).rejects.toThrow(
        /no codes/i
      )
    })

    it('throws if no applicable policy is found', async () => {
      const { runMatchEngine } = await import('@/lib/policies/matchEngine')

      const pa = {
        id: 'pa-no-policy',
        encounterId: 'enc-2',
        payerId: 'payer-unknown',
        status: 'draft',
        statusReason: null,
        trackingId: null,
        submittedAt: null,
        pendingSubmissionExpiresAt: null,
        payerExpiresAt: null,
        simulatorNextTransitionAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        codes: [
          {
            id: 'pc-1',
            priorAuthId: 'pa-no-policy',
            codeType: 'CPT',
            code: '99999',
            modifier: null,
            description: 'unknown',
            isPrimary: true,
            derivedBy: 'manual',
            confidence: null,
          },
        ],
        encounter: {
          id: 'enc-2',
          patientId: 'p2',
          providerId: 'prov1',
          encounterDate: new Date(),
          placeOfService: '11',
          notes: [],
        },
        attachments: [],
        payer: { id: 'payer-unknown', name: 'Unknown', shortCode: 'UNK' },
      }

      const mockPrisma = {
        priorAuth: { findUniqueOrThrow: vi.fn().mockResolvedValue(pa) },
        policy: { findMany: vi.fn().mockResolvedValue([]) },
        criterionResult: { create: vi.fn() },
        citation: { create: vi.fn() },
        paEvent: { create: vi.fn() },
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect(runMatchEngine(mockPrisma as any, 'pa-no-policy')).rejects.toThrow(
        /No applicable policy/i
      )
    })
  })

  // ── Phase 6: document-triage gating (additive cost-control) ──────────────
  describe('Document-triage gating (Phase 6)', () => {
    it('skips triage and uses the legacy corpus when no notes have pdfUrl', async () => {
      // Spy on scoreRelevance: when triage is skipped, it must NOT be called.
      const docTriage = await import('@/lib/ai/documentTriage')
      const triageSpy = vi.spyOn(docTriage, 'scoreRelevance')

      try {
        const { runMatchEngine } = await import('@/lib/policies/matchEngine')

        const setup: ScenarioSetup = {
          paId: 'pa-legacy-fallback',
          payerId: 'payer-uhc',
          primaryCode: { codeType: 'CPT', code: '70450' },
          policyFixture: headCtPolicyFixture as PolicyFixture,
          encounterFixture: headCtEncounterFixture as EncounterFixture,
        }

        const mock = buildMockPrisma(setup)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await runMatchEngine(mock as any, setup.paId)

        // Phase 3 behavior intact: 3 criteria evaluated, all pass.
        expect(result.overallStatus).toBe('all_passed')
        expect(result.criteriaResults).toHaveLength(3)
        // CRITICAL: triage must not have been called.
        expect(triageSpy).not.toHaveBeenCalled()
      } finally {
        triageSpy.mockRestore()
      }
    })

    it('falls back to legacy corpus when scoreRelevance throws', async () => {
      const docTriage = await import('@/lib/ai/documentTriage')
      const triageSpy = vi
        .spyOn(docTriage, 'scoreRelevance')
        .mockRejectedValue(new Error('AI sidecar unreachable'))

      try {
        const { runMatchEngine } = await import('@/lib/policies/matchEngine')

        const setup: ScenarioSetup = {
          paId: 'pa-triage-fail-fallback',
          payerId: 'payer-uhc',
          primaryCode: { codeType: 'CPT', code: '70450' },
          policyFixture: headCtPolicyFixture as PolicyFixture,
          encounterFixture: headCtEncounterFixture as EncounterFixture,
        }

        const mock = buildMockPrisma(setup)
        const pa = await mock.priorAuth.findUniqueOrThrow()
        for (const n of pa.encounter.notes) {
          n.pdfUrl = `/cached-docs/${setup.paId}/${n.id}/${n.id}.pdf`
          n.fhirResourceId = `fhir-${n.id}`
        }
        mock.priorAuth.findUniqueOrThrow = vi.fn().mockResolvedValue(pa)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await runMatchEngine(mock as any, setup.paId)

        expect(triageSpy).toHaveBeenCalledTimes(1)
        // Legacy fallback succeeded: 3 criteria evaluated.
        expect(result.criteriaResults).toHaveLength(3)
        // A `document_triage_skipped` event must be recorded with the reason.
        expect(vi.mocked(recordEvent)).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'document_triage_skipped',
            actor: 'system:match_engine',
            metadata: expect.objectContaining({
              reason: 'triage_call_failed',
              fallbackToLegacyCorpus: true,
            }),
          })
        )
      } finally {
        triageSpy.mockRestore()
      }
    })

    it('invokes triage and narrows the corpus when notes have pdfUrl', async () => {
      // Mock scoreRelevance to return a recommendation that keeps the first
      // note for criterion 1 only.  The match engine must build a filtered
      // corpus and not pass the full corpus into extractEvidence.
      const docTriage = await import('@/lib/ai/documentTriage')

      const headCtNotes = (headCtEncounterFixture as EncounterFixture).notes
      const firstNoteId = headCtNotes[0].id
      const policyCriteria = (headCtPolicyFixture as PolicyFixture).criteria

      const triageSpy = vi
        .spyOn(docTriage, 'scoreRelevance')
        .mockResolvedValue({
          scores: policyCriteria.map((c) => ({
            criterion_id: c.id,
            document_id: firstNoteId,
            score: 0.95,
            reasoning: 'Triage mock recommends only the first note.',
            recommended_for_extraction: true,
          })),
          prompt_version: 'document_triage_v1',
          model: 'claude-haiku-4-5',
          trace_id: null,
          cached: false,
        })

      try {
        const { runMatchEngine } = await import('@/lib/policies/matchEngine')

        const setup: ScenarioSetup = {
          paId: 'pa-triage-active',
          payerId: 'payer-uhc',
          primaryCode: { codeType: 'CPT', code: '70450' },
          policyFixture: headCtPolicyFixture as PolicyFixture,
          encounterFixture: headCtEncounterFixture as EncounterFixture,
        }

        // Augment the encounter notes with pdfUrl so useTriage flips true.
        const mock = buildMockPrisma(setup)
        const pa = await mock.priorAuth.findUniqueOrThrow()
        for (const n of pa.encounter.notes) {
          n.pdfUrl = `/cached-docs/${setup.paId}/${n.id}/${n.id}.pdf`
          n.fhirResourceId = `fhir-${n.id}`
        }
        // Re-prime the mock to return the mutated PA.
        mock.priorAuth.findUniqueOrThrow = vi.fn().mockResolvedValue(pa)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await runMatchEngine(mock as any, setup.paId)

        // scoreRelevance must have been called once (single triage call for the PA).
        expect(triageSpy).toHaveBeenCalledTimes(1)
        const arg = triageSpy.mock.calls[0]?.[0]
        expect(arg?.documents.length).toBe(headCtNotes.length)
        expect(arg?.criteria.length).toBe(policyCriteria.length)

        // The PA still completes (canned-response path catches the AI call).
        expect(result.criteriaResults).toHaveLength(policyCriteria.length)

        // A document_triage_completed audit event was written.
        expect(vi.mocked(recordEvent)).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'document_triage_completed',
            actor: 'system:match_engine',
          })
        )
      } finally {
        triageSpy.mockRestore()
      }
    })
  })
})
