import { test, expect } from '@playwright/test'

test.describe('admin access control', () => {
  test('redirects an anonymous visitor from the dashboard to login', async ({ page }) => {
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/admin\/login/)
  })

  test('redirects an anonymous visitor from user management to login', async ({ page }) => {
    await page.goto('/admin/users')
    await expect(page).toHaveURL(/\/admin\/login/)
  })

  test('rejects bad credentials with a visible error', async ({ page }) => {
    // Unique per test run so two projects (mobile/desktop) running this
    // test in the same suite invocation never share a rate-limit counter.
    // See tests/e2e/global-setup.ts for the cross-run cleanup of the same
    // underlying LoginAttempt table.
    const email = `nobody-${Date.now()}@example.com`
    await page.goto('/admin/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('definitely-wrong')
    await page.getByRole('button', { name: 'Sign in' }).click()
    // Next.js also renders a hidden route-announcer div with role="alert" on
    // every page (for accessibility route-change announcements), so the
    // locator must be scoped to the element carrying the error text.
    await expect(page.getByRole('alert').filter({ hasText: 'incorrect' })).toContainText('incorrect')
  })

  test('signs an owner in and shows the full navigation', async ({ page }) => {
    await page.goto('/admin/login')
    await page.getByLabel('Email').fill(process.env.ADMIN_SEED_EMAIL!)
    await page.getByLabel('Password').fill(process.env.ADMIN_SEED_PASSWORD!)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByRole('link', { name: 'Admin users' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Invites' })).toBeVisible()
  })

  test('signs out and blocks the dashboard again', async ({ page }) => {
    await page.goto('/admin/login')
    await page.getByLabel('Email').fill(process.env.ADMIN_SEED_EMAIL!)
    await page.getByLabel('Password').fill(process.env.ADMIN_SEED_PASSWORD!)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/admin\/login/)
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/admin\/login/)
  })
})
