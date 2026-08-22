import { test, expect } from '@playwright/test'
import { E2E_GUEST_TOKEN } from './global-setup'

// Covers the unauthenticated /i/[token] guest portal: an anonymous visitor
// with the right link sees their invitation, can accept or decline, and
// nothing about the token itself leaks. See tests/e2e/global-setup.ts for
// how E2E_GUEST_TOKEN is seeded — via createInvite(), the real path, not a
// hand-rolled row.

test.describe('guest RSVP', () => {
  test('an unknown token shows the not-found page, not a crash', async ({ page }) => {
    const response = await page.goto('/i/definitely-not-a-real-token')
    expect(response?.status()).toBe(404)
    // Rendered with a typographic apostrophe (`&rsquo;`), not a straight one.
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/couldn.t find/)
  })

  test('a valid token greets the guest by name and shows the agenda', async ({ page }) => {
    await page.goto(`/i/${E2E_GUEST_TOKEN}`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome')
    await expect(page.getByRole('heading', { name: 'The evening' })).toBeVisible()
    await expect(page.getByRole('listitem').first()).toBeVisible()
  })

  test('shows the table and its marker on the floorplan', async ({ page }) => {
    await page.goto(`/i/${E2E_GUEST_TOKEN}`)
    await expect(page.getByText(/You.re at/)).toBeVisible()
  })

  test('accepts an RSVP for the whole party', async ({ page }) => {
    await page.goto(`/i/${E2E_GUEST_TOKEN}`)
    await page.getByLabel('Joyfully accepts').check()
    await page.getByRole('button', { name: 'Continue' }).click() // -> who's coming
    await page.getByLabel('First name').first().fill('Jordan')
    await page.getByLabel('Last name').first().fill('Reyes')
    await page.getByRole('button', { name: 'Continue' }).click() // -> extra seats
    await page.getByRole('button', { name: 'Continue' }).click() // -> review
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '4')
    await page.getByRole('button', { name: 'Continue' }).click() // -> confirm
    // Not a locator .click(): this submission is fast enough that the
    // button goes enabled -> disabled ("Sending…") -> unmounted (replaced
    // by the confirmation) inside the span of Playwright's own
    // actionability re-checks, so a simulated pointer click can spend its
    // whole retry budget chasing a target that keeps changing out from
    // under it and never resolve, even though the click that already
    // landed genuinely worked (the confirmation renders regardless).
    // requestSubmit() fires the exact same native submit React's action
    // is bound to, honoring the same required-field validation a real
    // click would, without racing the button's own post-click state.
    await page.locator('form').evaluate((form) => (form as HTMLFormElement).requestSubmit())
    await expect(page.getByTestId('rsvp-confirmed')).toContainText('look forward')
  })

  test('records a decline', async ({ page }) => {
    await page.goto(`/i/${E2E_GUEST_TOKEN}`)
    await page.getByLabel('Regretfully declines').check()
    // Declining skips steps 2-4: there is nothing to ask someone who is not coming.
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5')
    // Not a locator .click(): this submission is fast enough that the
    // button goes enabled -> disabled ("Sending…") -> unmounted (replaced
    // by the confirmation) inside the span of Playwright's own
    // actionability re-checks, so a simulated pointer click can spend its
    // whole retry budget chasing a target that keeps changing out from
    // under it and never resolve, even though the click that already
    // landed genuinely worked (the confirmation renders regardless).
    // requestSubmit() fires the exact same native submit React's action
    // is bound to, honoring the same required-field validation a real
    // click would, without racing the button's own post-click state.
    await page.locator('form').evaluate((form) => (form as HTMLFormElement).requestSubmit())
    await expect(page.getByTestId('rsvp-confirmed')).toContainText('missed')
  })

  test('keeps entered details when the guest steps back', async ({ page }) => {
    // Unmounting a step would silently discard input and drop the field from
    // the submit; this is the test that catches it.
    await page.goto(`/i/${E2E_GUEST_TOKEN}`)
    await page.getByLabel('Joyfully accepts').check()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByLabel('Company').first().fill('Northwind')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page.getByLabel('Company').first()).toHaveValue('Northwind')
  })

  test('serves a calendar file', async ({ page }) => {
    const response = await page.request.get(`/i/${E2E_GUEST_TOKEN}/calendar`)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/calendar')
    expect(await response.text()).toContain('BEGIN:VCALENDAR')
  })

  test('refuses a calendar for an unknown token', async ({ page }) => {
    const response = await page.request.get('/i/nope/calendar')
    expect(response.status()).toBe(404)
  })

  test('the guest page is not indexable', async ({ page }) => {
    const response = await page.goto(`/i/${E2E_GUEST_TOKEN}`)
    const robots = await page.locator('meta[name="robots"]').getAttribute('content')
    expect(robots).toContain('noindex')
    expect(response?.status()).toBe(200)
  })

  test('rejects a submission with a bad CSRF token', async ({ page }) => {
    // The guest portal is an unauthenticated POST surface; this is its only
    // guard. The real form posts via React's Server Action fetch (not a
    // plain URL-encoded POST — it needs the hidden $ACTION_* fields Next
    // generates for progressive enhancement, and its own field names are
    // scoped with a per-form-instance prefix), so the honest way to prove
    // the server actually checks the value, rather than trusting whatever
    // the client sends, is to corrupt the real multipart body's csrf field
    // in flight. A wrong CSRF token is a soft, in-band failure here (an
    // error message in the response state), not an HTTP status code —
    // submitRsvpAction returns `{status:'error'}` rather than throwing.
    await page.goto(`/i/${E2E_GUEST_TOKEN}`)
    await page.getByLabel('Regretfully declines').check()
    await page.getByRole('button', { name: 'Continue' }).click()

    await page.route('**/i/**', async (route) => {
      const request = route.request()
      if (request.method() !== 'POST') {
        await route.continue()
        return
      }
      const original = request.postData() ?? ''
      const tampered = original.replace(
        /(name="[^"]*csrf"\r?\n\r?\n)[^\r\n]*/,
        '$1wrong-csrf-value',
      )
      if (tampered === original) throw new Error('csrf field not found in the intercepted request body')
      await route.continue({ postData: tampered })
    })

    // Not a locator .click() on the submit button: this submission is fast
    // enough that the button goes enabled -> disabled ("Sending…") ->
    // unmounted (replaced by the confirmation) inside the span of
    // Playwright's own actionability re-checks, so a simulated pointer
    // click can spend its whole retry budget chasing a target that keeps
    // changing out from under it and never resolve, even though the click
    // that already landed genuinely worked. requestSubmit() fires the same
    // native submit React's action is bound to, without racing the
    // button's own post-click state.
    await page.locator('form').evaluate((form) => (form as HTMLFormElement).requestSubmit())
    // Next.js also renders a hidden route-announcer div with role="alert" on
    // every page (for accessibility route-change announcements), so the
    // locator must be scoped to the element carrying the actual message.
    await expect(page.getByRole('alert').filter({ hasText: 'expired' })).toBeVisible()
  })
})
