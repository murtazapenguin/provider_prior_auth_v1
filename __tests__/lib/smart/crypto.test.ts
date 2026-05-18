/**
 * __tests__/lib/smart/crypto.test.ts
 *
 * AES-256-GCM encryption round-trips, tamper detection, env-var enforcement.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { decrypt, encrypt, _resetEncryptionKeyCache } from '@/lib/smart/crypto'
import { withEncryptionKey } from './_testEnv'

describe('AES-256-GCM encrypt/decrypt', () => {
  let teardown: () => void
  beforeEach(() => {
    teardown = withEncryptionKey()
  })
  afterEach(() => {
    teardown()
  })

  it('round-trips plaintext', () => {
    const plaintext = 'epic-fake-access-token-camila-lopez'
    const blob = encrypt(plaintext)
    expect(decrypt(blob)).toBe(plaintext)
  })

  it('encrypt twice with same plaintext yields different ciphertext (random IV)', () => {
    const plaintext = 'hello world'
    const a = encrypt(plaintext)
    const b = encrypt(plaintext)
    expect(a).not.toBe(b)
    expect(decrypt(a)).toBe(plaintext)
    expect(decrypt(b)).toBe(plaintext)
  })

  it('decrypt throws on tampered ciphertext', () => {
    const blob = encrypt('sensitive')
    // flip one bit in the middle of the b64 payload
    const buf = Buffer.from(blob, 'base64')
    buf[20] ^= 0xff
    const tampered = buf.toString('base64')
    expect(() => decrypt(tampered)).toThrow()
  })

  it('decrypt throws when blob too short to contain iv + tag', () => {
    expect(() => decrypt('AAAA')).toThrow()
  })
})

describe('requireEncryptionKey env guards', () => {
  it('throws a clear error when APP_TOKEN_ENCRYPTION_KEY is unset', () => {
    const original = process.env.APP_TOKEN_ENCRYPTION_KEY
    delete process.env.APP_TOKEN_ENCRYPTION_KEY
    _resetEncryptionKeyCache()
    try {
      expect(() => encrypt('x')).toThrow(/APP_TOKEN_ENCRYPTION_KEY/)
    } finally {
      if (original !== undefined) process.env.APP_TOKEN_ENCRYPTION_KEY = original
      _resetEncryptionKeyCache()
    }
  })

  it('throws when APP_TOKEN_ENCRYPTION_KEY does not decode to 32 bytes', () => {
    const original = process.env.APP_TOKEN_ENCRYPTION_KEY
    process.env.APP_TOKEN_ENCRYPTION_KEY = Buffer.from('too-short').toString('base64')
    _resetEncryptionKeyCache()
    try {
      expect(() => encrypt('x')).toThrow(/32 bytes/)
    } finally {
      if (original !== undefined) process.env.APP_TOKEN_ENCRYPTION_KEY = original
      else delete process.env.APP_TOKEN_ENCRYPTION_KEY
      _resetEncryptionKeyCache()
    }
  })
})
