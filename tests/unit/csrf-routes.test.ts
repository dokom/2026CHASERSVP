import { describe, it, expect } from 'vitest'
import {
  matchesCsrfRoute,
  matchesAdminCsrfRoute,
  matchesGuestCsrfRoute,
} from '@/lib/auth/csrf-routes'
import { config } from '@/proxy'

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
 * Interprets a Next.js `config.matcher` entry the way Next does: each
 * pattern is a path-to-regexp-flavoured string, and this project's matcher
 * (as of the CSP nonce work) is the single catch-all-except-static-assets
 * form `/((?!_next/static|_next/image|favicon.ico).*)`, which is already
 * valid regex source once anchored. Kept general enough to also interpret
 * the older `/<prefix>/:path*` shape, in case a future matcher reverts to it.
 */
function matcherCoversPath(patterns: readonly string[], pathname: string): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith('/:path*')) {
      const prefix = pattern.replace(/\/:path\*$/, '')
      return pathname === prefix || pathname.startsWith(`${prefix}/`)
    }
    return new RegExp(`^${pattern}$`).test(pathname)
  })
}

/**
 * `src/proxy.ts` decides which CSRF cookie to issue by calling
 * `matchesAdminCsrfRoute` / `matchesGuestCsrfRoute` directly (see its
 * comments) — but Next.js only ever *invokes* the proxy for requests
 * matching `config.matcher`. A predicate saying a route needs a cookie is
 * worthless if `config.matcher` never lets the proxy run on that route in
 * the first place.
 *
 * The matcher now also carries the per-request CSP nonce, so it is
 * deliberately a SUPERSET of the CSRF predicates (it matches nearly every
 * route, not just `/admin` and `/i`) rather than an exact match — this test
 * asserts the superset relationship, not equality: every route the CSRF
 * predicates require is confirmed still covered.
 */
describe('proxy config.matcher covers every CSRF route', () => {
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

  it.each(samplePaths)('matcher covers %s whenever a CSRF cookie is needed there', (pathname) => {
    if (matchesCsrfRoute(pathname)) {
      expect(matcherCoversPath(config.matcher, pathname)).toBe(true)
    }
  })

  it('excludes static asset paths so the proxy does not run on every chunk request', () => {
    expect(matcherCoversPath(config.matcher, '/_next/static/chunk.js')).toBe(false)
    expect(matcherCoversPath(config.matcher, '/_next/image')).toBe(false)
    expect(matcherCoversPath(config.matcher, '/favicon.ico')).toBe(false)
  })
})
