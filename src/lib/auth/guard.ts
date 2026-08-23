import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { resolveSession, SESSION_COOKIE, type SessionUser } from './session'
import { hasRole, landingPathFor, type Role } from './roles'
import { CSRF_COOKIE, verifyCsrfToken } from './csrf'

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null
  return resolveSession(prisma, token)
}

/**
 * Gates a page or action. Redirects rather than throwing so the caller does not
 * need error handling. Never returns for an unauthorized request.
 */
export async function requireRole(minimum: Role): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/admin/login')
  if (!hasRole(user.role, minimum)) redirect(landingPathFor(user.role))
  return user
}

export async function requireCsrf(formData: FormData): Promise<void> {
  const store = await cookies()
  const cookieValue = store.get(CSRF_COOKIE)?.value
  if (!verifyCsrfToken(cookieValue, formData.get('csrf'))) {
    throw new Error('Invalid CSRF token')
  }
}
