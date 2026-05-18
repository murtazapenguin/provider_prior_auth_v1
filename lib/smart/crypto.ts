/**
 * lib/smart/crypto.ts
 *
 * AES-256-GCM helpers for SmartSession token storage.
 *
 * Key sourcing
 * ────────────
 *  APP_TOKEN_ENCRYPTION_KEY env var = base64-encoded 32-byte key.
 *  Generate with: `openssl rand -base64 32`.
 *  Lookup is lazy (per-call) so test paths that don't exercise encryption
 *  aren't forced to set the env var at import time.
 *
 * Output format
 * ─────────────
 *  base64( iv (12 bytes) || ciphertext || authTag (16 bytes) )
 *
 *  IV is random per encrypt. The same plaintext therefore yields different
 *  ciphertext across calls (verified in unit tests).
 *
 *  Not Edge-compatible — `node:crypto` is required. All call sites must
 *  live in Node-runtime API routes, never in middleware.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const KEY_LENGTH = 32

let _cachedKey: Buffer | undefined

/**
 * Returns the 32-byte encryption key from APP_TOKEN_ENCRYPTION_KEY.
 * Throws with a clear, actionable message if the env var is unset or invalid.
 *
 * Cached per-process after first successful read. Tests that need to vary the
 * key call `_resetEncryptionKeyCache()` between test cases.
 */
export function requireEncryptionKey(): Buffer {
  if (_cachedKey) return _cachedKey

  const raw = process.env.APP_TOKEN_ENCRYPTION_KEY
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      'APP_TOKEN_ENCRYPTION_KEY env var is not set. SmartSession tokens cannot be encrypted/decrypted. ' +
        'Set this in .env.local (see .env.example) before running SMART launch flows. ' +
        'Generate a key with: `openssl rand -base64 32`.',
    )
  }

  let decoded: Buffer
  try {
    decoded = Buffer.from(raw, 'base64')
  } catch {
    throw new Error('APP_TOKEN_ENCRYPTION_KEY must be base64-encoded.')
  }

  if (decoded.length !== KEY_LENGTH) {
    throw new Error(
      `APP_TOKEN_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes for AES-256-GCM (got ${decoded.length}). ` +
        'Regenerate with: `openssl rand -base64 32`.',
    )
  }

  _cachedKey = decoded
  return _cachedKey
}

/** Test-only helper: clear the cached key so a new env value takes effect. */
export function _resetEncryptionKeyCache(): void {
  _cachedKey = undefined
}

/**
 * Encrypts UTF-8 plaintext, returns a base64 string suitable for DB storage.
 */
export function encrypt(plaintext: string): string {
  const key = requireEncryptionKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, ciphertext, authTag]).toString('base64')
}

/**
 * Decrypts a base64 blob produced by `encrypt`. Throws on tamper / wrong key.
 */
export function decrypt(blob: string): string {
  const key = requireEncryptionKey()
  const buf = Buffer.from(blob, 'base64')
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error('Ciphertext blob too short to be valid AES-256-GCM output.')
  }
  const iv = buf.subarray(0, IV_LENGTH)
  const authTag = buf.subarray(buf.length - AUTH_TAG_LENGTH)
  const ciphertext = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

/**
 * Encrypts a nullable string — returns null when input is null/undefined.
 * Saves callers from having to branch.
 */
export function encryptNullable(value: string | null | undefined): string | null {
  if (value == null) return null
  return encrypt(value)
}

/**
 * Decrypts a nullable string — returns null when input is null/undefined.
 */
export function decryptNullable(value: string | null | undefined): string | null {
  if (value == null) return null
  return decrypt(value)
}
