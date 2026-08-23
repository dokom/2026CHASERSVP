import { test, expect, type Page, type TestInfo } from '@playwright/test'
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
async function tabTo(page: Page, target: ReturnType<Page['getByLabel']>, maxTabs = 60): Promise<void> {
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

  test('accepts, completes all five steps and submits using only Tab, Space, Enter and arrows', async (
    { page },
    testInfo,
  ) => {
    desktopOnly(testInfo)
    await page.goto(`/i/${token}`)

    // Step 1: Will you join us? — land on the (unchecked) radio group,
    // Space checks the first option, then Tab moves past the whole group
    // (native roving-tabindex radio behaviour) to Continue.
    await tabTo(page, page.getByLabel('Joyfully accepts'))
    await page.keyboard.press('Space')
    await expect(page.getByLabel('Joyfully accepts')).toBeChecked()
    await tabTo(page, page.getByRole('button', { name: 'Continue' }))
    await page.keyboard.press('Enter')
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2')

    // Step 2: who's coming. The one guest field set is pre-filled from the
    // invite's own guest record (defaultValue), satisfying the required
    // first/last name validation without retyping anything — a keyboard
    // user reviewing their own invitation would see the same. The
    // "Continue" button is the same DOM node across steps 1-4 (only its
    // surrounding step content toggles `hidden`), so it keeps focus and
    // Enter alone advances through each of them.
    await expect(page.getByLabel('First name').first()).toHaveValue('Sasha')
    await expect(page.getByLabel('Last name').first()).toHaveValue('Vale')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3')

    // Step 3: extra seats (seatsRemaining is 0 on a single-seat invite, so
    // this is the request panel, not the "add another guest" button — both
    // its fields are optional).
    await page.keyboard.press('Enter')
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '4')

    // Step 4: review, then advance to step 5. React reconciles the
    // "Continue"/"Send response" button as the same DOM node in both
    // branches of rsvp-form.tsx's step<STEP_COUNT ternary (same element
    // type at the same tree position), so it keeps focus straight through
    // this swap too — no re-navigation needed.
    await page.keyboard.press('Enter')
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5')

    // Step 5: submit — the button under focus is now the type="submit"
    // "Send response" control; Enter activates it exactly as it did at
    // every prior step.
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('rsvp-confirmed')).toContainText('look forward')
  })
})
