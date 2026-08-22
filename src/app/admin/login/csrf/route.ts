import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { CSRF_COOKIE, issueCsrfToken } from '@/lib/auth/csrf'

/**
 * Bootstraps the CSRF double-submit cookie for the login page.
 *
 * Next.js forbids `cookies().set()` inside a Server Component's GET render
 * (it is only permitted in a Server Action or Route Handler). This Route
 * Handler exists solely to set that cookie when it is missing, then redirects
 * back to `/admin/login` — see `login/page.tsx`, which redirects here.
 */
export async function GET(): Promise<never> {
  const store = await cookies()
  store.set(CSRF_COOKIE, issueCsrfToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })
  redirect('/admin/login')
}
