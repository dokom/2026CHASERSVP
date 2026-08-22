import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { E2E_GUEST_TOKEN } from './global-setup'
import { signIn } from './sign-in'
import { ADMIN_CREDENTIALS } from './global-setup'
import { E2E_DATABASE_URL } from '../../playwright.config'

const WIDTHS = [375, 768, 1440] as const
const SCHEMES = ['dark', 'light'] as const

/**
 * guest-rsvp.spec.ts, event-config.spec.ts and motion.spec.ts all mutate
 * the single fixture invite/guest/event global-setup seeds once per run,
 * and never revert it — each of those specs only asserts on behavior, so
 * an accumulating name change, event rename or extra agenda item is
 * invisible to them. This suite is the first to assert pixel-for-pixel, so
 * it restores the fixture to its as-seeded values immediately before
 * capturing, making the screenshots independent of whichever specs already
 * ran earlier in this worker/project pass.
 */
async function restoreFixtureState(): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } })
  try {
    const invite = await prisma.invite.findFirstOrThrow({ where: { label: 'E2E Guest Party' } })
    await prisma.guest.deleteMany({ where: { inviteId: invite.id } })
    await prisma.guest.create({
      data: { inviteId: invite.id, firstName: 'Riley', lastName: 'Chen', isPrimary: true },
    })
    await prisma.invite.update({
      where: { id: invite.id },
      data: {
        status: 'PENDING',
        respondedAt: null,
        extraSeatsRequested: 0,
        extraSeatsStatus: 'NONE',
      },
    })

    const event = await prisma.event.findFirstOrThrow()
    await prisma.event.update({ where: { id: event.id }, data: { name: 'The Grand Gala' } })
    await prisma.agendaItem.deleteMany({ where: { eventId: event.id } })
    await prisma.agendaItem.createMany({
      data: [
        {
          eventId: event.id,
          title: 'Cocktail Reception',
          startsAt: new Date(event.startsAt.getTime() - 60 * 60 * 1000),
          sortOrder: 0,
        },
        { eventId: event.id, title: 'Dinner & Dancing', startsAt: event.startsAt, sortOrder: 1 },
      ],
    })
  } finally {
    await prisma.$disconnect()
  }
}

test.beforeAll(restoreFixtureState)

/**
 * Every test below pins its own pixel dimensions with page.setViewportSize
 * — the whole point of a visual regression suite that asserts specific
 * breakpoints. setViewportSize overrides the viewport but NOT the device
 * scale factor or UA that playwright.config.ts's 'mobile' (Pixel 7) and
 * 'desktop' (Desktop Chrome) projects otherwise set up, and nothing this
 * page renders is conditioned on touch/hover/UA — so both projects were
 * producing byte-identical PNGs (md5-verified) for every one of these
 * tests, just under two different filenames. Keep 'desktop' (DSF 1,
 * non-touch — the standard project) as the single source of truth and skip
 * the redundant run rather than doubling CI time and the snapshot count for
 * zero additional signal.
 */
function skipRedundantProject(testInfo: import('@playwright/test').TestInfo): void {
  test.skip(
    testInfo.project.name !== 'desktop',
    'byte-identical to the desktop baseline — see comment above skipRedundantProject',
  )
}

for (const width of WIDTHS) {
  for (const scheme of SCHEMES) {
    test(`guest page — ${width}px, ${scheme}`, async ({ page }, testInfo) => {
      skipRedundantProject(testInfo)
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme })
      await page.goto(`/i/${E2E_GUEST_TOKEN}`)
      await expect(page.locator('[data-motion]')).toHaveAttribute('data-motion', 'reduced')
      await page.waitForLoadState('networkidle')
      await expect(page).toHaveScreenshot(`guest-${width}-${scheme}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
      })
    })
  }
}

/**
 * Every baseline above pins prefers-reduced-motion: reduce, so no pixel test
 * ever renders a running timeline — a real defect in a scroll trigger, an
 * easing curve, or a one-shot reveal's final frame could regress invisibly.
 * This is the one full-motion baseline: no reduced-motion override, scrolled
 * to the bottom and settled so the one-shot reveals (name letters, seal
 * break, agenda stagger) have finished before the shot. The foil hero lives
 * at the top of the page and pauses its rAF loop once scrolled off-screen
 * (see foil-scene.tsx's IntersectionObserver gate), so the bottom of the
 * page is the deterministic frame to capture in full motion.
 */
test('guest page — 375px, dark, full motion', async ({ page }, testInfo) => {
  skipRedundantProject(testInfo)
  await page.setViewportSize({ width: 375, height: 900 })
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' })
  await page.goto(`/i/${E2E_GUEST_TOKEN}`)
  await expect(page.locator('[data-motion]')).toHaveAttribute('data-motion', 'full')
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(1200)
  await expect(page).toHaveScreenshot('guest-375-dark-full-motion.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  })
})

test('admin event screen — 1440px, dark', async ({ page }, testInfo) => {
  skipRedundantProject(testInfo)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' })
  await signIn(page, ADMIN_CREDENTIALS.email, ADMIN_CREDENTIALS.password)
  // Wait for the post-login redirect to land before navigating away — the
  // sign-in click resolves as soon as it's actionable, not once the session
  // cookie is actually set, so an immediate goto() can race it (see
  // event-config.spec.ts's signInAsAdmin for the same wait).
  await expect(page).toHaveURL(/\/admin$/)
  await page.goto('/admin/event')
  // Not networkidle: the admin nav's next/link prefetching keeps a
  // background request open long enough that networkidle times out at 30s
  // even though the page itself has fully rendered (confirmed by screenshot
  // during debugging) — wait for the page's own content instead.
  await expect(page.getByRole('heading', { name: 'Event' })).toBeVisible()
  await expect(page).toHaveScreenshot('admin-event-1440-dark.png', { maxDiffPixelRatio: 0.01 })
})
