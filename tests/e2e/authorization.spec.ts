import { test, expect } from '@playwright/test'
import { STAFF_CREDENTIALS, ADMIN_CREDENTIALS } from './global-setup'
import { signIn } from './sign-in'

// Proves the role gate in src/lib/auth/guard.ts (hasRole via requireRole)
// actually blocks lower-privileged accounts from higher-privileged routes.
// Every assertion here must fail if requireRole stops comparing roles —
// see the task report for the deliberately-broken-guard.ts run that
// confirms it.

test.describe('authorization boundaries', () => {
  test.describe('STAFF', () => {
    test('can reach the check-in page', async ({ page }) => {
      await signIn(page, STAFF_CREDENTIALS.email, STAFF_CREDENTIALS.password)
      await expect(page).toHaveURL(/\/admin\/checkin$/)
      await expect(page.getByRole('heading', { name: 'Check-in' })).toBeVisible()
    })

    test('is redirected away from the dashboard', async ({ page }) => {
      await signIn(page, STAFF_CREDENTIALS.email, STAFF_CREDENTIALS.password)
      await expect(page).toHaveURL(/\/admin\/checkin$/)
      await page.goto('/admin')
      await expect(page).toHaveURL(/\/admin\/checkin$/)
    })

    test('is redirected away from admin users', async ({ page }) => {
      await signIn(page, STAFF_CREDENTIALS.email, STAFF_CREDENTIALS.password)
      await expect(page).toHaveURL(/\/admin\/checkin$/)
      await page.goto('/admin/users')
      await expect(page).toHaveURL(/\/admin\/checkin$/)
    })

    test('is redirected away from invites', async ({ page }) => {
      await signIn(page, STAFF_CREDENTIALS.email, STAFF_CREDENTIALS.password)
      await expect(page).toHaveURL(/\/admin\/checkin$/)
      await page.goto('/admin/invites')
      await expect(page).toHaveURL(/\/admin\/checkin$/)
    })

    test('cannot download the QR zip export', async ({ page }) => {
      await signIn(page, STAFF_CREDENTIALS.email, STAFF_CREDENTIALS.password)
      await expect(page).toHaveURL(/\/admin\/checkin$/)
      const response = await page.request.get('/api/admin/qr?format=zip', { maxRedirects: 0 })
      expect(response.status()).not.toBe(200)
      expect(response.headers()['content-type'] ?? '').not.toContain('application/zip')
    })
  })

  test.describe('ADMIN', () => {
    test('can reach the dashboard and invites', async ({ page }) => {
      await signIn(page, ADMIN_CREDENTIALS.email, ADMIN_CREDENTIALS.password)
      await expect(page).toHaveURL(/\/admin$/)

      await page.goto('/admin/invites')
      await expect(page).toHaveURL(/\/admin\/invites$/)
    })

    test('is redirected away from admin users (OWNER-only)', async ({ page }) => {
      await signIn(page, ADMIN_CREDENTIALS.email, ADMIN_CREDENTIALS.password)
      await expect(page).toHaveURL(/\/admin$/)
      await page.goto('/admin/users')
      await expect(page).toHaveURL(/\/admin$/)
    })
  })

  test.describe('OWNER', () => {
    test('can reach admin users', async ({ page }) => {
      await signIn(page, process.env.ADMIN_SEED_EMAIL!, process.env.ADMIN_SEED_PASSWORD!)
      await expect(page).toHaveURL(/\/admin$/)
      await page.goto('/admin/users')
      await expect(page).toHaveURL(/\/admin\/users$/)
      await expect(page.getByRole('heading', { name: 'Admin users' })).toBeVisible()
    })
  })

  test.describe('anonymous', () => {
    test('cannot download the QR pdf export', async ({ page }) => {
      const response = await page.request.get('/api/admin/qr?format=pdf', { maxRedirects: 0 })
      expect(response.status()).not.toBe(200)
      expect(response.headers()['content-type'] ?? '').not.toContain('application/pdf')
    })
  })
})
