import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { CSRF_COOKIE, issueCsrfToken } from '@/lib/auth/csrf'

/**
 * Bootstraps the CSRF double-submit cookie for every `/admin` route.
 *
 * Next.js forbids `cookies().set()` inside a Server Component's render — it
 * is only permitted in a Server Action or a Route Handler. Middleware runs
 * before render and is allowed to set cookies, so it is the single place
 * that guarantees the cookie exists before any admin page (login, user
 * management, invites, CSV import, …) tries to read it.
 *
 * The token is written to both the incoming request (so the Server Component
 * rendering in *this* request sees it immediately) and the outgoing response
 * (so the browser receives it). Writing only to the response would leave the
 * current render with no cookie and the form would submit an empty token.
 */
export function middleware(request: NextRequest): NextResponse {
  let token = request.cookies.get(CSRF_COOKIE)?.value
  if (!token) {
    token = issueCsrfToken()
    request.cookies.set(CSRF_COOKIE, token)
  }

  const response = NextResponse.next({ request })
  response.cookies.set(CSRF_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })
  return response
}

export const config = {
  matcher: ['/admin/:path*', '/i/:path*'],
}
