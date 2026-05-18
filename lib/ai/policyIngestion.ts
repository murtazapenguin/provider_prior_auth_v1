import { aiFetch } from './penguinClient'
import { IngestPolicyResponseSchema } from './schemas/policyIngestion'
import type { IngestPolicyResponse } from './schemas/policyIngestion'

export async function ingestPolicy(pdfPath: string, policyId: string): Promise<IngestPolicyResponse> {
  const data = await aiFetch('/ingest-policy', { pdf_path: pdfPath, policy_id: policyId })
  return IngestPolicyResponseSchema.parse(data)
}
