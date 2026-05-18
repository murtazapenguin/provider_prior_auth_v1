/**
 * __tests__/lib/smart/state.test.ts
 *
 * Encrypted state cookie — nonce/csrf, TTL, tamper resistance.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  STATE_TTL_MS,
  consumeStateCookie,
  decodeStateCookie,
  encodeStateCookie,
  generateStateNonce,
} from '@/lib/smart/state'
import type { StatePayload } from '@/lib/smart/types'
import { withEncryptionKey } from './_testEnv'

function makePayload(over: Partial<StatePayload> = {}): StatePayload {
  return {
    iss: 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4',
    launch: 'epic-launch-123',
    codeVerifier: 'verifier-fixture-not-real-randomness',
    redirectAfterAuth: '/queue',
    nonce: 'nonce-fixture',
    createdAt: Date.now(),
    ...over,
  }
}

describe('state cookie', () => {
  let teardown: () => void
  beforeEach(() => {
    teardown = withEncryptionKey()
  })
  afterEach(() => {
    teardown()
  })

  it('encode/decode round-trips', () => {
    const payload = makePayload()
    const blob = encodeStateCookie(payload)
    expect(decodeStateCookie(blob)).toEqual(payload)
  })

  it('generateStateNonce returns url-safe random strings', () => {
    const a = generateStateNonce()
    const b = generateStateNonce()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(a.length).toBeGreaterThanOrEqual(32)
  })

  it('consumeStateCookie returns null on missing cookie', () => {
    const result = consumeStateCookie({ cookieValue: undefined, nonceFromCallback: 'x' })
    expect(result).toBeNull()
  })

  it('consumeStateCookie returns null on missing callback nonce', () => {
    const blob = encodeStateCookie(makePayload({ nonce: 'A' }))
    const result = consumeStateCookie({ cookieValue: blob, nonceFromCallback: undefined })
    expect(result).toBeNull()
  })

  it('consumeStateCookie returns null on nonce mismatch (CSRF defence)', () => {
    const blob = encodeStateCookie(makePayload({ nonce: 'expected' }))
    const result = consumeStateCookie({ cookieValue: blob, nonceFromCallback: 'attacker' })
    expect(result).toBeNull()
  })

  it('consumeStateCookie returns null when older than TTL', () => {
    const oldCreatedAt = Date.now() - STATE_TTL_MS - 1000
    const blob = encodeStateCookie(makePayload({ nonce: 'n', createdAt: oldCreatedAt }))
    const result = consumeStateCookie({ cookieValue: blob, nonceFromCallback: 'n' })
    expect(result).toBeNull()
  })

  it('consumeStateCookie returns null on tampered ciphertext', () => {
    const blob = encodeStateCookie(makePayload({ nonce: 'n' }))
    const buf = Buffer.from(blob, 'base64')
    buf[16] ^= 0x01
    const tampered = buf.toString('base64')
    const result = consumeStateCookie({ cookieValue: tampered, nonceFromCallback: 'n' })
    expect(result).toBeNull()
  })

  it('consumeStateCookie returns the payload on the happy path', () => {
    const payload = makePayload({ nonce: 'happy-nonce' })
    const blob = encodeStateCookie(payload)
    const result = consumeStateCookie({
      cookieValue: blob,
      nonceFromCallback: 'happy-nonce',
    })
    expect(result).toEqual(payload)
  })
})
