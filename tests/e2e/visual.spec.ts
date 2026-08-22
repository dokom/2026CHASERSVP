import { test, expect } from '@playwright/test'
import { E2E_GUEST_TOKEN } from './global-setup'
import { signIn } from './sign-in'
import { ADMIN_CREDENTIALS } from './global-setup'

const WIDTHS = [375, 768, 1440] as const
const SCHEMES = ['dark', 'light'] as const

for (const width of WIDTHS) {
  for (const scheme of SCHEMES) {
    test(`guest page — ${width}px, ${scheme}`, async ({ page }) => {
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

test('admin event screen — 1440px, dark', async ({ page }) => {
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
