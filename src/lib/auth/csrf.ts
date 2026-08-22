import { randomBytes, timingSafeEqual } from 'node:crypto'

export const CSRF_COOKIE = 'gala_csrf'

/** 32 bytes encodes to 43 base64url characters. */
export function issueCsrfToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Double-submit verification: the cookie value must equal the value posted in
 * the form body. Compared in constant time.
 */
export function verifyCsrfToken(cookieValue: string | undefined, formValue: unknown): boolean {
  if (!cookieValue || typeof formValue !== 'string' || formValue.length === 0) return false
  const a = Buffer.from(cookieValue)
  const b = Buffer.from(formValue)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
