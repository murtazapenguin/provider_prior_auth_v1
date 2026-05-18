/**
 * lib/smart/state.ts
 *
 * Stateless server-side store for the OAuth state between /authorize and
 * /callback. We don't add a new DB table (per orchestrator override #3);
 * instead the launch context is stored as an AES-256-GCM-encrypted httpOnly
 * cookie that only the server can read.
 *
 * The `state` query parameter Epic echoes back is a random nonce. On
 * callback we decrypt the cookie and verify the nonce matches what Epic
 * returned (CSRF defence).
 *
 * 10-minute TTL on the cookie payload. Older payloads are rejected.
 */

import { randomBytes } from 'node:crypto'
import { decrypt, encrypt } from './crypto'
import type { StatePayload } from './types'

export const STATE_COOKIE_NAME = 'smart_launch_state'
export const STATE_TTL_MS = 10 * 60 * 1000

/** 32-byte url-safe random nonce. */
export function generateStateNonce(): string {
  return randomBytes(32)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function encodeStateCookie(payload: StatePayload): string {
  return encrypt(JSON.stringify(payload))
}

export function decodeStateCookie(blob: string): StatePayload | null {
  try {
    const raw = decrypt(blob)
    const parsed = JSON.parse(raw) as Partial<StatePayload>
    if (
      typeof parsed.iss !== 'string' ||
      typeof parsed.codeVerifier !== 'string' ||
      typeof parsed.nonce !== 'string' ||
      typeof parsed.createdAt !== 'number'
    ) {
      return null
    }
    return parsed as StatePayload
  } catch {
    // tampered ciphertext, wrong key, malformed JSON, anything: callers
    // treat as missing/invalid. No logging — could include sensitive bits.
    return null
  }
}

/**
 * Validates a state cookie blob against the nonce Epic returned in the
 * callback query string. Returns the decoded payload on success or null
 * if the cookie is missing, tampered, expired, or the nonce doesn't match.
 */
export function consumeStateCookie(opts: {
  cookieValue: string | undefined
  nonceFromCallback: string | undefined
  nowMs?: number
}): StatePayload | null {
  if (!opts.cookieValue || !opts.nonceFromCallback) return null
  const payload = decodeStateCookie(opts.cookieValue)
  if (!payload) return null
  if (payload.nonce !== opts.nonceFromCallback) return null
  const now = opts.nowMs ?? Date.now()
  if (now - payload.createdAt > STATE_TTL_MS) return null
  return payload
}
