import { test, expect, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { createInvite } from '../../src/lib/invites/repository'
import { E2E_GUEST_TOKEN } from './global-setup'
import { E2E_DATABASE_URL } from '../../playwright.config'

// Covers the unauthenticated /i/[token] guest portal: an anonymous visitor
// with the right link sees their invitation, says who is coming with a tap
// per name, and nothing about the token itself leaks. See
// tests/e2e/global-setup.ts for how E2E_GUEST_TOKEN is seeded — via
// createInvite(), the real path, not a hand-rolled row.

/** A party nobody has answered for yet, so the test owns its whole state. */
async function freshInviteToken(label: string): Promise<string> {
  const prisma = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } })
  try {
    const created = await createInvite(prisma, null, {
      label,
      seatsAllotted: 1,
      primaryGuest: { firstName: 'Noor', lastName: 'Haddad' },
    })
    return created.token
  } finally {
    await prisma.$disconnect()
  }
}

// Not a locator .click() on the submit button: this submission is fast
// enough that the button goes enabled -> disabled ("Sending…") -> unmounted
// (replaced by the confirmation) inside the span of Playwright's own
// actionability re-checks, so a simulated pointer click can spend its whole
// retry budget chasing a target that keeps changing out from under it and
// never resolve, even though the click that already landed genuinely worked.
// requestSubmit() fires the exact same native submit React's action is bound
// to, without racing the button's own post-click state.
async function confirm(page: Page) {
  await page.locator('form').evaluate((form) => (form as HTMLFormElement).requestSubmit())
}

/** Highlights (or un-highlights) every name in the party. */
async function setEveryone(page: Page, coming: boolean) {
  const rows = page.getByTestId('guest-response')
  const count = await rows.count()
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i)
    if ((await row.getAttribute('aria-pressed')) !== String(coming)) await row.click()
    await expect(row).toHaveAttribute('aria-pressed', String(coming))
  }
}

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

  test('the floorplan opens full screen on a tap and closes on the next', async ({ page }) => {
    await page.goto(`/i/${E2E_GUEST_TOKEN}`)
    await page.locator('[data-seat-map-viewport]').click()
    const overlay = page.locator('[data-seat-map-fullscreen]')
    await expect(overlay).toBeVisible()
    // Full screen means the viewport, not the frame the plan sat in.
    const box = await overlay.boundingBox()
    const viewport = page.viewportSize()!
    expect(box?.width).toBe(viewport.width)
    expect(box?.height).toBe(viewport.height)

    await page.getByRole('button', { name: 'Exit full screen' }).click()
    await expect(overlay).toHaveCount(0)
  })

  test('nothing to type: names only, nobody highlighted until tapped', async ({ page }, testInfo) => {
    // Its own invite: the shared fixture party may already carry an answer
    // from whichever project's submission test ran first.
    const token = await freshInviteToken(`E2E Unanswered ${testInfo.project.name} ${Date.now()}`)
    await page.goto(`/i/${token}`)
    const row = page.getByTestId('guest-response').first()
    await expect(row).toContainText('Noor Haddad')
    await expect(page.locator('form').getByRole('textbox')).toHaveCount(0)
    await expect(row).toHaveAttribute('aria-pressed', 'false')

    await row.click()
    await expect(row).toHaveAttribute('aria-pressed', 'true')
    await row.click()
    await expect(row).toHaveAttribute('aria-pressed', 'false')
  })

  test('accepts an RSVP for the whole party, including a companion', async ({ page }) => {
    await page.goto(`/i/${E2E_GUEST_TOKEN}`)
    // The fixture party has two seats and one known guest; the second seat is
    // taken with a tap and arrives already highlighted.
    const bring = page.getByRole('button', { name: /Bring a guest/ })
    if (await bring.isVisible()) {
      await bring.click()
      await expect(page.getByTestId('guest-response').last()).toContainText('Guest of Riley')
    }
    await setEveryone(page, true)
    await confirm(page)
    await expect(page.getByTestId('rsvp-confirmed')).toContainText('look forward')
  })

  test('remembers the answer on a return visit', async ({ page }) => {
    await page.goto(`/i/${E2E_GUEST_TOKEN}`)
    await setEveryone(page, true)
    await confirm(page)
    await expect(page.getByTestId('rsvp-confirmed')).toBeVisible()

    await page.reload()
    await expect(page.getByTestId('guest-response').first()).toHaveAttribute('aria-pressed', 'true')
  })

  test('records a decline', async ({ page }) => {
    await page.goto(`/i/${E2E_GUEST_TOKEN}`)
    await setEveryone(page, false)
    await confirm(page)
    await expect(page.getByTestId('rsvp-confirmed')).toContainText('missed')
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

    await confirm(page)
    // Next.js also renders a hidden route-announcer div with role="alert" on
    // every page (for accessibility route-change announcements), so the
    // locator must be scoped to the element carrying the actual message.
    await expect(page.getByRole('alert').filter({ hasText: 'expired' })).toBeVisible()
  })
})
