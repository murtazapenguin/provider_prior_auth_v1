/**
 * lib/smart/pkce.ts
 *
 * PKCE (RFC 7636) helpers for SMART on FHIR. Public clients only — no
 * client_secret ever enters the wire.
 *
 *  verifier  = 64 cryptographically-random bytes, base64url-encoded → 86 chars
 *              (spec range is 43-128; we sit comfortably in the middle).
 *  challenge = base64url-no-pad( SHA256(verifier) ) — 43 chars.
 */

import { createHash, randomBytes } from 'node:crypto'

/** Encodes a Buffer to URL-safe base64 with no padding (RFC 7636 §4.2). */
function base64UrlNoPad(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export interface PkcePair {
  verifier: string
  challenge: string
  challengeMethod: 'S256'
}

export function generatePkcePair(): PkcePair {
  const verifier = base64UrlNoPad(randomBytes(64))
  const challenge = base64UrlNoPad(createHash('sha256').update(verifier).digest())
  return { verifier, challenge, challengeMethod: 'S256' }
}
