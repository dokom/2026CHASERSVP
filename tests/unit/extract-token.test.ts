import { describe, it, expect } from 'vitest'
import { extractToken } from '@/lib/validation/checkin'

const APP = 'https://gala.example.com'
const TOKEN = 'A'.repeat(32)

describe('extractToken', () => {
  it('pulls the token out of a valid invite URL', () => {
    expect(extractToken(`${APP}/i/${TOKEN}`, APP)).toBe(TOKEN)
  })
  it('tolerates a trailing slash and surrounding whitespace', () => {
    expect(extractToken(`  ${APP}/i/${TOKEN}/ `, APP)).toBe(TOKEN)
  })
  it('REJECTS a foreign origin — a QR code for another site is not a token', () => {
    expect(extractToken(`https://evil.example/i/${TOKEN}`, APP)).toBeNull()
  })
  it('rejects a different port on the same host', () => {
    expect(extractToken(`https://gala.example.com:8443/i/${TOKEN}`, APP)).toBeNull()
  })
  it('rejects plain text that is not a URL', () => {
    expect(extractToken(TOKEN, APP)).toBeNull()
  })
  it('rejects a path that is not /i/', () => {
    expect(extractToken(`${APP}/admin/invites/${TOKEN}`, APP)).toBeNull()
  })
  it('rejects a token of the wrong length', () => {
    expect(extractToken(`${APP}/i/${'A'.repeat(31)}`, APP)).toBeNull()
    expect(extractToken(`${APP}/i/${'A'.repeat(33)}`, APP)).toBeNull()
  })
  it('rejects a token with characters outside base64url', () => {
    expect(extractToken(`${APP}/i/${'A'.repeat(31)}!`, APP)).toBeNull()
  })
})
