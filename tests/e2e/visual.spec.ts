import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { E2E_GUEST_TOKEN } from './global-setup'
import { signIn } from './sign-in'
import { ADMIN_CREDENTIALS } from './global-setup'
import { E2E_DATABASE_URL } from '../../playwright.config'

const WIDTHS = [375, 768, 1440] as const
const SCHEMES = ['dark', 'light'] as const

// The only two invites global-setup itself creates (see its two
// createInvite() calls) — everything else in the database by the time
// visual.spec.ts runs is a byproduct of some earlier spec's own fixture
// (a11y.spec.ts's per-test RSVP/scanner invites, dashboard.spec.ts's
// declined-invite fixture, invites/csv-import/admin-users's ad-hoc rows).
const SEEDED_INVITE_LABELS = ['E2E Guest Party', 'E2E Checkin Party'] as const

/**
 * I8: the admin dashboard's stat tiles (Invited/Responded/Coming/Arrived)
 * are computed over EVERY invite and guest in the database, not just this
 * suite's own fixture — so the dashboard baseline used to encode whatever
 * state earlier specs happened to leave behind (an "Arrived 1" that was
 * only ever true by accident of which spec ran last). Deleting every
 * invite (and its guests) this run didn't seed, and resetting the two
 * seeded parties back to their as-seeded shape, makes those numbers a
 * property of this function alone — identical on every run, in any order,
 * regardless of what admin-users/csv-import/invites/dashboard/a11y do to
 * their own disposable invites earlier in the pass.
 */
async function pruneStrayInvites(prisma: PrismaClient): Promise<void> {
  const stray = await prisma.invite.findMany({
    where: { label: { notIn: [...SEEDED_INVITE_LABELS] } },
    select: { id: true },
  })
  if (stray.length === 0) return
  const strayIds = stray.map((i) => i.id)
  await prisma.guest.deleteMany({ where: { inviteId: { in: strayIds } } })
  await prisma.invite.deleteMany({ where: { id: { in: strayIds } } })
}

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
    await pruneStrayInvites(prisma)

    const invite = await prisma.invite.findFirstOrThrow({ where: { label: 'E2E Guest Party' } })
    await prisma.guest.deleteMany({ where: { inviteId: invite.id } })
    // Riley is pinned as CONFIRMED (not merely reset to unanswered): the
    // seat map only renders for a confirmed guest once seating is released,
    // and the guest-page baselines exist to catch regressions in that map.
    // An unconfirmed Riley would render the live countdown instead — a
    // ticking clock is unscreenshotable — and the map would go untested.
    await prisma.guest.create({
      data: { inviteId: invite.id, firstName: 'Riley', lastName: 'Chen', isPrimary: true, attending: true },
    })
    await prisma.invite.update({
      where: { id: invite.id },
      data: {
        status: 'ATTENDING',
        respondedAt: new Date('2026-08-01T12:00:00Z'),
      },
    })

    // I8: E2E Checkin Party's three guests (Morgan/Casey/Dana) are the
    // fixture checkin.spec.ts taps, undoes and re-taps, and Dana starts
    // seeded as already-arrived — none of that is stable enough to build
    // a pixel baseline on. Reset every guest under it to its as-seeded
    // shape: attending (all three are coming) and never checked in,
    // regardless of what checkin.spec.ts's own tests did to them earlier
    // in this same run.
    const checkinInvite = await prisma.invite.findFirstOrThrow({ where: { label: 'E2E Checkin Party' } })
    await prisma.guest.updateMany({
      where: { inviteId: checkinInvite.id },
      data: { attending: true, checkedInAt: null, checkedInById: null },
    })

    const event = await prisma.event.findFirstOrThrow()
    // Pin the time-of-day, not just the date: global-setup seeds startsAt as
    // `Date.now() + 7 days`, preserving whatever hour the suite happens to
    // run at. The guest page prints "Saturday, August 29, 2026 at H:MM PM"
    // on one line at 375px only when the hour renders as a single digit —
    // 18:00 UTC is 1-2 PM in America/New_York across both EST and EDT, so
    // this never wraps regardless of when in the day the suite runs. Only
    // this pixel-perfect suite needs that guarantee; every other spec only
    // depends on the date being roughly a week out, which this preserves.
    const fixedStartsAt = new Date(Date.UTC(
      event.startsAt.getUTCFullYear(), event.startsAt.getUTCMonth(), event.startsAt.getUTCDate(),
      18, 0, 0, 0,
    ))
    await prisma.event.update({
      where: { id: event.id },
      // Seating released (event-config.spec.ts toggles it off and back on;
      // pin it here so the guest baselines never depend on that order), at
      // a fixed instant so the admin event screen's "released on …" line
      // renders identically every run.
      data: { name: 'The Grand Gala', startsAt: fixedStartsAt, seatsReleasedAt: new Date('2026-08-01T12:00:00Z') },
    })
    await prisma.agendaItem.deleteMany({ where: { eventId: event.id } })
    await prisma.agendaItem.createMany({
      data: [
        {
          eventId: event.id,
          title: 'Cocktail Reception',
          startsAt: new Date(fixedStartsAt.getTime() - 60 * 60 * 1000),
          sortOrder: 0,
        },
        { eventId: event.id, title: 'Dinner & Dancing', startsAt: fixedStartsAt, sortOrder: 1 },
      ],
    })
  } finally {
    await prisma.$disconnect()
  }
}

// Guarded by project, not just by which tests end up skipping: a file-level
// beforeAll runs once per project regardless of whether the tests inside it
// call test.skip() on themselves (skipRedundantProject only fires INSIDE
// each test body, after beforeAll has already run). Both mobile and desktop
// share the one e2e database, and mobile's pass through this file finishes
// well before desktop's checkin.spec.ts run — so an unguarded beforeAll
// would reset E2E Checkin Party's guests (including Dana's seeded arrival)
// during mobile's pass, hours before desktop's checkin tests ever look at
// them, corrupting a fixture this file has no tests actually exercising on
// mobile. Running the restore only on the project whose tests need it
// keeps the fixture reset adjacent, in time, to the assertions that depend
// on it.
test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'desktop') return
  await restoreFixtureState()
})

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

test('admin event screen — 1440px, light', async ({ page }, testInfo) => {
  skipRedundantProject(testInfo)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' })
  await signIn(page, ADMIN_CREDENTIALS.email, ADMIN_CREDENTIALS.password)
  await expect(page).toHaveURL(/\/admin$/)
  await page.goto('/admin/event')
  // Not networkidle — see the dark baseline above for why.
  await expect(page.getByRole('heading', { name: 'Event' })).toBeVisible()
  await expect(page).toHaveScreenshot('admin-event-1440-light.png', { maxDiffPixelRatio: 0.01 })
})

test('admin dashboard — 1440px, dark', async ({ page }, testInfo) => {
  skipRedundantProject(testInfo)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' })
  await signIn(page, ADMIN_CREDENTIALS.email, ADMIN_CREDENTIALS.password)
  await expect(page).toHaveURL(/\/admin$/)
  // Not networkidle — see the event screen baseline above for why.
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  // I8: assert the numbers themselves, not just the pixels. After
  // restoreFixtureState() above, exactly two invites exist (E2E Guest
  // Party, ATTENDING with Riley confirmed so the seat map renders — E2E
  // Checkin Party, PENDING) and exactly four guests are marked attending
  // (Riley, Morgan/Casey/Dana), none checked in. A pixel diff alone would
  // happily "pass" against a re-recorded baseline that silently encodes
  // the wrong numbers again; asserting the values makes the baseline's
  // content, not just its bytes, part of what's checked.
  await expect(page.locator('[data-stat="Invited"]')).toHaveText('2')
  await expect(page.locator('[data-stat="Responded"]')).toHaveText('50%')
  await expect(page.locator('[data-stat="Coming"]')).toHaveText('4')
  await expect(page.locator('[data-stat="Arrived"]')).toHaveText('0')

  await expect(page).toHaveScreenshot('admin-dashboard-1440-dark.png', { maxDiffPixelRatio: 0.01 })
})
