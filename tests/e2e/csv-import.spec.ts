import { test, expect, type Page } from '@playwright/test'

const HEADER = 'label,seatsAllotted,tableNumber,primaryFirstName,primaryLastName,primaryEmail,primaryCompany,primaryTitle,adminNotes'

async function signIn(page: Page) {
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(process.env.ADMIN_SEED_EMAIL!)
  await page.getByLabel('Password').fill(process.env.ADMIN_SEED_PASSWORD!)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/admin$/)
}

async function upload(page: Page, csv: string) {
  await page.getByLabel('CSV file').setInputFiles({
    name: 'invites.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  })
  await page.getByRole('button', { name: 'Validate file' }).click()
}

test.describe('CSV import', () => {
  test('previews valid rows then commits them', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/invites/import')

    const stamp = Date.now()
    await upload(page, `${HEADER}\nImported ${stamp},2,,Ada,Okafor,ada${stamp}@example.com,,,`)

    await expect(page.getByText('1 row ready to import')).toBeVisible()
    await page.getByRole('button', { name: 'Import 1 invite' }).click()
    await expect(page).toHaveURL(/\/admin\/invites/)
    await expect(page.getByRole('cell', { name: `Imported ${stamp}` })).toBeVisible()
  })

  test('shows per-row errors and refuses to import them', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/invites/import')
    await upload(page, `${HEADER}\n,two,,Ada,,bad-email,,,`)

    await expect(page.getByText(/label is required/)).toBeVisible()
    await expect(page.getByText(/seats must be/)).toBeVisible()
    await expect(page.getByText(/0 rows ready to import/)).toBeVisible()
  })

  test('reports a missing required column', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/invites/import')
    await upload(page, 'label,seatsAllotted\nA,1')
    // Next.js also renders a hidden route-announcer div with role="alert" on
    // every page (for accessibility route-change announcements), so the
    // locator must be scoped to the element carrying the error text.
    await expect(page.getByRole('alert').filter({ hasText: 'primaryFirstName' })).toContainText(
      'primaryFirstName',
    )
  })
})
