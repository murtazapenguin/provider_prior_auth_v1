/**
 * lib/domain/mappers/coverage.ts
 *
 * Pure mapping from a FHIR R4 Coverage resource to the Prisma `Coverage`
 * create/update args. No I/O.
 *
 * Rules:
 *   Coverage.id          = FHIR Coverage.id
 *   Coverage.patientId   = parsed from beneficiary.reference
 *   Coverage.payerId     = looked up via `resolvePayerShortCode` (caller
 *                          provides the resolved Payer.id once we know it)
 *   Coverage.planName    = class[type.coding[0].code === "plan"].name
 *                          falls back to class[0].name then "Unspecified plan"
 *   Coverage.memberId    = subscriberId || identifier[0].value
 *   Coverage.groupNumber = class[type.coding[0].code === "group"].value
 *                          or .name when value is missing; null when absent
 *   Coverage.benefitCategory = "Medical" by default (FHIR has no clean
 *                              one-to-one; type.coding[].display can override
 *                              for Pharmacy / DME with simple heuristics)
 *   Coverage.effectiveFrom = period.start (parsed)
 *   Coverage.effectiveTo   = period.end || null
 *   Coverage.isPrimary     = order === 1, else default true (Epic frequently
 *                            omits `order` for single-coverage patients)
 *
 * Payer resolution (`resolvePayerShortCode`):
 *   The caller (`syncFromFhir`) takes the returned shortCode, looks up the
 *   Payer.id in Prisma, and passes it into `mapCoverageToPrisma(..., payerId)`.
 *   We can't do the lookup inside the mapper because mappers are pure / no I/O.
 */
import type { Coverage as FhirCoverage, CoverageClass } from '@/lib/fhir/types'

export interface CoverageMapResult {
  id: string
  patientId: string
  payerId: string
  planName: string
  memberId: string
  groupNumber: string | null
  benefitCategory: string
  effectiveFrom: Date
  effectiveTo: Date | null
  isPrimary: boolean
  fhirResourceId: string
  fhirVersionId: string | null
}

/**
 * Synonym table mapping `Coverage.payor[0].display` (or beneficiary-side text)
 * to the canonical Payer.shortCode in our Prisma DB. Case-insensitive,
 * whitespace-trimmed match.
 *
 * Add entries when a new tenant emits a new payor display string.
 */
const PAYOR_DISPLAY_TO_SHORT_CODE: Record<string, string> = {
  uhc: 'UHC',
  unitedhealthcare: 'UHC',
  'united healthcare': 'UHC',
  'united health care': 'UHC',
  cms: 'CMS',
  'cms medicare': 'CMS',
  medicare: 'CMS',
  'medicare (cms)': 'CMS',
}

export function resolvePayerShortCode(payorDisplay: string | undefined): string | null {
  if (!payorDisplay) return null
  const key = payorDisplay.trim().toLowerCase()
  return PAYOR_DISPLAY_TO_SHORT_CODE[key] ?? null
}

/**
 * Find the FHIR Coverage.payor[0].display text the mapper / lookup uses to
 * resolve our Payer row. Exposed so callers can fetch the Payer themselves.
 */
export function extractPayorDisplay(fhir: FhirCoverage): string | undefined {
  return fhir.payor?.[0]?.display
}

function classByTypeCode(classes: CoverageClass[] | undefined, code: string): CoverageClass | undefined {
  return classes?.find((c) => (c.type?.coding ?? []).some((coding) => coding.code === code))
}

function extractIdFromReference(ref: string | undefined, expectedType: string): string | null {
  if (!ref) return null
  const prefix = `${expectedType}/`
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : null
}

/**
 * Heuristic for the benefitCategory column. Pharmacy and DME coverages emit
 * recognizable type.coding[].display strings on Epic; default to Medical.
 */
function pickBenefitCategory(fhir: FhirCoverage): string {
  const codings = fhir.type?.coding ?? []
  for (const c of codings) {
    const display = (c.display ?? '').toLowerCase()
    if (display.includes('pharmacy') || display.includes('rx')) return 'Pharmacy'
    if (display.includes('dme') || display.includes('durable medical')) return 'DME'
    if (display.includes('dental')) return 'Dental'
    if (display.includes('vision')) return 'Vision'
  }
  return 'Medical'
}

export function mapCoverageToPrisma(fhir: FhirCoverage, payerId: string): CoverageMapResult {
  const patientId = extractIdFromReference(fhir.beneficiary?.reference, 'Patient')
  if (!patientId) {
    throw new Error(
      `mapCoverageToPrisma: Coverage ${fhir.id} beneficiary.reference is missing or not a Patient reference`,
    )
  }

  const planClass = classByTypeCode(fhir.class, 'plan')
  const groupClass = classByTypeCode(fhir.class, 'group')

  const planName =
    planClass?.name ?? planClass?.value ?? fhir.class?.[0]?.name ?? 'Unspecified plan'

  const memberId =
    (fhir.subscriberId && fhir.subscriberId.length > 0
      ? fhir.subscriberId
      : fhir.identifier?.[0]?.value) ?? 'UNKNOWN'

  const groupNumber = groupClass?.value ?? groupClass?.name ?? null

  const periodStart = fhir.period?.start
  const effectiveFrom = periodStart ? new Date(periodStart) : new Date()
  const periodEnd = fhir.period?.end
  const effectiveTo = periodEnd ? new Date(periodEnd) : null

  // Epic emits Coverage.order as an int when there are multiple coverages.
  // We don't model order on our schema (Coverage.isPrimary is boolean); if it
  // appears in a future schema, this is where we'd consume it. For now,
  // default true and let the caller override after dedup.
  const isPrimary = true

  return {
    id: fhir.id,
    patientId,
    payerId,
    planName,
    memberId,
    groupNumber,
    benefitCategory: pickBenefitCategory(fhir),
    effectiveFrom,
    effectiveTo,
    isPrimary,
    fhirResourceId: fhir.id,
    fhirVersionId: fhir.meta?.versionId ?? null,
  }
}
