'use server'

import { cookies, headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { getStorage } from '@/lib/storage'
import { ocrDocument } from '@/lib/ai/penguinClient'

const COOKIE_NAME = 'pa_provider_id'
const DEMO_PROVIDER_ID = 'provider-pcp-sarah-chen'

async function getProviderIdFromCookies(): Promise<string> {
  const store = await cookies()
  return store.get(COOKIE_NAME)?.value ?? DEMO_PROVIDER_ID
}

// Browsers sometimes report file.type as '' or 'text/plain' even for PDFs/images.
// Trust the value when it's specific; otherwise infer from the filename extension.
function resolveUploadMime(filename: string, browserType: string): string {
  if (browserType && browserType !== 'application/octet-stream' && browserType !== 'text/plain') {
    return browserType
  }
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.txt')) return 'text/plain'
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (lower.endsWith('.doc')) return 'application/msword'
  return browserType || 'application/octet-stream'
}

export interface UploadActionResult {
  ok: boolean
  error?: string
}

export async function uploadAndRecheckAction(
  paId: string,
  formData: FormData
): Promise<UploadActionResult> {
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return { ok: false, error: 'No file provided' }
  }

  // Read raw bytes — works for binary uploads (PDFs) as well as text.
  let bytes: Buffer
  try {
    const arrayBuffer = await file.arrayBuffer()
    bytes = Buffer.from(arrayBuffer)
  } catch {
    return { ok: false, error: 'Failed to read file content' }
  }

  if (bytes.length === 0) {
    return { ok: false, error: 'File appears to be empty' }
  }

  // Persist the bytes to storage first so OCR has a stable path to read.
  const storage = getStorage()
  const storageKey = await storage.put({ paId, filename: file.name, bytes })

  const resolvedMime = resolveUploadMime(file.name, file.type)
  const isPlainText = resolvedMime.startsWith('text/')

  // For plain-text uploads (.txt, text/plain) skip OCR entirely — Textract
  // doesn't accept text and we already have the bytes in memory. For binary
  // uploads (PDF/image) call the AI sidecar's /ocr-document endpoint.
  let extractedText: string
  if (isPlainText) {
    try {
      extractedText = bytes.toString('utf-8')
    } catch {
      await storage.delete(storageKey)
      return { ok: false, error: 'Failed to decode the uploaded text file as UTF-8.' }
    }
  } else {
    const filePath = await storage.pathForOcr(storageKey)
    try {
      const ocrResult = await ocrDocument(filePath)
      extractedText = ocrResult.full_text
    } catch {
      await storage.delete(storageKey)
      return {
        ok: false,
        error:
          'Failed to extract text from the uploaded document. Check that the AI service is reachable and the file is a supported format (PDF, image, or text).',
      }
    }
  }

  const providerId = await getProviderIdFromCookies()

  // Resolve our own origin from headers (works in any deploy environment).
  const headersList = await headers()
  const host = headersList.get('host') ?? 'localhost:3000'
  const protocol = headersList.get('x-forwarded-proto') ?? (host.includes('localhost') ? 'http' : 'https')
  const baseUrl = `${protocol}://${host}`
  const res = await fetch(`${baseUrl}/api/pa/${paId}/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `${COOKIE_NAME}=${providerId}`,
    },
    body: JSON.stringify({
      filename: file.name,
      mimeType: resolvedMime,
      storageKey,
      extractedText,
    }),
  })

  if (!res.ok) {
    // Don't leave the binary on disk if the DB write / recheck failed.
    await storage.delete(storageKey)
    const body = await res.json().catch(() => ({}))
    return { ok: false, error: (body as { detail?: string }).detail ?? 'Upload failed' }
  }

  revalidatePath(`/pa/${paId}`)
  return { ok: true }
}
