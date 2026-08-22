/**
 * Routes that render a state-changing form and therefore need the CSRF cookie
 * in place before render.
 *
 * Pure and framework-free so it can be unit-tested without `next/server`, which
 * `src/middleware.ts` pulls into the Edge bundle. `middleware.ts`'s
 * `config.matcher` must stay in step with this predicate — the test below is
 * what keeps the intent honest.
 *
 * `/administrator` and `/index` must NOT match; a naive prefix test catches both.
 */
export function matchesCsrfRoute(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/i/')
}
