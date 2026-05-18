// AI service boundary — Next.js side.
// Only this directory knows the AI_SERVICE_URL; all callers import typed wrappers.
export { aiFetch, aiHealth, AiUnreachableError, AiInvalidResponseError } from './penguinClient'
export { deriveCodesFromNotes } from './codeDerivation'
export type { DeriveCodesRequest, DeriveCodesResponse, ProcedureCode, DiagnosisCode, Note } from './codeDerivation'
export { triggerIngestForPa, DocumentIntakeError } from './documentIntake'
export type { DocRefRef, IngestedDocumentRow, IngestDocumentsResponse } from './documentIntake'
export {
  scoreRelevance,
  groupRecommendedByCriterion,
  buildSnippet,
  DocumentTriageError,
  TRIAGE_SNIPPET_MAX_CHARS,
} from './documentTriage'
export type {
  TriageRequest,
  TriageResponse,
  RelevanceScore,
  TriageCriterionMeta,
  TriageDocMeta,
} from './documentTriage'
