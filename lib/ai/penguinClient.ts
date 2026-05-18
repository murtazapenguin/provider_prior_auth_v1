export class AiUnreachableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiUnreachableError'
  }
}

export class AiInvalidResponseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message)
    this.name = 'AiInvalidResponseError'
  }
}

export async function aiFetch<T>(path: string, body: unknown): Promise<T> {
  const url = process.env.AI_SERVICE_URL
  const token = process.env.AI_SERVICE_TOKEN
  if (!url) throw new AiUnreachableError('AI_SERVICE_URL is not set')

  let response: Response
  try {
    response = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token ?? ''}`,
      },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new AiUnreachableError(`AI service unreachable: ${(err as Error).message}`)
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    throw new AiInvalidResponseError(
      `AI service returned ${response.status}`,
      response.status,
      errorBody
    )
  }

  return response.json() as Promise<T>
}

export interface OcrDocumentResponse {
  full_text: string
  lines: Array<{
    content: string
    page_number: number
    line_number: number
    bounding_box: unknown
    confidence: number | null
  }>
  page_count: number
}

/**
 * Run AWS Textract OCR on a file readable by the AI sidecar.
 * `filePath` must be a path the sidecar process can open (for the local-FS
 * storage adapter, this is `getStorage().pathForOcr(key)`).
 */
export async function ocrDocument(filePath: string): Promise<OcrDocumentResponse> {
  return aiFetch<OcrDocumentResponse>('/ocr-document', { file_path: filePath })
}

export async function aiHealth(): Promise<{ ok: boolean; tracing_enabled: boolean }> {
  const url = process.env.AI_SERVICE_URL
  if (!url) return { ok: false, tracing_enabled: false }

  try {
    const response = await fetch(`${url}/readiness`, {
      headers: { Authorization: `Bearer ${process.env.AI_SERVICE_TOKEN ?? ''}` },
    })
    if (!response.ok) return { ok: false, tracing_enabled: false }
    const data = (await response.json()) as { status?: string; tracing_enabled?: boolean }
    return {
      ok: data.status === 'healthy',
      tracing_enabled: data.tracing_enabled ?? false,
    }
  } catch {
    return { ok: false, tracing_enabled: false }
  }
}
