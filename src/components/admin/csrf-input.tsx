import { cookies } from 'next/headers'
import { CSRF_COOKIE } from '@/lib/auth/csrf'

/**
 * Renders the CSRF field for a form. READ-ONLY by design: Next.js forbids
 * `cookies().set()` during a Server Component render, and doing it anyway
 * 500s the page in production while every unit and integration test stays
 * green. `src/middleware.ts` guarantees the cookie exists on every
 * `/admin/*` request before render, so this component only ever reads it.
 */
export async function CsrfInput() {
  const store = await cookies()
  const token = store.get(CSRF_COOKIE)?.value
  if (!token) {
    throw new Error('CSRF cookie missing — check that src/middleware.ts matches this route')
  }
  return <input type="hidden" name="csrf" value={token} />
}
