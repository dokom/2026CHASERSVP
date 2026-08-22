import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { CSRF_COOKIE, GUEST_CSRF_COOKIE, issueCsrfToken } from '@/lib/auth/csrf'
import { matchesAdminCsrfRoute, matchesGuestCsrfRoute } from '@/lib/auth/csrf-routes'

/**
 * Bootstraps the CSRF double-submit cookie for `/admin` and `/i` routes.
 *
 * Next.js forbids `cookies().set()` inside a Server Component's render — it
 * is only permitted in a Server Action or a Route Handler. Middleware runs
 * before render and is allowed to set cookies, so it is the single place
 * that guarantees the cookie exists before any admin or guest page tries to
 * read it.
 *
 * `/admin` and `/i` are two DIFFERENT unauthenticated-vs-authenticated
 * surfaces and get two DIFFERENT cookies with non-overlapping `path`s — see
 * `src/lib/auth/csrf.ts` for why sharing one cookie between them is a leak.
 * Route membership comes from `matchesAdminCsrfRoute` / `matchesGuestCsrfRoute`
 * (see `src/lib/auth/csrf-routes.ts`), not from re-parsing `config.matcher`
 * below — `config.matcher` only tells Next.js when to invoke this function at
 * all; it must stay a superset of both predicates.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl
  const isAdminRoute = matchesAdminCsrfRoute(pathname)
  const isGuestRoute = matchesGuestCsrfRoute(pathname)

  const adminToken = isAdminRoute ? ensureRequestCookie(request, CSRF_COOKIE) : undefined
  const guestToken = isGuestRoute ? ensureRequestCookie(request, GUEST_CSRF_COOKIE) : undefined

  const response = NextResponse.next({ request })

  if (adminToken) {
    setCsrfCookie(response, CSRF_COOKIE, adminToken, '/')
  }
  if (guestToken) {
    setCsrfCookie(response, GUEST_CSRF_COOKIE, guestToken, '/i')
  }

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
  matcher: ['/admin/:path*', '/i/:path*'],
}
