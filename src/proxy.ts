import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { CSRF_COOKIE, GUEST_CSRF_COOKIE, issueCsrfToken } from '@/lib/auth/csrf'
import { matchesAdminCsrfRoute, matchesGuestCsrfRoute } from '@/lib/auth/csrf-routes'
import { buildCsp } from '@/lib/security/csp'

/**
 * Bootstraps the CSRF double-submit cookie for `/admin` and `/i` routes, and
 * stamps a per-request Content-Security-Policy (with a fresh nonce) onto
 * every matched route.
 *
 * Next.js forbids `cookies().set()` inside a Server Component's render — it
 * is only permitted in a Server Action or a Route Handler. This proxy runs
 * before render and is allowed to set cookies, so it is the single place
 * that guarantees the cookie exists before any admin or guest page tries to
 * read it.
 *
 * `/admin` and `/i` are two DIFFERENT unauthenticated-vs-authenticated
 * surfaces and get two DIFFERENT cookies with non-overlapping `path`s — see
 * `src/lib/auth/csrf.ts` for why sharing one cookie between them is a leak.
 * Route membership comes from `matchesAdminCsrfRoute` / `matchesGuestCsrfRoute`
 * (see `src/lib/auth/csrf-routes.ts`), not from re-parsing `config.matcher`
 * below — `config.matcher` now covers essentially every route (so the CSP
 * applies everywhere, including `/` and `/api/*`), and remains a superset of
 * both CSRF predicates; it never narrows which routes get a CSRF cookie.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl
  const isAdminRoute = matchesAdminCsrfRoute(pathname)
  const isGuestRoute = matchesGuestCsrfRoute(pathname)

  const adminToken = isAdminRoute ? ensureRequestCookie(request, CSRF_COOKIE) : undefined
  const guestToken = isGuestRoute ? ensureRequestCookie(request, GUEST_CSRF_COOKIE) : undefined

  // Web Crypto and btoa only — this runs on the Edge runtime; a node:crypto
  // import here 500s every route.
  const nonce = btoa(crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + String.fromCharCode(b), ''))
  const csp = buildCsp(nonce, process.env.NODE_ENV === 'development')
  request.headers.set('x-nonce', nonce)
  request.headers.set('Content-Security-Policy', csp)

  const response = NextResponse.next({ request })

  if (adminToken) {
    setCsrfCookie(response, CSRF_COOKIE, adminToken, '/')
  }
  if (guestToken) {
    setCsrfCookie(response, GUEST_CSRF_COOKIE, guestToken, '/i')
  }

  response.headers.set('Content-Security-Policy', csp)

  return response
}

/**
 * Reads the named cookie off the incoming request, minting and writing one
 * back onto the request if it's missing, so the Server Component rendering
 * in *this* request sees it immediately (the response cookie alone would
 * leave the current render with no cookie and the form would post an empty
 * token).
 */
function ensureRequestCookie(request: NextRequest, name: string): string {
  const existing = request.cookies.get(name)?.value
  if (existing) return existing
  const token = issueCsrfToken()
  request.cookies.set(name, token)
  return token
}

function setCsrfCookie(response: NextResponse, name: string, value: string, path: string): void {
  response.cookies.set(name, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path,
  })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
