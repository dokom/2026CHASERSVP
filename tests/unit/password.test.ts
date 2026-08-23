import { describe, it, expect, vi } from 'vitest'
import * as argon2 from '@node-rs/argon2'
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '@/lib/crypto/password'

vi.mock('@node-rs/argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@node-rs/argon2')>()
  return {
    ...actual,
    verify: vi.fn(actual.verify),
  }
})

describe('password hashing', () => {
  it('produces an argon2id hash', async () => {
    const hash = await hashPassword('correct horse battery')
    expect(hash.startsWith('$argon2id$')).toBe(true)
  })

  it('never stores the plaintext, word by word', async () => {
    // A plain .not.toContain('correct horse battery') is tautological here:
    // the hash is base64/argon2-charset and can never contain a literal
    // space, so that assertion would pass even if the whole password leaked
    // sans-spaces into the hash. Check the individual words instead.
    const hash = await hashPassword('correct horse battery')
    expect(hash).not.toContain('correct')
    expect(hash).not.toContain('horse')
    expect(hash).not.toContain('battery')
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

  it('logs only the error class on failure, never the password or hash', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const plaintext = 'super secret plaintext value'
    const storedHash = 'not-a-hash'

    const result = await verifyPassword(storedHash, plaintext)

    expect(result).toBe(false)
    expect(spy).toHaveBeenCalledTimes(1)
    const loggedText = spy.mock.calls.flat().join(' ')
    expect(loggedText).not.toContain(plaintext)
    expect(loggedText).not.toContain(storedHash)
    expect(loggedText.length).toBeGreaterThan(0)

    spy.mockRestore()
  })

  it('rejects a password shorter than the minimum', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/at least/)
  })

  it('requires at least 12 characters', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12)
  })

  it('rejects a password of exactly 11 characters', async () => {
    await expect(hashPassword('a'.repeat(11))).rejects.toThrow(/at least/)
  })

  it('accepts a password of exactly 12 characters', async () => {
    const hash = await hashPassword('a'.repeat(12))
    expect(hash.startsWith('$argon2id$')).toBe(true)
  })

  it('exports a maximum password length of 128', () => {
    expect(MAX_PASSWORD_LENGTH).toBe(128)
  })

  it('rejects a password longer than the maximum in hashPassword', async () => {
    await expect(hashPassword('a'.repeat(MAX_PASSWORD_LENGTH + 1))).rejects.toThrow(/at most/)
  })

  it('accepts a password of exactly the maximum length in hashPassword', async () => {
    const hash = await hashPassword('a'.repeat(MAX_PASSWORD_LENGTH))
    expect(hash.startsWith('$argon2id$')).toBe(true)
  })

  it('rejects over-length input in verifyPassword without invoking argon2', async () => {
    const hash = await hashPassword('correct horse battery')
    const overLong = 'a'.repeat(MAX_PASSWORD_LENGTH + 1)
    const verifySpy = vi.mocked(argon2.verify)
    verifySpy.mockClear()

    expect(await verifyPassword(hash, overLong)).toBe(false)
    expect(verifySpy).not.toHaveBeenCalled()
  })
})
