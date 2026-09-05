import { test, expect, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { createInvite, listInviteTokens } from '../../src/lib/invites/repository'
import { createPlaceholderInvites } from '../../src/lib/invites/placeholders'
import { E2E_GUEST_TOKEN } from './global-setup'
import { E2E_DATABASE_URL } from '../../playwright.config'

// Covers the unauthenticated /i/[token] guest portal: an anonymous visitor
// with the right link sees their invitation, says who is coming with a tap
// per name, and nothing about the token itself leaks. See
// tests/e2e/global-setup.ts for how E2E_GUEST_TOKEN is seeded — via
// createInvite(), the real path, not a hand-rolled row.

/**
 * A party this test owns end to end. Unanswered by default; `confirmed`
 * marks the primary guest as coming, which (with seating released by
 * global-setup) is what unlocks the seat map.
 */
async function freshInviteToken(
  label: string,
  options: { confirmed?: boolean; tableNumber?: string } = {},
): Promise<string> {
  const prisma = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } })
  try {
    const created = await createInvite(prisma, null, {
      label,
      seatsAllotted: 1,
      tableNumber: options.tableNumber,
      primaryGuest: { firstName: 'Noor', lastName: 'Haddad' },
    })
    if (options.confirmed) {
      await prisma.guest.updateMany({ where: { inviteId: created.invite.id }, data: { attending: true } })
      await prisma.invite.update({ where: { id: created.invite.id }, data: { status: 'ATTENDING' } })
    }
    return created.token
  } finally {
    await prisma.$disconnect()
  }
}

/** A numbered placeholder straight off the printer: a token, but nobody attached yet. */
async function freshPlaceholderToken(): Promise<string> {
  const prisma = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } })
  try {
    const { lastNumber } = await createPlaceholderInvites(prisma, null, { count: 1, seatsAllotted: 1 })
    const [row] = await listInviteTokens(prisma, { number: lastNumber })
    if (!row) throw new Error('placeholder token not recoverable')
    return row.token
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

  test('a confirmed guest sees the table and its marker on the floorplan', async ({ page }, testInfo) => {
    const token = await freshInviteToken(`E2E Seated ${testInfo.project.name} ${Date.now()}`, {
      confirmed: true, tableNumber: '12',
    })
    await page.goto(`/i/${token}`)
    await expect(page.getByText(/You.re at/)).toBeVisible()
    await expect(page.locator('[data-countdown]')).toHaveCount(0)
  })

  test('an unconfirmed guest sees a countdown where the seat will be', async ({ page }, testInfo) => {
    const token = await freshInviteToken(`E2E Unseated ${testInfo.project.name} ${Date.now()}`, {
      tableNumber: '12',
    })
    await page.goto(`/i/${token}`)
    await expect(page.locator('[data-seat-pending="NOT_CONFIRMED"]')).toBeVisible()
    await expect(page.getByText(/Confirm you are coming/)).toBeVisible()
    await expect(page.getByText(/You.re at/)).toHaveCount(0)
    await expect(page.locator('[data-seat-map-viewport]')).toHaveCount(0)

    // The countdown is live: the seconds digit moves.
    const seconds = page.locator('[data-countdown-unit="seconds"]')
    await expect(seconds).toBeVisible()
    const before = await seconds.textContent()
    await expect(seconds).not.toHaveText(before ?? '', { timeout: 3_000 })
  })

  test('a printed placeholder greets by number and holds the RSVP until someone is assigned', async ({ page }) => {
    const token = await freshPlaceholderToken()
    await page.goto(`/i/${token}`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Welcome/)
    await expect(page.locator('[data-guest-name]')).toHaveText(/^\d{3,}$/)
    await expect(page.getByTestId('invite-unassigned')).toBeVisible()
    await expect(page.getByTestId('guest-response')).toHaveCount(0)
    await expect(page.locator('[data-countdown]')).toBeVisible()
  })

  test('the floorplan opens full screen on a tap and closes on the next', async ({ page }, testInfo) => {
    const token = await freshInviteToken(`E2E Fullscreen ${testInfo.project.name} ${Date.now()}`, {
      confirmed: true, tableNumber: '12',
    })
    await page.goto(`/i/${token}`)
    await page.locator('[data-seat-map-viewport]').click()
    const overlay = page.locator('[data-seat-map-fullscreen]')
    await expect(overlay).toBeVisible()
    // Full screen means the viewport, not the frame the plan sat in...
    const box = await overlay.boundingBox()
    const viewport = page.viewportSize()!
    expect(box?.width).toBe(viewport.width)
    expect(box?.height).toBe(viewport.height)
    // ...and on top of everything: a fixed overlay caught inside one of the
    // motion layer's transformed ancestors is the same size but paints
    // underneath the sections after it, which then swallow the closing tap.
    const topmostIsOverlay = await page.evaluate(() => {
      const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2)
      return !!hit?.closest('[data-seat-map-fullscreen]')
    })
    expect(topmostIsOverlay, 'the fullscreen overlay must be the topmost element').toBe(true)

    // The plan itself is the exit control: tap it, not a separate button.
    await overlay.locator('img').click()
    await expect(overlay).toHaveCount(0)
    await expect(page.locator('[data-seat-map-viewport]')).toBeFocused()
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
    await bring.click()
    await expect(page.getByTestId('guest-response').last()).toContainText('Guest of Riley')
    await setEveryone(page, true)
    await confirm(page)
    await expect(page.getByTestId('rsvp-confirmed')).toContainText('look forward')
  })

  test('a guest can bring five companions and name them', async ({ page }, testInfo) => {
    const token = await freshInviteToken(`E2E Big Party ${testInfo.project.name} ${Date.now()}`)
    await page.goto(`/i/${token}`)
    const bring = page.getByRole('button', { name: /Bring a guest/ })
    for (let i = 0; i < 5; i++) {
      await expect(bring).toBeVisible()
      await bring.click()
    }
    await expect(page.getByTestId('guest-response')).toHaveCount(6)
    // The button never disappears: there is no allowance to run out of.
    await expect(bring).toBeVisible()

    const lastRow = page.getByTestId('companion-row').last()
    await lastRow.getByLabel('First name (optional)').fill('Sam')
    await lastRow.getByLabel('Last name (optional)').fill('Haddad')

    await setEveryone(page, true)
    await confirm(page)
    await expect(page.getByTestId('rsvp-confirmed')).toContainText('look forward')

    await page.reload()
    const rows = page.getByTestId('guest-response')
    await expect(rows).toHaveCount(6)
    await expect(rows.last()).toContainText('Sam Haddad')
    await expect(rows.nth(1)).toContainText('Guest of Noor')
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
