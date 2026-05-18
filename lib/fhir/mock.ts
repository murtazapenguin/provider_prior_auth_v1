/**
 * lib/fhir/mock.ts
 *
 * Mock FHIR adapter — exposes the same named exports as the real adapters
 * under `lib/fhir/{patient,encounter,coverage,practitioner,serviceRequest,...}`,
 * but resolves every call against fixture JSON under `prisma/fixtures/fhir/`.
 *
 *  ┌────────────────────────────────────────────────────────────────────┐
 *  │  Selected at module-load time by `lib/fhir/index.ts` when the      │
 *  │  `FHIR_MODE` env var equals `mock` (the default for `pnpm dev`).   │
 *  │                                                                    │
 *  │  Used by demo scenarios + the integration test in                  │
 *  │  `__tests__/integration/fhir-sync.test.ts`.                        │
 *  └────────────────────────────────────────────────────────────────────┘
 *
 * Fixture layout:
 *   prisma/fixtures/fhir/patient/<patientId>.json
 *   prisma/fixtures/fhir/encounter/<encounterId>.json
 *   prisma/fixtures/fhir/coverage/<patientId>.json    -> array of Coverage resources
 *   prisma/fixtures/fhir/practitioner/<practitionerId>.json
 *   prisma/fixtures/fhir/serviceRequest/<patientId>.json -> array of ServiceRequest resources
 *
 * All files are validated against the same zod schemas as the real adapter
 * before being returned to the caller — this catches fixture drift early.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import { FhirRequestError, type FhirCallOpts } from './client'
import {
  CoverageSchema,
  DocumentReferenceSchema,
  EncounterSchema,
  PatientSchema,
  PractitionerSchema,
  ServiceRequestSchema,
  type Coverage,
  type DocumentReference,
  type Encounter,
  type Patient,
  type Practitioner,
  type ServiceRequest,
} from './types'

const FIXTURE_ROOT = path.resolve(process.cwd(), 'prisma', 'fixtures', 'fhir')

function fixturePath(resourceType: string, name: string): string {
  return path.join(FIXTURE_ROOT, resourceType, `${name}.json`)
}

function readJsonOrNull(filePath: string): unknown | null {
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch (err) {
    throw new FhirRequestError({
      code: 'fhir_validation_failed',
      message: `mock fixture ${filePath} could not be parsed as JSON: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
}

function notFound(resourceType: string, id: string): never {
  throw new FhirRequestError({
    code: 'fhir_request_failed',
    message: `mock FHIR: ${resourceType}/${id} not found`,
    status: 404,
    resourceType,
  })
}

function parseRefSuffix(ref: string, expectedType: string): string | null {
  const prefix = `${expectedType}/`
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : null
}

/* ───────────────────────────────────────────────────────────────────────────
 *  Patient
 * ───────────────────────────────────────────────────────────────────────── */

export async function getPatient(id: string, _opts: FhirCallOpts = {}): Promise<Patient> {
  void _opts
  const raw = readJsonOrNull(fixturePath('patient', id))
  if (!raw) notFound('Patient', id)
  const parsed = PatientSchema.safeParse(raw)
  if (!parsed.success) {
    throw new FhirRequestError({
      code: 'fhir_validation_failed',
      message: `mock fixture patient/${id} failed schema validation`,
      details: { issues: parsed.error.issues },
      resourceType: 'Patient',
    })
  }
  return parsed.data
}

export async function searchPatients(
  params: { identifier?: string; family?: string; given?: string; birthdate?: string; _count?: number },
  _opts: FhirCallOpts = {},
): Promise<Patient[]> {
  void _opts
  // For the demo flow we don't need real search; iterate the fixture dir and
  // filter on family / given when set.
  const dir = path.join(FIXTURE_ROOT, 'patient')
  if (!fs.existsSync(dir)) return []
  const out: Patient[] = []
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    const raw = readJsonOrNull(path.join(dir, file))
    const parsed = PatientSchema.safeParse(raw)
    if (!parsed.success) continue
    const p = parsed.data
    if (params.family && !(p.name ?? []).some((n) => n.family === params.family)) continue
    if (params.given && !(p.name ?? []).some((n) => (n.given ?? []).includes(params.given!))) continue
    out.push(p)
  }
  return out
}

/* ───────────────────────────────────────────────────────────────────────────
 *  Encounter
 * ───────────────────────────────────────────────────────────────────────── */

export async function getEncounter(id: string, _opts: FhirCallOpts = {}): Promise<Encounter> {
  void _opts
  const raw = readJsonOrNull(fixturePath('encounter', id))
  if (!raw) notFound('Encounter', id)
  const parsed = EncounterSchema.safeParse(raw)
  if (!parsed.success) {
    throw new FhirRequestError({
      code: 'fhir_validation_failed',
      message: `mock fixture encounter/${id} failed schema validation`,
      details: { issues: parsed.error.issues },
      resourceType: 'Encounter',
    })
  }
  return parsed.data
}

export async function searchEncounters(
  params: { patient: string; _sort?: string; _count?: number; status?: string; date?: string },
  _opts: FhirCallOpts = {},
): Promise<Encounter[]> {
  void _opts
  const patientId = parseRefSuffix(params.patient, 'Patient')
  if (!patientId) return []
  const dir = path.join(FIXTURE_ROOT, 'encounter')
  if (!fs.existsSync(dir)) return []
  const out: Encounter[] = []
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    const raw = readJsonOrNull(path.join(dir, file))
    const parsed = EncounterSchema.safeParse(raw)
    if (!parsed.success) continue
    const enc = parsed.data
    if (parseRefSuffix(enc.subject?.reference ?? '', 'Patient') !== patientId) continue
    if (params.status && enc.status !== params.status) continue
    out.push(enc)
  }
  // _sort '-date' means newest period.start first.
  if (params._sort === '-date') {
    out.sort((a, b) => {
      const ta = a.period?.start ? Date.parse(a.period.start) : 0
      const tb = b.period?.start ? Date.parse(b.period.start) : 0
      return tb - ta
    })
  }
  if (params._count) return out.slice(0, params._count)
  return out
}

/* ───────────────────────────────────────────────────────────────────────────
 *  Coverage
 * ───────────────────────────────────────────────────────────────────────── */

export async function getCoverage(id: string, _opts: FhirCallOpts = {}): Promise<Coverage> {
  void _opts
  // For mock purposes, coverages are stored per-patient. We scan all per-
  // patient files for a matching id.
  const dir = path.join(FIXTURE_ROOT, 'coverage')
  if (!fs.existsSync(dir)) notFound('Coverage', id)
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    const raw = readJsonOrNull(path.join(dir, file))
    if (!raw) continue
    const arr = Array.isArray(raw) ? raw : [raw]
    for (const item of arr) {
      const parsed = CoverageSchema.safeParse(item)
      if (parsed.success && parsed.data.id === id) return parsed.data
    }
  }
  notFound('Coverage', id)
}

export async function searchCoverages(
  params: { patient: string; status?: string },
  _opts: FhirCallOpts = {},
): Promise<Coverage[]> {
  void _opts
  const patientId = parseRefSuffix(params.patient, 'Patient')
  if (!patientId) return []
  const filePath = fixturePath('coverage', patientId)
  const raw = readJsonOrNull(filePath)
  if (!raw) return []
  const arr = Array.isArray(raw) ? raw : [raw]
  const out: Coverage[] = []
  for (const item of arr) {
    const parsed = CoverageSchema.safeParse(item)
    if (!parsed.success) {
      throw new FhirRequestError({
        code: 'fhir_validation_failed',
        message: `mock fixture coverage/${patientId} failed schema validation`,
        details: { issues: parsed.error.issues },
        resourceType: 'Coverage',
      })
    }
    if (params.status && parsed.data.status && parsed.data.status !== params.status) continue
    out.push(parsed.data)
  }
  return out
}

/* ───────────────────────────────────────────────────────────────────────────
 *  Practitioner
 * ───────────────────────────────────────────────────────────────────────── */

export async function getPractitioner(id: string, _opts: FhirCallOpts = {}): Promise<Practitioner> {
  void _opts
  const raw = readJsonOrNull(fixturePath('practitioner', id))
  if (!raw) notFound('Practitioner', id)
  const parsed = PractitionerSchema.safeParse(raw)
  if (!parsed.success) {
    throw new FhirRequestError({
      code: 'fhir_validation_failed',
      message: `mock fixture practitioner/${id} failed schema validation`,
      details: { issues: parsed.error.issues },
      resourceType: 'Practitioner',
    })
  }
  return parsed.data
}

// Re-export the helper from the real adapter — it's pure regex, identical
// in both modes.
export { parsePractitionerReference } from './practitioner'

/* ───────────────────────────────────────────────────────────────────────────
 *  ServiceRequest
 * ───────────────────────────────────────────────────────────────────────── */

export async function getServiceRequest(id: string, _opts: FhirCallOpts = {}): Promise<ServiceRequest> {
  void _opts
  const dir = path.join(FIXTURE_ROOT, 'serviceRequest')
  if (!fs.existsSync(dir)) notFound('ServiceRequest', id)
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue
    const raw = readJsonOrNull(path.join(dir, file))
    if (!raw) continue
    const arr = Array.isArray(raw) ? raw : [raw]
    for (const item of arr) {
      const parsed = ServiceRequestSchema.safeParse(item)
      if (parsed.success && parsed.data.id === id) return parsed.data
    }
  }
  notFound('ServiceRequest', id)
}

export async function searchServiceRequests(
  params: { patient: string; encounter?: string; status?: string; _count?: number },
  _opts: FhirCallOpts = {},
): Promise<ServiceRequest[]> {
  void _opts
  const patientId = parseRefSuffix(params.patient, 'Patient')
  if (!patientId) return []
  const filePath = fixturePath('serviceRequest', patientId)
  const raw = readJsonOrNull(filePath)
  if (!raw) return []
  const arr = Array.isArray(raw) ? raw : [raw]
  const out: ServiceRequest[] = []
  const encId = params.encounter ? parseRefSuffix(params.encounter, 'Encounter') : null
  for (const item of arr) {
    const parsed = ServiceRequestSchema.safeParse(item)
    if (!parsed.success) continue
    const sr = parsed.data
    if (encId && parseRefSuffix(sr.encounter?.reference ?? '', 'Encounter') !== encId) continue
    if (params.status && sr.status !== params.status) continue
    out.push(sr)
  }
  if (params._count) return out.slice(0, params._count)
  return out
}

/* ───────────────────────────────────────────────────────────────────────────
 *  DocumentReference
 *  Mock returns an empty list until T4 wires real clinical-note fixtures.
 *  Keep the export so consumers don't break on import.
 * ───────────────────────────────────────────────────────────────────────── */

export async function searchDocumentReferences(
  params: { patient: string; encounter?: string; type?: string; date?: string; _count?: number },
  _opts: FhirCallOpts = {},
): Promise<DocumentReference[]> {
  void _opts
  const patientId = parseRefSuffix(params.patient, 'Patient')
  if (!patientId) return []
  const dir = path.join(FIXTURE_ROOT, 'documentReference')
  if (!fs.existsSync(dir)) return []
  const filePath = fixturePath('documentReference', patientId)
  const raw = readJsonOrNull(filePath)
  if (!raw) return []
  const arr = Array.isArray(raw) ? raw : [raw]
  const out: DocumentReference[] = []
  const encId = params.encounter ? parseRefSuffix(params.encounter, 'Encounter') : null
  for (const item of arr) {
    const parsed = DocumentReferenceSchema.safeParse(item)
    if (!parsed.success) continue
    const doc = parsed.data
    if (encId) {
      const docEncounterRefs = doc.context?.encounter ?? []
      if (!docEncounterRefs.some((r) => parseRefSuffix(r.reference ?? '', 'Encounter') === encId)) {
        continue
      }
    }
    out.push(doc)
  }
  if (params._count) return out.slice(0, params._count)
  return out
}

/**
 * Binary fetch — resolves URLs of the form `Binary/{binary-id}` (with or without
 * an `{iss}/` prefix) to fixture files at `prisma/fixtures/fhir/binary/{binary-id}.{ext}`.
 *
 * Phase 6 / Session 7 pre-flight: extended from a 22-byte stub to a real fixture
 * reader so T4's document-intake pipeline + T7's submission-packet PDF append
 * receive meaningful Binary content during mock-mode tests.
 *
 * Lookup strategy: parse the suffix after the last `Binary/`, then probe `.pdf`
 * then `.txt` (extension-aware fixture lookup). Unknown ids → FhirRequestError(404).
 */
export async function fetchBinary(url: string, _opts: FhirCallOpts = {}): Promise<Buffer> {
  void _opts
  const match = /Binary\/([^/?#]+)/.exec(url)
  if (!match) {
    throw new FhirRequestError({
      code: 'fhir_request_failed',
      status: 404,
      message: `Mock fetchBinary: unrecognized url shape: ${url}`,
    })
  }
  const binaryId = match[1]
  const binaryDir = path.join(FIXTURE_ROOT, 'binary')
  for (const ext of ['pdf', 'txt']) {
    const candidate = path.join(binaryDir, `${binaryId}.${ext}`)
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate)
    }
  }
  throw new FhirRequestError({
    code: 'fhir_request_failed',
    status: 404,
    message: `Mock fetchBinary: no fixture for Binary/${binaryId}`,
  })
}

/* ───────────────────────────────────────────────────────────────────────────
 *  Condition / Observation
 *  Stubs — return empty arrays until fixture data lands.
 * ───────────────────────────────────────────────────────────────────────── */

export async function searchConditions(_params: { patient: string }, _opts: FhirCallOpts = {}) {
  void _params
  void _opts
  return []
}

export async function searchObservations(_params: { patient: string }, _opts: FhirCallOpts = {}) {
  void _params
  void _opts
  return []
}
