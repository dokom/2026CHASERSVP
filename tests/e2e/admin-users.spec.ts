import { test, expect } from '@playwright/test'

async function signInAsOwner(page: import('@playwright/test').Page) {
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(process.env.ADMIN_SEED_EMAIL!)
  await page.getByLabel('Password').fill(process.env.ADMIN_SEED_PASSWORD!)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/admin$/)
}

test.describe('admin user management', () => {
  test('creates an admin and lists them', async ({ page }) => {
    await signInAsOwner(page)
    await page.getByRole('link', { name: 'Admin users' }).click()

    const email = `staff-${Date.now()}@example.com`
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Name').fill('Door Staff')
    await page.getByLabel('Role').selectOption('STAFF')
    await page.getByLabel('Temporary password').fill('temporary password 1')
    await page.getByRole('button', { name: 'Create admin' }).click()

    await expect(page.getByRole('cell', { name: email })).toBeVisible()
  })

  test('rejects a duplicate email with a visible message', async ({ page }) => {
    await signInAsOwner(page)
    await page.goto('/admin/users')
    await page.getByLabel('Email').fill(process.env.ADMIN_SEED_EMAIL!)
    await page.getByLabel('Name').fill('Duplicate')
    await page.getByLabel('Role').selectOption('ADMIN')
    await page.getByLabel('Temporary password').fill('temporary password 1')
    await page.getByRole('button', { name: 'Create admin' }).click()
    await expect(page.getByRole('alert')).toContainText('already exists')
  })

  test('refuses to demote the last owner', async ({ page }) => {
    await signInAsOwner(page)
    await page.goto('/admin/users')
    const row = page.getByRole('row', { name: new RegExp(process.env.ADMIN_SEED_EMAIL!) })
    await row.getByLabel('Role').selectOption('ADMIN')
    await row.getByRole('button', { name: 'Save role' }).click()
    await expect(page.getByRole('alert')).toContainText('last active owner')
  })
})
