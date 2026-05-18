/**
 * __tests__/lib/smart/_testEnv.ts
 *
 * Shared test helpers for the SMART module — encryption-key setup,
 * deterministic fixtures, fake fetch builders.
 */

import { _resetEncryptionKeyCache } from '@/lib/smart/crypto'
import { _resetSessionCookieKeyCache } from '@/lib/smart/sessionCookie'

/**
 * Set a deterministic 32-byte base64 key for the duration of a test.
 * Returns a teardown function.
 */
export function withEncryptionKey(): () => void {
  // 32 bytes of zeros in base64. Suitable for a test fixture; never use a
  // zero key in production. This is regenerated per call so test isolation
  // is preserved even if the global env state leaked.
  const original = process.env.APP_TOKEN_ENCRYPTION_KEY
  process.env.APP_TOKEN_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32)).toString('base64')
  _resetEncryptionKeyCache()
  _resetSessionCookieKeyCache()
  return () => {
    if (original === undefined) {
      delete process.env.APP_TOKEN_ENCRYPTION_KEY
    } else {
      process.env.APP_TOKEN_ENCRYPTION_KEY = original
    }
    _resetEncryptionKeyCache()
    _resetSessionCookieKeyCache()
  }
}

/**
 * Builds a JSON-returning Response for `vi.stubGlobal('fetch')` style mocks.
 */
export function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Builds an error Response (4xx/5xx) for failure-path tests.
 */
export function errorResponse(status: number, body: unknown = { error: 'invalid_grant' }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
