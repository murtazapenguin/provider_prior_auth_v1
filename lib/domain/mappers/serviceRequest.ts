/**
 * lib/domain/mappers/serviceRequest.ts
 *
 * Pure helpers for the FHIR R4 ServiceRequest resource. The next ticket
 * (PA-from-FHIR) consumes these to construct a `PriorAuthCode` row at PA
 * creation time. The current ticket only persists the ServiceRequest id on
 * the PriorAuth row for later reference (see `PriorAuth.fhirServiceRequestId`).
 *
 * We expose:
 *   - `extractProcedureCode(sr)`: picks the (CPT|HCPCS) coding from
 *     `code.coding[]` and returns `{codeType, code, description}` or null.
 *   - `extractDiagnosisCodes(sr)`: pulls ICD-10 codes from reasonCode[].
 *   - `extractPatientReference(sr)`: parses `subject.reference`.
 *   - `extractEncounterReference(sr)`: parses `encounter.reference`.
 */
import type { ServiceRequest as FhirServiceRequest } from '@/lib/fhir/types'

export type ProcedureCodeType = 'CPT' | 'HCPCS'

export interface ProcedureCodeResult {
  codeType: ProcedureCodeType
  code: string
  description: string
}

const CPT_SYSTEM = 'http://www.ama-assn.org/go/cpt'
const HCPCS_SYSTEM = 'https://www.cms.gov/medicare/coding-billing/healthcare-common-procedure-system'
const ALT_HCPCS_SYSTEM = 'http://hl7.org/fhir/sid/hcpcs'
const ICD10_SYSTEM = 'http://hl7.org/fhir/sid/icd-10-cm'

export function extractProcedureCode(sr: FhirServiceRequest): ProcedureCodeResult | null {
  const codings = sr.code?.coding ?? []
  for (const c of codings) {
    if (!c.code) continue
    if (c.system === CPT_SYSTEM) {
      return {
        codeType: 'CPT',
        code: c.code,
        description: c.display ?? sr.code?.text ?? c.code,
      }
    }
    if (c.system === HCPCS_SYSTEM || c.system === ALT_HCPCS_SYSTEM) {
      return {
        codeType: 'HCPCS',
        code: c.code,
        description: c.display ?? sr.code?.text ?? c.code,
      }
    }
  }
  // Some tenants omit `system`. Heuristic fallback: 5-digit number → CPT,
  // letter+4 digits (e.g. K0856) → HCPCS.
  for (const c of codings) {
    if (!c.code) continue
    if (/^\d{5}$/.test(c.code)) {
      return { codeType: 'CPT', code: c.code, description: c.display ?? sr.code?.text ?? c.code }
    }
    if (/^[A-Z]\d{4}$/.test(c.code)) {
      return { codeType: 'HCPCS', code: c.code, description: c.display ?? sr.code?.text ?? c.code }
    }
  }
  return null
}

export function extractDiagnosisCodes(sr: FhirServiceRequest): string[] {
  const reasons = sr.reasonCode ?? []
  const codes = new Set<string>()
  for (const r of reasons) {
    for (const c of r.coding ?? []) {
      if (c.system === ICD10_SYSTEM && c.code) codes.add(c.code)
    }
  }
  return Array.from(codes)
}

export function extractPatientReference(sr: FhirServiceRequest): string | null {
  const ref = sr.subject?.reference
  if (!ref || !ref.startsWith('Patient/')) return null
  return ref.slice('Patient/'.length)
}

export function extractEncounterReference(sr: FhirServiceRequest): string | null {
  const ref = sr.encounter?.reference
  if (!ref || !ref.startsWith('Encounter/')) return null
  return ref.slice('Encounter/'.length)
}
