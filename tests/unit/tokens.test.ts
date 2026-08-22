import { describe, it, expect } from 'vitest'
import { generateInviteToken, hashToken, TOKEN_BYTE_LENGTH } from '@/lib/crypto/tokens'

describe('generateInviteToken', () => {
  it('produces 32 base64url characters', () => {
    const token = generateInviteToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/)
  })

  it('encodes 24 bytes of entropy', () => {
    expect(TOKEN_BYTE_LENGTH).toBe(24)
  })

  it('does not repeat across 1000 generations', () => {
    const seen = new Set(Array.from({ length: 1000 }, generateInviteToken))
    expect(seen.size).toBe(1000)
  })
})

describe('hashToken', () => {
  it('returns 64 lowercase hex characters', () => {
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'))
  })

  it('differs for different input', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'))
  })

  it('never returns the input', () => {
    const token = generateInviteToken()
    expect(hashToken(token)).not.toContain(token)
  })
})
