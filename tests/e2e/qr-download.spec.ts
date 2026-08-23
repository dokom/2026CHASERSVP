import { test, expect, type Page } from '@playwright/test'

async function signIn(page: Page) {
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(process.env.ADMIN_SEED_EMAIL!)
  await page.getByLabel('Password').fill(process.env.ADMIN_SEED_PASSWORD!)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/admin$/)
}

test.describe('QR download', () => {
  test('rejects an anonymous request', async ({ request }) => {
    const response = await request.get('/api/admin/qr?format=pdf', { maxRedirects: 0 })
    expect([302, 307, 401, 403]).toContain(response.status())
  })

  test('returns a PDF for a signed-in admin', async ({ page }) => {
    await signIn(page)
    const response = await page.request.get('/api/admin/qr?format=pdf')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/pdf')
    const body = await response.body()
    expect(body.subarray(0, 5).toString()).toBe('%PDF-')
  })

  test('returns a ZIP for a signed-in admin', async ({ page }) => {
    await signIn(page)
    const response = await page.request.get('/api/admin/qr?format=zip')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/zip')
    expect(response.headers()['content-disposition']).toContain('attachment')
  })

  test('rejects an unknown format', async ({ page }) => {
    await signIn(page)
    const response = await page.request.get('/api/admin/qr?format=docx')
    expect(response.status()).toBe(400)
  })
})
