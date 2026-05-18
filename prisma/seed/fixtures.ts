import { PrismaClient } from '../../app/generated/prisma/client'
import * as path from 'path'
import * as fs from 'fs'

// ─── Types matching the JSON fixtures ─────────────────────────────────────────

interface PatientFixture {
  id: string
  externalId: string
  firstName: string
  lastName: string
  dob: string
  sex: string
}

interface CoverageFixture {
  id: string
  patientId: string
  payerId: string
  planName: string
  memberId: string
  groupNumber: string | null
  benefitCategory: string
  effectiveFrom: string
  effectiveTo: string | null
  isPrimary: boolean
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

// ─── Static definitions: providers and payers ─────────────────────────────────
// These are seeded here (not from JSON files) because they are referenced by
// deterministic IDs in the encounter fixtures and policy seed.

const PROVIDERS = [
  {
    id: 'provider-pcp-sarah-chen',
    npi: '1234567890',
    firstName: 'Sarah',
    lastName: 'Chen',
    specialty: 'Internal Medicine',
  },
  {
    id: 'provider-ortho-james-patel',
    npi: '0987654321',
    firstName: 'James',
    lastName: 'Patel',
    specialty: 'Orthopedic Surgery',
  },
  {
    id: 'provider-neuro-aisha-washington',
    npi: '1122334455',
    firstName: 'Aisha',
    lastName: 'Washington',
    specialty: 'Neurology',
  },
  {
    id: 'provider-pmr-robert-klein',
    npi: '3456789012',
    firstName: 'Robert',
    lastName: 'Klein',
    specialty: 'Physical Medicine & Rehabilitation',
  },
]

// Both payers are seeded here. All three demo patients are on UHC Choice Plus
// per DEMO_SCENARIOS.md "Payer note". "payer-cms" is still created because
// the Phase 1 CMS ingester references it, but no demo Coverage points at it.
const PAYERS = [
  {
    id: 'payer-uhc',
    name: 'United Healthcare',
    shortCode: 'UHC',
  },
  {
    id: 'payer-cms',
    name: 'Medicare (CMS)',
    shortCode: 'CMS',
  },
]

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

export async function loadDemoFixtures(
  prisma: PrismaClient
): Promise<{ patients: number; encounters: number; notes: number }> {
  // ── 1. Payers ──────────────────────────────────────────────────────────────
  for (const payer of PAYERS) {
    await prisma.payer.upsert({
      where: { id: payer.id },
      update: {},
      create: payer,
    })
  }

  // ── 2. Providers ───────────────────────────────────────────────────────────
  for (const provider of PROVIDERS) {
    await prisma.provider.upsert({
      where: { id: provider.id },
      update: {},
      create: provider,
    })
  }

  // ── 3. Patients ────────────────────────────────────────────────────────────
  const patientFixtures = readJson<PatientFixture[]>('patients.json')
  for (const p of patientFixtures) {
    await prisma.patient.upsert({
      where: { id: p.id },
      update: {},
      create: {
        id: p.id,
        externalId: p.externalId,
        firstName: p.firstName,
        lastName: p.lastName,
        dob: new Date(p.dob),
        sex: p.sex,
      },
    })
  }

  // ── 4. Coverages ───────────────────────────────────────────────────────────
  const coverageFixtures = readJson<CoverageFixture[]>('coverages.json')
  for (const c of coverageFixtures) {
    await prisma.coverage.upsert({
      where: { id: c.id },
      update: {},
      create: {
        id: c.id,
        patientId: c.patientId,
        payerId: c.payerId,
        planName: c.planName,
        memberId: c.memberId,
        groupNumber: c.groupNumber ?? null,
        benefitCategory: c.benefitCategory,
        effectiveFrom: new Date(c.effectiveFrom),
        effectiveTo: c.effectiveTo ? new Date(c.effectiveTo) : null,
        isPrimary: c.isPrimary,
      },
    })
  }

  // ── 5. Encounters + Notes ──────────────────────────────────────────────────
  const encounterFiles = ['head_ct.json', 'knee_mri.json', 'botox.json', 'power_wheelchair.json']
  let totalEncounters = 0
  let totalNotes = 0

  for (const filename of encounterFiles) {
    const enc = readJson<EncounterFixture>(`encounters/${filename}`)

    await prisma.encounter.upsert({
      where: { id: enc.encounterId },
      update: {},
      create: {
        id: enc.encounterId,
        patientId: enc.patientId,
        providerId: enc.providerId,
        encounterDate: new Date(enc.encounterDate),
        placeOfService: enc.placeOfService,
      },
    })
    totalEncounters++

    for (const note of enc.notes) {
      await prisma.cachedDocumentReference.upsert({
        where: { id: note.id },
        update: {},
        create: {
          id: note.id,
          encounterId: enc.encounterId,
          noteType: note.noteType,
          authoredAt: new Date(note.authoredAt),
          authorRole: note.authorRole,
          source: note.source,
          // source values used:
          //   "EHR"    — notes pulled from the EHR system (H&P, consult notes, PCP progress notes)
          //   "scribe" — patient-submitted scribe/diary content (Botox headache diary per DEMO_SCENARIOS.md)
          // "upload" is reserved for provider-uploaded files added mid-flow (e.g. PT discharge in scenario 2)
          text: note.text,
        },
      })
      totalNotes++
    }
  }

  // ── 6a. Demo PA for Eleanor's power wheelchair — pre-tied to her seeded
  // encounter so all 4 clinical notes are already linked. The provider is the
  // PM&R who did the F2F evaluation, not the demo PCP. Status = draft so the
  // PA shows in the Action Needed queue and the user can run the evidence
  // check directly without going through the wizard (which would create a
  // fresh empty encounter).
  // Note: PA owner = demo PCP (so it shows in the demo session's queue).
  // The encounter itself + F2F evaluation are still attributed to PM&R Klein
  // in the underlying ClinicalNote rows — that's realistic (PCP initiates the
  // PA on behalf of a specialist's order).
  await prisma.priorAuth.upsert({
    where: { id: 'pa-demo-pwc-eleanor' },
    update: {},
    create: {
      id: 'pa-demo-pwc-eleanor',
      encounterId: 'encounter-power-wheelchair',
      providerId: 'provider-pcp-sarah-chen',
      payerId: 'payer-uhc',
      status: 'draft',
      priority: 'standard',
    },
  })
  await prisma.priorAuthCode.upsert({
    where: { id: 'pacode-demo-pwc-k0856' },
    update: {},
    create: {
      id: 'pacode-demo-pwc-k0856',
      priorAuthId: 'pa-demo-pwc-eleanor',
      codeType: 'HCPCS',
      code: 'K0856',
      description: 'Power wheelchair, Group 3, single power option, captain\'s chair',
      isPrimary: true,
      derivedBy: 'provider',
    },
  })
  await prisma.priorAuthCode.upsert({
    where: { id: 'pacode-demo-pwc-k0108' },
    update: {},
    create: {
      id: 'pacode-demo-pwc-k0108',
      priorAuthId: 'pa-demo-pwc-eleanor',
      codeType: 'HCPCS',
      code: 'K0108',
      description: 'Wheelchair component or accessory, not otherwise specified (power tilt option)',
      isPrimary: false,
      derivedBy: 'provider',
    },
  })

  // ── 6b. Demo PA in RFI status ──────────────────────────────────────────────
  // The simulator/payer flows would normally produce RFI states organically,
  // but for demo reliability we pre-seed one PriorAuth in 'rfi' so it shows
  // up in the Action Needed tab right after seeding.
  await prisma.priorAuth.upsert({
    where: { id: 'pa-demo-rfi-knee-mri' },
    update: {},
    create: {
      id: 'pa-demo-rfi-knee-mri',
      encounterId: 'encounter-knee-mri',
      // Demo PCP owns this PA so it surfaces in the demo session's Action Needed tab.
      providerId: 'provider-pcp-sarah-chen',
      payerId: 'payer-uhc',
      status: 'rfi',
      statusReason: 'Payer requested supporting PT records and updated NSAID trial documentation',
      trackingId: 'UHC-DEMO-RFI-77821',
      submittedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000), // 4 days ago
      priority: 'standard',
    },
  })
  await prisma.priorAuthCode.upsert({
    where: { id: 'pacode-demo-rfi-knee-mri' },
    update: {},
    create: {
      id: 'pacode-demo-rfi-knee-mri',
      priorAuthId: 'pa-demo-rfi-knee-mri',
      codeType: 'CPT',
      code: '73721',
      description: 'MRI any joint of lower extremity; without contrast',
      isPrimary: true,
      derivedBy: 'provider',
    },
  })
  await prisma.paEvent.create({
    data: {
      priorAuthId: 'pa-demo-rfi-knee-mri',
      type: 'status_change',
      fromStatus: 'in_progress',
      toStatus: 'rfi',
      actor: 'simulator',
      metadata: {
        reason: 'Payer requested supporting PT records and updated NSAID trial documentation',
        rfiQuestions: [
          'Please provide formal physical therapy discharge summary documenting failed trial.',
          'Please document trial of at least one additional NSAID with duration and outcome.',
        ],
      },
    },
  })

  return {
    patients: patientFixtures.length,
    encounters: totalEncounters,
    notes: totalNotes,
  }
}
