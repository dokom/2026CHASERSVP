import { describe, it, expect } from 'vitest'
import { issueCsrfToken, verifyCsrfToken, CSRF_COOKIE } from '@/lib/auth/csrf'

describe('csrf', () => {
  it('names the cookie', () => {
    expect(CSRF_COOKIE).toBe('gala_csrf')
  })

  it('issues a 43-character base64url token', () => {
    expect(issueCsrfToken()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('issues a distinct token each call', () => {
    expect(issueCsrfToken()).not.toBe(issueCsrfToken())
  })

  it('accepts a matching pair', () => {
    const token = issueCsrfToken()
    expect(verifyCsrfToken(token, token)).toBe(true)
  })

  it('rejects a mismatched pair', () => {
    expect(verifyCsrfToken(issueCsrfToken(), issueCsrfToken())).toBe(false)
  })

  it('rejects a missing cookie', () => {
    expect(verifyCsrfToken(undefined, issueCsrfToken())).toBe(false)
  })

  it('rejects a missing form value', () => {
    expect(verifyCsrfToken(issueCsrfToken(), null)).toBe(false)
  })

  it('rejects a non-string form value', () => {
    const token = issueCsrfToken()
    expect(verifyCsrfToken(token, 42)).toBe(false)
  })

  it('rejects an empty pair', () => {
    expect(verifyCsrfToken('', '')).toBe(false)
  })
})
