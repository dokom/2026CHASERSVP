/**
 * Routes that render a state-changing form and therefore need a CSRF cookie
 * in place before render.
 *
 * Pure and framework-free so it can be unit-tested without `next/server`, which
 * `src/proxy.ts` pulls into the Edge bundle. `middleware.ts` calls these
 * predicates directly to decide which cookie to issue per request — it does
 * NOT re-derive route membership from `config.matcher` — so this file is the
 * single source of truth for "which routes get which CSRF cookie" and the
 * tests below exercise the real decision middleware makes, not a copy of it.
 *
 * `/administrator` and `/index` must NOT match; a naive prefix test catches both.
 */
export function matchesAdminCsrfRoute(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/')
}

/** The unauthenticated guest RSVP surface — gets its own cookie, see `csrf.ts`. */
export function matchesGuestCsrfRoute(pathname: string): boolean {
  return pathname === '/i' || pathname.startsWith('/i/')
}

/** Either surface — used only where callers don't care which. */
export function matchesCsrfRoute(pathname: string): boolean {
  return matchesAdminCsrfRoute(pathname) || matchesGuestCsrfRoute(pathname)
}
