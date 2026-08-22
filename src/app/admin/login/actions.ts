'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { attemptLogin } from '@/lib/auth/login'
import { loginSchema } from '@/lib/validation/admin'
import { SESSION_COOKIE, destroySession } from '@/lib/auth/session'
import { landingPathFor } from '@/lib/auth/roles'
import { CSRF_COOKIE, verifyCsrfToken } from '@/lib/auth/csrf'

const MESSAGES: Record<string, string> = {
  INVALID: 'Email or password is incorrect.',
  LOCKED_OUT: 'Too many attempts. Try again in 15 minutes.',
  INACTIVE: 'This account has been deactivated.',
}

export async function loginAction(_prev: string | null, formData: FormData): Promise<string | null> {
  const store = await cookies()
  if (!verifyCsrfToken(store.get(CSRF_COOKIE)?.value, formData.get('csrf'))) {
    return 'Your session expired. Reload the page and try again.'
  }

  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) return 'Enter a valid email address and password.'

  const headerList = await headers()
  const result = await attemptLogin(prisma, parsed.data, {
    ip: headerList.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: headerList.get('user-agent') ?? undefined,
  })

  if (!result.ok) return MESSAGES[result.reason] ?? MESSAGES.INVALID!

  store.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: result.expiresAt,
  })
  redirect(landingPathFor(result.user.role))
}

export async function logoutAction(): Promise<void> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (token) await destroySession(prisma, token)
  store.delete(SESSION_COOKIE)
  redirect('/admin/login')
}
