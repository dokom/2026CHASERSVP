import { describe, it, expect } from 'vitest'
import { seal, open, deriveKey, SealError } from '@/lib/crypto/secret-box'

const SECRET = 'a'.repeat(32)

/** Decodes a base64url part, flips a single bit of its first byte, and
 *  re-encodes it — used to prove tamper-detection actually inspects bytes
 *  rather than just requiring *a* value to be present. */
function flipOneBit(base64url: string): string {
  const buf = Buffer.from(base64url, 'base64url')
  buf[0] = buf[0]! ^ 1
  return buf.toString('base64url')
}

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

  it('never contains the plaintext, not even re-encoded', () => {
    const plaintext = 'super-secret-token'
    const sealed = seal(plaintext, SECRET)
    expect(sealed).not.toContain(plaintext)
    // A cipher that merely re-encoded the plaintext instead of encrypting it
    // would still pass a plain .not.toContain(plaintext) check once the
    // separator characters changed; check the base64url re-encoding too.
    expect(sealed).not.toContain(Buffer.from(plaintext, 'utf8').toString('base64url'))
  })

  it('uses a fresh IV, so the same input seals differently', () => {
    expect(seal('hello', SECRET)).not.toBe(seal('hello', SECRET))
  })

  it('fails to open with the wrong secret', () => {
    expect(() => open(seal('hello', SECRET), 'b'.repeat(32))).toThrow(SealError)
  })

  it('rejects a ciphertext with a single flipped bit', () => {
    const parts = seal('hello', SECRET).split('.')
    parts[3] = flipOneBit(parts[3]!)
    expect(() => open(parts.join('.'), SECRET)).toThrow(SealError)
  })

  it('rejects an IV with a single flipped bit', () => {
    const parts = seal('hello', SECRET).split('.')
    parts[1] = flipOneBit(parts[1]!)
    expect(() => open(parts.join('.'), SECRET)).toThrow(SealError)
  })

  it('rejects an auth tag with a single flipped bit', () => {
    const parts = seal('hello', SECRET).split('.')
    parts[2] = flipOneBit(parts[2]!)
    expect(() => open(parts.join('.'), SECRET)).toThrow(SealError)
  })

  it('rejects a truncated 4-byte auth tag instead of accepting it', () => {
    // Node's setAuthTag() accepts 4/8/12-16 byte GCM tags by default. A
    // 4-byte tag reduces forgery to ~2^32 work and must be rejected outright
    // before decryption is attempted.
    const parts = seal('hello', SECRET).split('.')
    const fullTag = Buffer.from(parts[2]!, 'base64url')
    parts[2] = fullTag.subarray(0, 4).toString('base64url')
    expect(() => open(parts.join('.'), SECRET)).toThrow(SealError)
  })

  it('rejects a wrong-length IV', () => {
    const parts = seal('hello', SECRET).split('.')
    const fullIv = Buffer.from(parts[1]!, 'base64url')
    parts[1] = fullIv.subarray(0, 8).toString('base64url')
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
