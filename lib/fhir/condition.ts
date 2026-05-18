/**
 * lib/fhir/condition.ts
 *
 * Typed adapter for FHIR R4 Condition.
 * Spec: https://www.hl7.org/fhir/R4/condition.html
 *
 * Note: the FHIR search parameter name uses a hyphen (`clinical-status`),
 * so the call site spells it that way; URLSearchParams preserves the hyphen
 * exactly in the query string.
 */

import { fhirSearch, type FhirCallOpts } from './client'
import { ConditionSchema, type Condition } from './types'

export interface SearchConditionsParams {
  /** "Patient/{id}" reference. */
  patient: string
  /** Token like "active", "recurrence", "inactive", "resolved". */
  'clinical-status'?: string
  /** Token like "problem-list-item", "encounter-diagnosis". */
  category?: string
}

export async function searchConditions(
  params: SearchConditionsParams,
  opts: FhirCallOpts = {},
): Promise<Condition[]> {
  return fhirSearch<Condition>({
    resourceType: 'Condition',
    searchParams: {
      patient: params.patient,
      'clinical-status': params['clinical-status'],
      category: params.category,
    },
    entrySchema: ConditionSchema,
    ...opts,
  })
}
