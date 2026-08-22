import { test, expect } from '@playwright/test'
import { E2E_GUEST_TOKEN } from './global-setup'

const url = `/i/${E2E_GUEST_TOKEN}`

/** Collect every script URL the page requests. */
function trackScripts(page: import('@playwright/test').Page): Set<string> {
  const urls = new Set<string>()
  page.on('request', (req) => {
    if (req.resourceType() === 'script') urls.add(new URL(req.url()).pathname)
  })
  return urls
}

test.describe('motion safety rails', () => {
  test('reduced motion renders the final state with nothing animating', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(url)
    await expect(page.locator('[data-motion]')).toHaveAttribute('data-motion', 'reduced')

    // The name is fully visible immediately — no split, no stagger.
    const name = page.locator('[data-guest-name]')
    await expect(name).toBeVisible()
    expect(await name.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')

    // No WebGL layer at all.
    await expect(page.locator('canvas')).toHaveCount(0)

    // The agenda is fully revealed without scrolling.
    const items = page.locator('[data-agenda] > li')
    expect(await items.count()).toBeGreaterThan(0)
    for (const item of await items.all()) {
      expect(await item.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
    }
  })

  test('a low-tier device gets lite motion and never downloads three.js', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 })
    })
    const scripts = trackScripts(page)
    await page.goto(url)
    await expect(page.locator('[data-motion]')).toHaveAttribute('data-motion', 'lite')
    await page.waitForTimeout(1500)
    await expect(page.locator('canvas')).toHaveCount(0)

    // Capture the full-tier script set for comparison.
    const lite = new Set(scripts)
    const fullPage = await page.context().newPage()
    const fullScripts = trackScripts(fullPage)
    await fullPage.goto(url)
    await expect(fullPage.locator('[data-motion]')).toHaveAttribute('data-motion', 'full')
    await fullPage.waitForSelector('canvas')
    await fullPage.close()

    // Lite must request strictly fewer scripts than full: the three.js chunk
    // is the difference, and it must never be fetched on a low-tier visit.
    expect(fullScripts.size).toBeGreaterThan(lite.size)
    for (const s of lite) expect(fullScripts.has(s)).toBe(true)
  })

  test('full motion mounts the foil hero and draws the line to the end', async ({ page }) => {
    await page.goto(url)
    await expect(page.locator('[data-motion]')).toHaveAttribute('data-motion', 'full')
    await expect(page.locator('canvas[data-foil-hero]')).toHaveCount(1)

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(900)
    const drawn = await page.locator('[data-brass-line] path').evaluate((el) => {
      const offset = parseFloat(getComputedStyle(el).strokeDashoffset || '0')
      return Math.abs(offset) < 2
    })
    expect(drawn).toBe(true)
  })
  // If createDrawable expresses progress through stroke-dasharray rather than
  // dashoffset in this anime version, read whichever property it actually
  // animates — the contract is "fully drawn at the bottom", not a CSS name.

  test('the foil hero pauses when the tab is hidden', async ({ page }) => {
    await page.goto(url)
    await page.waitForSelector('canvas[data-foil-hero]')
    // Simulate the tab being hidden, then confirm no frame is requested.
    const framesWhileHidden = await page.evaluate(async () => {
      Object.defineProperty(document, 'hidden', { get: () => true, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      let frames = 0
      const original = window.requestAnimationFrame
      window.requestAnimationFrame = (cb) => { frames++; return original(cb) }
      await new Promise((r) => setTimeout(r, 400))
      window.requestAnimationFrame = original
      return frames
    })
    expect(framesWhileHidden).toBe(0)
  })

  test('never scrolls horizontally at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 })
    await page.goto(url)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('the RSVP still works end to end with motion on', async ({ page }) => {
    await page.goto(url)
    await page.getByLabel('Joyfully accepts').check()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByLabel('First name').first().fill('Jordan')
    await page.getByLabel('Last name').first().fill('Reyes')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.locator('form').first().evaluate((f: HTMLFormElement) => f.requestSubmit())
    await expect(page.getByTestId('rsvp-confirmed')).toContainText('look forward')
    await expect(page.locator('[data-sealed]')).toHaveCount(1)
  })
})
