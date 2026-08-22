import { describe, it, expect } from 'vitest'
import { seal, open, deriveKey, SealError } from '@/lib/crypto/secret-box'

const SECRET = 'a'.repeat(32)

describe('secret box', () => {
  it('round-trips a value', () => {
    expect(open(seal('hello world', SECRET), SECRET)).toBe('hello world')
  })

  it('produces a versioned four-part envelope', () => {
    const sealed = seal('hello', SECRET)
    const parts = sealed.split('.')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('v1')
  })

  it('never contains the plaintext', () => {
    expect(seal('super-secret-token', SECRET)).not.toContain('super-secret-token')
  })

  it('uses a fresh IV, so the same input seals differently', () => {
    expect(seal('hello', SECRET)).not.toBe(seal('hello', SECRET))
  })

  it('fails to open with the wrong secret', () => {
    expect(() => open(seal('hello', SECRET), 'b'.repeat(32))).toThrow(SealError)
  })

  it('rejects a tampered ciphertext', () => {
    const parts = seal('hello', SECRET).split('.')
    parts[3] = Buffer.from('tampered').toString('base64url')
    expect(() => open(parts.join('.'), SECRET)).toThrow(SealError)
  })

  it('rejects a malformed envelope', () => {
    expect(() => open('garbage', SECRET)).toThrow(SealError)
  })

  it('rejects an unknown version prefix', () => {
    const parts = seal('hello', SECRET).split('.')
    parts[0] = 'v2'
    expect(() => open(parts.join('.'), SECRET)).toThrow(SealError)
  })

  it('derives a 32-byte key deterministically', () => {
    expect(deriveKey(SECRET)).toHaveLength(32)
    expect(deriveKey(SECRET).equals(deriveKey(SECRET))).toBe(true)
  })

  it('derives different keys for different secrets', () => {
    expect(deriveKey(SECRET).equals(deriveKey('b'.repeat(32)))).toBe(false)
  })

  it('round-trips an empty string', () => {
    expect(open(seal('', SECRET), SECRET)).toBe('')
  })
})
