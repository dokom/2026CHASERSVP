import { test, expect } from '@playwright/test'

async function signInAsOwner(page: import('@playwright/test').Page) {
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(process.env.ADMIN_SEED_EMAIL!)
  await page.getByLabel('Password').fill(process.env.ADMIN_SEED_PASSWORD!)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/admin$/)
}

// Next.js also renders a hidden route-announcer div with role="alert" on
// every page (for accessibility route-change announcements), so alert
// locators must be scoped to the element carrying the actual message.
function errorAlert(page: import('@playwright/test').Page, text: string) {
  return page.getByRole('alert').filter({ hasText: text })
}

test.describe('admin user management', () => {
  test('creates an admin and lists them', async ({ page }) => {
    await signInAsOwner(page)
    await page.getByRole('link', { name: 'Admin users' }).click()

    const email = `staff-${Date.now()}@example.com`
    // The page header also contains a <form> (sign out), so scope to the
    // form that actually holds the "Create admin" button, not just the
    // first <form> in the document.
    const createForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Create admin' }) })
    await createForm.getByLabel('Email').fill(email)
    await createForm.getByLabel('Name').fill('Door Staff')
    await createForm.getByLabel('Role').selectOption('STAFF')
    await createForm.getByLabel('Temporary password').fill('temporary password 1')
    await createForm.getByRole('button', { name: 'Create admin' }).click()

    await expect(page.getByRole('cell', { name: email })).toBeVisible()
  })

  test('rejects a duplicate email with a visible message', async ({ page }) => {
    await signInAsOwner(page)
    await page.goto('/admin/users')
    const createForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Create admin' }) })
    await createForm.getByLabel('Email').fill(process.env.ADMIN_SEED_EMAIL!)
    await createForm.getByLabel('Name').fill('Duplicate')
    await createForm.getByLabel('Role').selectOption('ADMIN')
    await createForm.getByLabel('Temporary password').fill('temporary password 1')
    await createForm.getByRole('button', { name: 'Create admin' }).click()
    await expect(errorAlert(page, 'already exists')).toContainText('already exists')
  })

  test('refuses to demote the last owner', async ({ page }) => {
    await signInAsOwner(page)
    await page.goto('/admin/users')
    const row = page.getByRole('row', { name: new RegExp(process.env.ADMIN_SEED_EMAIL!) })
    await row.getByLabel('Role').selectOption('ADMIN')
    await row.getByRole('button', { name: 'Save role' }).click()
    await expect(errorAlert(page, 'last active owner')).toContainText('last active owner')
  })
})
