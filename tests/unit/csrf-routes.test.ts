import { describe, it, expect } from 'vitest'
import { matchesCsrfRoute } from '@/lib/auth/csrf-routes'

describe('matchesCsrfRoute', () => {
  it('covers the admin panel', () => {
    expect(matchesCsrfRoute('/admin')).toBe(true)
    expect(matchesCsrfRoute('/admin/invites')).toBe(true)
    expect(matchesCsrfRoute('/admin/invites/abc123')).toBe(true)
  })

  it('covers the guest portal', () => {
    expect(matchesCsrfRoute('/i/sometoken')).toBe(true)
    expect(matchesCsrfRoute('/i/sometoken/calendar')).toBe(true)
  })

  it('does not cover the marketing root', () => {
    expect(matchesCsrfRoute('/')).toBe(false)
  })

  it('does not cover unrelated paths that merely start with the same letters', () => {
    expect(matchesCsrfRoute('/administrator')).toBe(false)
    expect(matchesCsrfRoute('/images/logo.png')).toBe(false)
    expect(matchesCsrfRoute('/index')).toBe(false)
  })
})
