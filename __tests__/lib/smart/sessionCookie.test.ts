/**
 * __tests__/lib/smart/sessionCookie.test.ts
 *
 * HMAC-signed session cookie. The cookie carries only the opaque session
 * lookup key + exp — never tokens.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  signSessionCookie,
  verifySessionCookie,
} from '@/lib/smart/sessionCookie'
import { withEncryptionKey } from './_testEnv'

describe('signSessionCookie + verifySessionCookie', () => {
  let teardown: () => void
  beforeEach(() => {
    teardown = withEncryptionKey()
  })
  afterEach(() => {
    teardown()
  })

  it('sign + verify round-trips sessionToken and exp', async () => {
    const expiresAtMs = Date.now() + 3600_000
    const cookie = await signSessionCookie({
      sessionToken: 'session-token-abc123',
      expiresAtMs,
    })
    const result = await verifySessionCookie(cookie)
    expect(result).not.toBeNull()
    expect(result!.sessionToken).toBe('session-token-abc123')
    // exp is in epoch seconds
    expect(result!.exp).toBe(Math.floor(expiresAtMs / 1000))
  })

  it('returns null on missing cookie', async () => {
    const result = await verifySessionCookie(undefined)
    expect(result).toBeNull()
  })

  it('returns null on garbage', async () => {
    const result = await verifySessionCookie('not.a.jwt')
    expect(result).toBeNull()
  })

  it('returns null on tampered cookie', async () => {
    const cookie = await signSessionCookie({
      sessionToken: 'x',
      expiresAtMs: Date.now() + 60_000,
    })
    // flip a char in the payload section
    const parts = cookie.split('.')
    const corrupted = parts[1].slice(0, -1) + (parts[1].slice(-1) === 'A' ? 'B' : 'A')
    const tampered = [parts[0], corrupted, parts[2]].join('.')
    const result = await verifySessionCookie(tampered)
    expect(result).toBeNull()
  })

  it('returns null on expired cookie', async () => {
    const cookie = await signSessionCookie({
      sessionToken: 'x',
      expiresAtMs: Date.now() - 60_000, // already expired
    })
    const result = await verifySessionCookie(cookie)
    expect(result).toBeNull()
  })
})
