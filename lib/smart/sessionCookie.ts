/**
 * lib/smart/sessionCookie.ts
 *
 * HMAC-signed session cookie. The cookie carries only `{sessionToken, exp}` —
 * never the access token, never the refresh token. The actual session row
 * (with encrypted tokens) lives in the SmartSession table; the cookie is the
 * lookup key.
 *
 * `jose` is used because middleware runs in Edge runtime and cannot import
 * `node:crypto`. `jose` works in both Node and Edge.
 *
 * The HMAC secret is derived from APP_TOKEN_ENCRYPTION_KEY with domain
 * separation, so we don't need a second env var. The derivation uses a
 * SubtleCrypto SHA-256 over a fixed domain tag + the encryption key bytes;
 * SubtleCrypto is the only crypto API available in Edge.
 */

import { jwtVerify, SignJWT } from 'jose'

export const SESSION_COOKIE_NAME = 'smart_session'

const DOMAIN_TAG = 'smart-session-hmac-v1'
const JWT_ALG = 'HS256'

let _cachedHmacKey: Uint8Array | undefined

/**
 * Derive the HMAC key from APP_TOKEN_ENCRYPTION_KEY via SubtleCrypto.
 * Edge-compatible. The derivation is `SHA-256( "smart-session-hmac-v1" || keyBytes )`
 * so cookie HMAC and token AES use cryptographically separated keys even though
 * they share the same root env var.
 */
async function getHmacKey(): Promise<Uint8Array> {
  if (_cachedHmacKey) return _cachedHmacKey

  const raw = process.env.APP_TOKEN_ENCRYPTION_KEY
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      'APP_TOKEN_ENCRYPTION_KEY env var is not set. Cannot sign/verify SMART session cookies. ' +
        'Set this in .env.local (see .env.example).',
    )
  }

  // base64 decode in an Edge-safe way. atob is available on global in both
  // Node 20+ and Edge.
  const binary = atob(raw)
  const keyBytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) keyBytes[i] = binary.charCodeAt(i)

  const encoder = new TextEncoder()
  const tagBytes = encoder.encode(DOMAIN_TAG)
  const input = new Uint8Array(tagBytes.length + keyBytes.length)
  input.set(tagBytes, 0)
  input.set(keyBytes, tagBytes.length)

  const digest = await crypto.subtle.digest('SHA-256', input)
  _cachedHmacKey = new Uint8Array(digest)
  return _cachedHmacKey
}

/** Test-only: clear the derived HMAC key cache. */
export function _resetSessionCookieKeyCache(): void {
  _cachedHmacKey = undefined
}

export interface SessionCookiePayload {
  sessionToken: string
  exp: number // epoch seconds (jose convention)
}

/**
 * Sign a session cookie JWT. exp is set to the session's
 * expires-at (epoch seconds, matching jose).
 */
export async function signSessionCookie(args: {
  sessionToken: string
  expiresAtMs: number
}): Promise<string> {
  const key = await getHmacKey()
  const expSeconds = Math.floor(args.expiresAtMs / 1000)
  return new SignJWT({ st: args.sessionToken })
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime(expSeconds)
    .sign(key)
}

/**
 * Verify a session cookie. Returns null on missing, tampered, or expired
 * cookie. Never throws — callers branch on null.
 */
export async function verifySessionCookie(
  cookieValue: string | undefined,
): Promise<SessionCookiePayload | null> {
  if (!cookieValue) return null
  try {
    const key = await getHmacKey()
    const { payload } = await jwtVerify(cookieValue, key, { algorithms: [JWT_ALG] })
    if (typeof payload.st !== 'string' || typeof payload.exp !== 'number') return null
    return { sessionToken: payload.st, exp: payload.exp }
  } catch {
    return null
  }
}
