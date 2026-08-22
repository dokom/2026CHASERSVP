import type { Page } from '@playwright/test'

/**
 * Signs an already-seeded admin account in through the real login form.
 *
 * Shared by every spec that needs an authenticated session at a specific
 * role (see tests/e2e/global-setup.ts for the OWNER/ADMIN/STAFF fixtures) —
 * extracted here rather than copied so authorization.spec.ts and
 * event-config.spec.ts can never drift on how a sign-in actually happens.
 */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}
