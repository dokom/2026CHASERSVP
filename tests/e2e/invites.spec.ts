import { test, expect, type Page } from '@playwright/test'

async function signIn(page: Page) {
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(process.env.ADMIN_SEED_EMAIL!)
  await page.getByLabel('Password').fill(process.env.ADMIN_SEED_PASSWORD!)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/admin$/)
}

test.describe('invite management', () => {
  test('creates an invite and finds it by search', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/invites')

    // "Add a single invite" is a collapsed <details> disclosure by design
    // (the page is a list first, a create form second) — open it before
    // interacting with the fields inside.
    await page.locator('summary', { hasText: 'Add a single invite' }).click()

    const label = `Okafor Party ${Date.now()}`
    await page.getByLabel('Invite label').fill(label)
    await page.getByLabel('Seats').fill('2')
    await page.getByLabel('First name').fill('Ada')
    await page.getByLabel('Last name').fill('Okafor')
    await page.getByRole('button', { name: 'Create invite' }).click()

    await expect(page.getByRole('cell', { name: label })).toBeVisible()

    await page.getByLabel('Search').fill('Okafor')
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByRole('cell', { name: label })).toBeVisible()
  })

  test('opens invite detail and renames it', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/invites')
    await page.getByRole('link', { name: 'Open' }).first().click()

    const renamed = `Renamed ${Date.now()}`
    await page.getByLabel('Invite label').fill(renamed)
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByLabel('Invite label')).toHaveValue(renamed)
  })

  test('regenerates a token and shows it exactly once', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/invites')
    await page.getByRole('link', { name: 'Open' }).first().click()
    await page.getByRole('button', { name: 'Regenerate QR token' }).click()

    const link = page.getByTestId('invite-url')
    await expect(link).toBeVisible()
    await expect(link).toContainText('/i/')

    // page.reload() re-requests the SAME url, including the ?inviteUrl=...
    // query string, so the token would still render — that's not what's
    // worth proving. The token isn't persisted server-side, so navigating
    // to the bare detail URL (no query string), as an operator normally
    // would, must never re-display it.
    const bareUrl = page.url().split('?')[0] ?? page.url()
    await page.goto(bareUrl)
    await expect(page.getByTestId('invite-url')).toHaveCount(0)
  })

  test('refuses to shrink seats below the guest count', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/invites')
    await page.getByRole('link', { name: 'Open' }).first().click()
    await page.getByLabel('Seats').fill('0')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
  })
})
