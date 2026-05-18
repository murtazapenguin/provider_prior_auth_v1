/**
 * lib/fhir/serviceRequest.ts
 *
 * Typed adapter for FHIR R4 ServiceRequest — "the order".
 * Spec: https://www.hl7.org/fhir/R4/servicerequest.html
 *
 * Procedure code lives at `code.coding[0].code` (e.g. "70450" for CT head
 * without contrast). The next ticket (phase-6-fhir-domain-mapping) consumes
 * this and maps it to a `PriorAuthCode`.
 */

import { fhirGet, fhirSearch, type FhirCallOpts } from './client'
import { ServiceRequestSchema, type ServiceRequest } from './types'

export interface SearchServiceRequestsParams {
  /** "Patient/{id}" reference. */
  patient: string
  /** "Encounter/{id}" reference. */
  encounter?: string
  status?: string
  _count?: number
}

export async function getServiceRequest(id: string, opts: FhirCallOpts = {}): Promise<ServiceRequest> {
  return fhirGet<ServiceRequest>({
    resourceType: 'ServiceRequest',
    id,
    schema: ServiceRequestSchema,
    ...opts,
  })
}

export async function searchServiceRequests(
  params: SearchServiceRequestsParams,
  opts: FhirCallOpts = {},
): Promise<ServiceRequest[]> {
  return fhirSearch<ServiceRequest>({
    resourceType: 'ServiceRequest',
    searchParams: {
      patient: params.patient,
      encounter: params.encounter,
      status: params.status,
      _count: params._count !== undefined ? String(params._count) : undefined,
    },
    entrySchema: ServiceRequestSchema,
    ...opts,
  })
}
