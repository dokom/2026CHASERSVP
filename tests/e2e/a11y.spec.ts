import { test, expect, type Page, type TestInfo, type Locator } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { PrismaClient } from '@prisma/client'
import { createInvite } from '../../src/lib/invites/repository'
import { E2E_GUEST_TOKEN, ADMIN_CREDENTIALS, STAFF_CREDENTIALS } from './global-setup'
import { E2E_DATABASE_URL } from '../../playwright.config'
import { signIn } from './sign-in'

// See checkin.spec.ts's identical helper: this file's keyboard-RSVP test
// submits a real RSVP against its own dedicated invite, so a second pass
// under 'mobile' would submit it twice against an invite that only
// tolerates one submission cleanly (the second would just re-declare/
// re-accept, which is harmless but doubles run time for zero signal).
function desktopOnly(testInfo: TestInfo): void {
  test.skip(testInfo.project.name !== 'desktop', 'own fixture — runs once, not once per project')
}

/**
 * Runs axe, and on failure prints every violation's id, impact and first
 * offending node so a CI log is actionable without re-running locally.
 */
async function assertNoViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  if (results.violations.length > 0) {
    const details = results.violations
      .map((v) => `  ${v.id} [${v.impact}] ${v.nodes[0]?.html ?? '(no node)'}`)
      .join('\n')
    console.log(`axe violations on ${label}:\n${details}`)
  }
  expect(results.violations, `axe violations on ${label}`).toEqual([])
}

/** Presses Tab until `target` is focused, failing loudly if focus is ever lost to <body>. */
async function tabTo(page: Page, target: Locator, maxTabs = 60): Promise<void> {
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab')
    const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? null)
    expect(activeTag, 'focus was lost to <body> after a Tab press').not.toBe('BODY')
    const onTarget = await target.evaluate((el) => el === document.activeElement).catch(() => false)
    if (onTarget) return
  }
  throw new Error('tabTo: exhausted max Tab presses without reaching the target')
}

test.describe('accessibility — axe scans', () => {
  test('guest page, full motion', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto(`/i/${E2E_GUEST_TOKEN}`)
    await expect(page.locator('[data-motion]')).toHaveAttribute('data-motion', 'full')
    await page.waitForLoadState('networkidle')
    await assertNoViolations(page, 'guest page (full motion)')
  })

  test('guest page, reduced motion', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`/i/${E2E_GUEST_TOKEN}`)
    await expect(page.locator('[data-motion]')).toHaveAttribute('data-motion', 'reduced')
    await page.waitForLoadState('networkidle')
    await assertNoViolations(page, 'guest page (reduced motion)')
  })

  test('login', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await page.goto('/admin/login')
    await assertNoViolations(page, 'login')
  })

  test('dashboard', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await signIn(page, ADMIN_CREDENTIALS.email, ADMIN_CREDENTIALS.password)
    await expect(page).toHaveURL(/\/admin$/)
    await assertNoViolations(page, 'dashboard')
  })

  test('invites', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await signIn(page, ADMIN_CREDENTIALS.email, ADMIN_CREDENTIALS.password)
    await expect(page).toHaveURL(/\/admin$/)
    await page.goto('/admin/invites')
    await assertNoViolations(page, 'invites')
  })

  test('event', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await signIn(page, ADMIN_CREDENTIALS.email, ADMIN_CREDENTIALS.password)
    await expect(page).toHaveURL(/\/admin$/)
    await page.goto('/admin/event')
    await assertNoViolations(page, 'event')
  })

  test('check-in', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await signIn(page, STAFF_CREDENTIALS.email, STAFF_CREDENTIALS.password)
    await expect(page).toHaveURL(/\/admin\/checkin$/)
    await assertNoViolations(page, 'check-in')
  })
})

test.describe('accessibility — keyboard-only RSVP', () => {
  // A dedicated single-seat invite this file owns end to end, so submitting
  // a real RSVP by keyboard never mutates the E2E_GUEST_TOKEN party that
  // guest-rsvp.spec.ts and motion.spec.ts each assume starts PENDING.
  let token: string

  test.beforeAll(async () => {
    const prisma = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } })
    try {
      const created = await createInvite(prisma, null, {
        label: `E2E Keyboard RSVP ${Date.now()}`,
        seatsAllotted: 1,
        primaryGuest: { firstName: 'Sasha', lastName: 'Vale' },
      })
      token = created.token
    } finally {
      await prisma.$disconnect()
    }
  })

  test('accepts and confirms using only Tab, Space and Enter', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await page.goto(`/i/${token}`)

    // The party is listed by name; nothing is typed. The chips are real
    // radios (visually hidden inputs inside styled labels), so Tab lands on
    // the unchecked group, Space checks the first option, and Tab then
    // moves past the whole group (native roving-tabindex behaviour).
    await expect(page.getByTestId('guest-response').first()).toContainText('Sasha Vale')
    const coming = page.getByRole('radio', { name: 'Coming' }).first()
    await tabTo(page, coming)
    await page.keyboard.press('Space')
    await expect(coming).toBeChecked()

    // Confirm is disabled until every seat has an answer; on this
    // single-seat invite one answer is enough, and Enter submits.
    const confirm = page.getByRole('button', { name: 'Confirm response' })
    await expect(confirm).toBeEnabled()
    await tabTo(page, confirm)
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('rsvp-confirmed')).toContainText('look forward')
  })
})

test.describe('accessibility — keyboard-only scanner', () => {
  // The reviewer's note was specific: the scanner's KEYBOARD path (as
  // opposed to its camera/QR path, which no test can drive) is never
  // exercised — a staff member who cannot or does not want to use the
  // camera relies entirely on Tab/type/Enter/Space to resolve a party and
  // check a guest in. This needs its own dedicated invite, the same way
  // the keyboard-RSVP block above does: tapping a guest here must never
  // touch E2E_CHECKIN_TOKEN's Morgan/Casey/Dana, whose untouched
  // checkedInAt state checkin.spec.ts's own assertions depend on.
  let scannerToken: string
  const SCANNER_GUEST_FIRST_NAME = 'Quinn'

  test.beforeAll(async () => {
    const prisma = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } })
    try {
      const created = await createInvite(prisma, null, {
        label: `E2E Keyboard Scanner ${Date.now()}`,
        seatsAllotted: 1,
        primaryGuest: { firstName: SCANNER_GUEST_FIRST_NAME, lastName: 'Ames' },
      })
      // Check-in only applies to a guest actually coming — set the same
      // way global-setup does for its own check-in party.
      await prisma.guest.updateMany({ where: { inviteId: created.invite.id }, data: { attending: true } })
      scannerToken = created.token
    } finally {
      await prisma.$disconnect()
    }
  })

  test('resolves a party and checks a guest in using only Tab, typing, Enter and Space', async (
    { page },
    testInfo,
  ) => {
    desktopOnly(testInfo)
    await signIn(page, STAFF_CREDENTIALS.email, STAFF_CREDENTIALS.password)
    await expect(page).toHaveURL(/\/admin\/checkin$/)

    // The exact link shape the QR code would encode — see checkin.spec.ts's
    // CHECKIN_URL for why (extractToken() only accepts this shape).
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
    const scannerUrl = `${appUrl}/i/${scannerToken}`

    const linkInput = page.getByLabel('Invitation link')
    await tabTo(page, linkInput)
    await page.keyboard.type(scannerUrl)
    // No <form> to submit (C2) — the input's own onKeyDown handles Enter,
    // which is exactly what a keyboard-only staff member has: no mouse to
    // click "Find" with.
    await page.keyboard.press('Enter')

    const guestButton = page.getByRole('button', { name: new RegExp(SCANNER_GUEST_FIRST_NAME) })
    await expect(guestButton).toBeVisible()

    // Tab from the still-focused input, through the "Find" button, to the
    // first (only) guest row, then Space — the native way to activate a
    // button by keyboard — checks them in exactly as a tap would.
    await tabTo(page, guestButton)
    await page.keyboard.press('Space')
    await expect(guestButton).toContainText('tap to undo')
  })
})
