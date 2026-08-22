import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from '@/lib/crypto/password'

describe('password hashing', () => {
  it('produces an argon2id hash', async () => {
    const hash = await hashPassword('correct horse battery')
    expect(hash.startsWith('$argon2id$')).toBe(true)
  })

  it('never stores the plaintext', async () => {
    const hash = await hashPassword('correct horse battery')
    expect(hash).not.toContain('correct horse battery')
  })

  it('salts — the same password hashes differently each time', async () => {
    const a = await hashPassword('correct horse battery')
    const b = await hashPassword('correct horse battery')
    expect(a).not.toBe(b)
  })

  it('verifies the correct password', async () => {
    const hash = await hashPassword('correct horse battery')
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true)
  })

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct horse battery')
    expect(await verifyPassword(hash, 'wrong horse battery')).toBe(false)
  })

  it('returns false rather than throwing on a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false)
  })

  it('rejects a password shorter than the minimum', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/at least/)
  })

  it('requires at least 12 characters', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12)
  })
})
