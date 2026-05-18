/**
 * lib/fhir/index.ts
 *
 * Adapter-mode switch. The named exports below resolve at module-load to
 * either the real Epic-FHIR adapters (default) or the mock fixture-backed
 * adapter (`./mock`), controlled by `FHIR_MODE`.
 *
 *   FHIR_MODE=mock   → mock adapter, reads from prisma/fixtures/fhir/*.json
 *   FHIR_MODE=real (or unset) → real adapter, hits the Epic sandbox
 *
 *  ┌────────────────────────────────────────────────────────────────────┐
 *  │  Every consumer (domain syncers, route handlers, server actions)   │
 *  │  should import from `@/lib/fhir` rather than the individual        │
 *  │  resource modules. The existing per-module tests already import    │
 *  │  from `@/lib/fhir/patient` etc. directly — that's fine, they're    │
 *  │  exercising the real client behavior in isolation.                 │
 *  └────────────────────────────────────────────────────────────────────┘
 *
 * The branch is single-shot at module load. Tests that need a different
 * mode in the same process either:
 *   (a) inject an explicit adapter via `syncPatientFromFhir({adapter})` —
 *       preferred, no env mutation, no module reset needed.
 *   (b) `vi.resetModules()` and re-import with a different env. Heavy hammer.
 */

import * as realPatient from './patient'
import * as realEncounter from './encounter'
import * as realCoverage from './coverage'
import * as realPractitioner from './practitioner'
import * as realServiceRequest from './serviceRequest'
import * as realDocumentReference from './documentReference'
import * as realCondition from './condition'
import * as realObservation from './observation'
import * as mock from './mock'

function pickMode(): 'mock' | 'real' {
  const raw = (process.env.FHIR_MODE ?? '').toLowerCase()
  return raw === 'mock' ? 'mock' : 'real'
}

const MODE = pickMode()
const useMock = MODE === 'mock'

export const getPatient = useMock ? mock.getPatient : realPatient.getPatient
export const searchPatients = useMock ? mock.searchPatients : realPatient.searchPatients
export const getEncounter = useMock ? mock.getEncounter : realEncounter.getEncounter
export const searchEncounters = useMock ? mock.searchEncounters : realEncounter.searchEncounters
export const getCoverage = useMock ? mock.getCoverage : realCoverage.getCoverage
export const searchCoverages = useMock ? mock.searchCoverages : realCoverage.searchCoverages
export const getPractitioner = useMock ? mock.getPractitioner : realPractitioner.getPractitioner
export const getServiceRequest = useMock ? mock.getServiceRequest : realServiceRequest.getServiceRequest
export const searchServiceRequests = useMock
  ? mock.searchServiceRequests
  : realServiceRequest.searchServiceRequests
export const searchDocumentReferences = useMock
  ? mock.searchDocumentReferences
  : realDocumentReference.searchDocumentReferences
export const fetchBinary = useMock ? mock.fetchBinary : realDocumentReference.fetchBinary
export const searchConditions = useMock ? mock.searchConditions : realCondition.searchConditions
export const searchObservations = useMock
  ? mock.searchObservations
  : realObservation.searchObservations

// `parsePractitionerReference` is pure (regex) — re-export from the real
// adapter unconditionally so both modes share one implementation.
export { parsePractitionerReference } from './practitioner'

// Error types — same in both modes.
export { FhirRequestError, SmartSessionExpiredError } from './client'
export type { SmartSessionLike, FhirCallOpts, SessionLoader, SessionRefresher } from './client'

// Resource types — used by callers that need typed shapes.
export type {
  Patient,
  Encounter,
  Coverage,
  Practitioner,
  ServiceRequest,
  DocumentReference,
  Condition,
  Observation,
} from './types'

/** Observability: surface the active mode for /health endpoints + tests. */
export const FHIR_MODE = MODE
