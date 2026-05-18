/**
 * __tests__/lib/smart/pkce.test.ts
 *
 * PKCE generation must comply with RFC 7636.
 */

import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { generatePkcePair } from '@/lib/smart/pkce'

function base64UrlNoPad(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('generatePkcePair', () => {
  it('produces a verifier 43-128 characters long, url-safe', () => {
    const { verifier } = generatePkcePair()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('challenge is base64url-no-pad SHA-256 of verifier', () => {
    const { verifier, challenge } = generatePkcePair()
    const expected = base64UrlNoPad(createHash('sha256').update(verifier).digest())
    expect(challenge).toBe(expected)
    expect(challenge.endsWith('=')).toBe(false)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('challengeMethod is S256', () => {
    const { challengeMethod } = generatePkcePair()
    expect(challengeMethod).toBe('S256')
  })

  it('generates a distinct verifier on each call (randomness)', () => {
    const a = generatePkcePair()
    const b = generatePkcePair()
    expect(a.verifier).not.toBe(b.verifier)
    expect(a.challenge).not.toBe(b.challenge)
  })
})
