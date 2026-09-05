import { test, expect, type Page } from '@playwright/test'
import { ADMIN_CREDENTIALS, STAFF_CREDENTIALS } from './global-setup'
import { signIn } from './sign-in'

// Covers /admin/event: the operator surface for the event itself, its
// agenda, its meal options and its floorplan uploads. Signs in as ADMIN —
// the role the event page actually requires — using the same fixtures
// tests/e2e/authorization.spec.ts already proves the role gate against.

async function signInAsAdmin(page: Page) {
  await signIn(page, ADMIN_CREDENTIALS.email, ADMIN_CREDENTIALS.password)
  await expect(page).toHaveURL(/\/admin$/)
}

/** Scopes to the one <form> that actually holds the given submit button, since
 *  several of this page's forms share field labels ("Starts at", "Description"). */
function formWithButton(page: Page, buttonName: string) {
  return page.locator('form').filter({ has: page.getByRole('button', { name: buttonName }) })
}

test.describe('event configuration', () => {
  test('saves a changed event name and it survives a reload', async ({ page }) => {
    await signInAsAdmin(page)
    await page.goto('/admin/event')

    const newName = `Renamed Gala ${Date.now()}`
    await page.getByLabel('Event name').fill(newName)
    // The save doesn't redirect on success (just revalidatePath), so it's a
    // same-URL client transition — wait for that POST to actually land
    // before reloading, or the reload can race ahead of the write.
    await Promise.all([
      page.waitForResponse(
        (res) => res.request().method() === 'POST' && res.url().includes('/admin/event'),
      ),
      page.getByRole('button', { name: 'Save event' }).click(),
    ])

    await page.reload()
    await expect(page.getByLabel('Event name')).toHaveValue(newName)
  })

  test('seating can be hidden from guests and released again', async ({ page }) => {
    await signInAsAdmin(page)
    await page.goto('/admin/event')

    // global-setup seeds the event with seating released.
    const seating = page.locator('[data-seating-release]')
    await expect(seating).toHaveAttribute('data-seating-release', 'released')

    await page.getByRole('button', { name: 'Hide seating again' }).click()
    await expect(seating).toHaveAttribute('data-seating-release', 'hidden')
    await expect(page.getByText('Tables are hidden from every guest')).toBeVisible()

    // Leave the fixture the way the guest specs expect to find it.
    await page.getByRole('button', { name: 'Release seating to guests' }).click()
    await expect(seating).toHaveAttribute('data-seating-release', 'released')
    await expect(page.getByText(/Seating was released on/)).toBeVisible()
  })

  test('rejects an RSVP deadline after the event start with a visible message', async ({ page }) => {
    await signInAsAdmin(page)
    await page.goto('/admin/event')

    // The seeded event starts a week out; any date far beyond that is
    // guaranteed to fall after it regardless of the machine's local timezone.
    await page.getByLabel('RSVP deadline').fill('2099-01-01T00:00')
    await page.getByRole('button', { name: 'Save event' }).click()

    await expect(
      page.getByRole('alert').filter({ hasText: 'must fall before the event starts' }),
    ).toBeVisible()
  })

  test('adding an agenda item makes it appear in the table', async ({ page }) => {
    await signInAsAdmin(page)
    await page.goto('/admin/event')

    const title = `Fireworks ${Date.now()}`
    const agendaForm = formWithButton(page, 'Add agenda item')
    await agendaForm.getByLabel('Title').fill(title)
    await agendaForm.getByLabel('Starts at').fill('2026-09-01T21:00')
    await agendaForm.getByRole('button', { name: 'Add agenda item' }).click()

    await expect(page.getByRole('cell', { name: title })).toBeVisible()
  })

  test('removing an agenda item removes it', async ({ page }) => {
    await signInAsAdmin(page)
    await page.goto('/admin/event')

    const title = `Toast ${Date.now()}`
    const agendaForm = formWithButton(page, 'Add agenda item')
    await agendaForm.getByLabel('Title').fill(title)
    await agendaForm.getByLabel('Starts at').fill('2026-09-01T20:30')
    await agendaForm.getByRole('button', { name: 'Add agenda item' }).click()
    await expect(page.getByRole('cell', { name: title })).toBeVisible()

    const row = page.getByRole('row', { name: new RegExp(title) })
    await row.getByRole('button', { name: 'Remove' }).click()

    await expect(page.getByRole('cell', { name: title })).toHaveCount(0)
  })

  test('adding a meal option makes it appear, and retiring it flips its status without deleting the row', async ({
    page,
  }) => {
    await signInAsAdmin(page)
    await page.goto('/admin/event')

    const label = `Fish ${Date.now()}`
    const mealForm = formWithButton(page, 'Add meal option')
    await mealForm.getByLabel('Label').fill(label)
    await mealForm.getByRole('button', { name: 'Add meal option' }).click()

    const row = page.getByRole('row', { name: new RegExp(label) })
    await expect(row.getByRole('cell', { name: 'Offered' })).toBeVisible()

    await row.getByRole('button', { name: 'Retire' }).click()

    // Still present — retiring deactivates, it never deletes, so no guest's
    // already-chosen meal is left pointing at a vanished row.
    await expect(row.getByRole('cell', { name: label })).toBeVisible()
    await expect(row.getByRole('cell', { name: 'Retired' })).toBeVisible()
  })

  test('refuses an uploaded file whose bytes are not actually an image', async ({ page }) => {
    await signInAsAdmin(page)
    await page.goto('/admin/event')

    // A renamed text file: the extension and declared type both say "image",
    // but inspectImage() decides from the leading bytes alone. This is the
    // case Task 11 exists for.
    await page.getByLabel(/Floorplan image/).setInputFiles({
      name: 'floorplan.png',
      mimeType: 'image/png',
      buffer: Buffer.from('this is plainly not image data'),
    })
    await page.getByRole('button', { name: 'Upload' }).click()

    await expect(
      page.getByRole('alert').filter({ hasText: 'expected a PNG, JPEG or WEBP' }),
    ).toBeVisible()
  })

  test('STAFF cannot reach /admin/event', async ({ page }) => {
    await signIn(page, STAFF_CREDENTIALS.email, STAFF_CREDENTIALS.password)
    await expect(page).toHaveURL(/\/admin\/checkin$/)

    await page.goto('/admin/event')
    await expect(page).toHaveURL(/\/admin\/checkin$/)
  })
})
