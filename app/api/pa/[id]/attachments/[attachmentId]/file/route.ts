import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { getProviderId } from '@/lib/api/auth'
import { getStorage } from '@/lib/storage'

// Resolve effective Content-Type: trust the stored mimeType only when it's
// specific. Some older uploads were stored as text/plain even though the file
// is binary — fall back to the filename extension in that case.
function effectiveMime(filename: string, storedMime: string): string {
  if (storedMime && storedMime !== 'application/octet-stream' && storedMime !== 'text/plain') {
    return storedMime
  }
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.txt')) return 'text/plain; charset=utf-8'
  return storedMime || 'application/octet-stream'
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { id: paId, attachmentId } = await params
  const providerId = getProviderId(request)

  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    include: { priorAuth: { select: { providerId: true } } },
  })

  if (!attachment || attachment.priorAuthId !== paId) {
    return NextResponse.json({ detail: 'Attachment not found' }, { status: 404 })
  }
  if (attachment.priorAuth.providerId !== providerId) {
    return NextResponse.json({ detail: 'Forbidden' }, { status: 403 })
  }

  let bytes: Buffer
  try {
    bytes = await getStorage().get(attachment.storageUrl)
  } catch {
    return NextResponse.json({ detail: 'File not available in storage' }, { status: 410 })
  }

  // Convert to ArrayBuffer — Node's Buffer extends Uint8Array but the lib.dom
  // BodyInit type doesn't accept it directly. Slice ensures we hand back a
  // standalone ArrayBuffer (not the underlying SlowBuffer pool). The cast is
  // safe: Node's Buffer never sits on a SharedArrayBuffer in practice.
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
  return new NextResponse(body, {
    headers: {
      'Content-Type': effectiveMime(attachment.filename, attachment.mimeType),
      'Content-Disposition': `inline; filename="${encodeURIComponent(attachment.filename)}"`,
      'Cache-Control': 'private, max-age=300',
    },
  })
}
