/**
 * S3 helpers for the attachments bucket — used by the direct-to-S3 upload flow.
 *
 *   getS3Client()        — lazy singleton, builds an AWS SDK v3 client from env.
 *   presignUploadUrl()   — mints a presigned PUT URL the browser uses to upload
 *                          directly (dodges Vercel's 4.5MB function-body cap).
 *   presignDownloadUrl() — mints a presigned GET URL for serving a stored file.
 *   buildUploadKey()     — canonical S3 key for a fresh upload.
 *
 * Env vars expected (set on Vercel + Render):
 *   AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
 *   (optional) AWS_SESSION_TOKEN for temp creds,
 *   S3_ATTACHMENTS_BUCKET.
 */

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

let _client: S3Client | null = null

export function getS3Client(): S3Client {
  if (_client) return _client
  const region = process.env.AWS_REGION
  if (!region) throw new Error('AWS_REGION is not set')

  // If explicit access keys are configured, use them; otherwise fall back to
  // the SDK's default credential chain (useful in CI or with IAM roles).
  const credentials =
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          sessionToken: process.env.AWS_SESSION_TOKEN || undefined,
        }
      : undefined

  _client = new S3Client({ region, credentials })
  return _client
}

export function getAttachmentsBucket(): string {
  const bucket = process.env.S3_ATTACHMENTS_BUCKET
  if (!bucket) throw new Error('S3_ATTACHMENTS_BUCKET is not set')
  return bucket
}

/**
 * Canonical S3 key for a fresh upload — uses the cuid-style attachmentId so
 * the layout is unique per upload AND stable across re-renders. Filename is
 * preserved (sanitized) so testers see a familiar name in S3 / CloudWatch.
 *
 *   uploads/<paId>/<attachmentId>/<sanitized-filename>
 */
export function buildUploadKey(paId: string, attachmentId: string, filename: string): string {
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200)
  return `uploads/${paId}/${attachmentId}/${safeFilename}`
}

const PRESIGN_PUT_TTL_SEC = 60 * 10 // 10 min — client should upload promptly
const PRESIGN_GET_TTL_SEC = 60 * 60 // 1 hr — viewer fetch fallback

/**
 * Mint a presigned PUT URL the client uses to upload directly to S3.
 *
 * IMPORTANT: the browser MUST send the same Content-Type header in its PUT
 * request as was passed here — it's part of the signed canonical request.
 */
export async function presignUploadUrl(args: {
  key: string
  contentType: string
}): Promise<string> {
  const client = getS3Client()
  const cmd = new PutObjectCommand({
    Bucket: getAttachmentsBucket(),
    Key: args.key,
    ContentType: args.contentType,
  })
  // Casts are a known annoyance from S3Client / presigner version drift in
  // the SDK's generic Client + Command constraints; runtime is fine.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return getSignedUrl(client as any, cmd as any, { expiresIn: PRESIGN_PUT_TTL_SEC })
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * Mint a presigned GET URL for downloading / viewing a stored file. Default
 * 1-hour TTL; pass `expiresIn` (seconds) to override.
 */
export async function presignDownloadUrl(args: {
  key: string
  expiresIn?: number
}): Promise<string> {
  const client = getS3Client()
  const cmd = new GetObjectCommand({
    Bucket: getAttachmentsBucket(),
    Key: args.key,
  })
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return getSignedUrl(client as any, cmd as any, {
    expiresIn: args.expiresIn ?? PRESIGN_GET_TTL_SEC,
  })
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
