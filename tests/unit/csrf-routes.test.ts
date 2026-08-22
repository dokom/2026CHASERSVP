import { describe, it, expect } from 'vitest'
import {
  matchesCsrfRoute,
  matchesAdminCsrfRoute,
  matchesGuestCsrfRoute,
} from '@/lib/auth/csrf-routes'
import { config } from '@/middleware'

describe('matchesAdminCsrfRoute', () => {
  it('covers the admin panel', () => {
    expect(matchesAdminCsrfRoute('/admin')).toBe(true)
    expect(matchesAdminCsrfRoute('/admin/invites')).toBe(true)
    expect(matchesAdminCsrfRoute('/admin/invites/abc123')).toBe(true)
  })

  it('does not cover the guest portal or lookalike paths', () => {
    expect(matchesAdminCsrfRoute('/i/sometoken')).toBe(false)
    expect(matchesAdminCsrfRoute('/administrator')).toBe(false)
    expect(matchesAdminCsrfRoute('/index')).toBe(false)
  })
})

describe('matchesGuestCsrfRoute', () => {
  it('covers the guest portal', () => {
    expect(matchesGuestCsrfRoute('/i/sometoken')).toBe(true)
    expect(matchesGuestCsrfRoute('/i/sometoken/calendar')).toBe(true)
  })

  it('does not cover the admin panel or lookalike paths', () => {
    expect(matchesGuestCsrfRoute('/admin/invites')).toBe(false)
    expect(matchesGuestCsrfRoute('/images/logo.png')).toBe(false)
  })
})

describe('matchesCsrfRoute', () => {
  it('covers both surfaces', () => {
    expect(matchesCsrfRoute('/admin')).toBe(true)
    expect(matchesCsrfRoute('/admin/invites')).toBe(true)
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

/**
 * Interprets a Next.js `config.matcher` entry of the form `/<prefix>/:path*`
 * the same way Next does: matches the bare prefix and anything under it.
 * Only handles the shape this project's matcher actually uses — it is a
 * verification tool for THIS matcher, not a general path-to-regexp clone.
 */
function matcherCoversPath(patterns: readonly string[], pathname: string): boolean {
  return patterns.some((pattern) => {
    const prefix = pattern.replace(/\/:path\*$/, '')
    return pathname === prefix || pathname.startsWith(`${prefix}/`)
  })
}

/**
 * `middleware.ts` decides which CSRF cookie to issue by calling
 * `matchesAdminCsrfRoute` / `matchesGuestCsrfRoute` directly (see its
 * comments) — but Next.js only ever *invokes* the middleware function for
 * requests matching `config.matcher`. A predicate saying a route needs a
 * cookie is worthless if `config.matcher` never lets middleware run on that
 * route in the first place.
 *
 * This is the test that used to be able to pass while every guest page 500'd:
 * `matchesCsrfRoute` was tested in isolation above, but nothing checked that
 * `config.matcher` actually agreed with it. This suite reads the real
 * `config` exported by `src/middleware.ts` — not a re-typed copy of it — so
 * shrinking the matcher fails right here.
 */
describe('middleware config.matcher agrees with the CSRF route predicates', () => {
  const samplePaths = [
    '/admin',
    '/admin/invites',
    '/admin/invites/abc123',
    '/i/sometoken',
    '/i/sometoken/calendar',
    '/',
    '/administrator',
    '/images/logo.png',
    '/index',
  ]

  it.each(samplePaths)('matcher coverage of %s matches matchesCsrfRoute', (pathname) => {
    expect(matcherCoversPath(config.matcher, pathname)).toBe(matchesCsrfRoute(pathname))
  })
})
