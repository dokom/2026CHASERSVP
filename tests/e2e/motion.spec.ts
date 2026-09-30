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

/** Count the animation frames the page requests over `durationMs`. */
function countFrames(page: import('@playwright/test').Page, durationMs: number): Promise<number> {
  return page.evaluate(async (duration) => {
    let frames = 0
    const original = window.requestAnimationFrame
    window.requestAnimationFrame = (cb) => { frames++; return original(cb) }
    await new Promise((r) => setTimeout(r, duration))
    window.requestAnimationFrame = original
    return frames
  }, durationMs)
}

/** Count the stage's WebGL draws over `durationMs` — the render loop's own
 * work, as distinct from anything else on the page that uses rAF. */
function countDraws(page: import('@playwright/test').Page, durationMs: number): Promise<number> {
  return page.evaluate(async (duration) => {
    let draws = 0
    const proto = WebGL2RenderingContext.prototype
    const original = proto.drawElementsInstanced
    proto.drawElementsInstanced = function (...args) { draws++; return original.apply(this, args) }
    await new Promise((r) => setTimeout(r, duration))
    proto.drawElementsInstanced = original
    return draws
  }, durationMs)
}

/** Long enough for the stage to glide from the first act to the last. */
const STAGE_SETTLE_MS = 2500

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
    // Lite must be a PROPER SUBSET of full — every script lite requests is
    // also requested by full — not just a smaller unrelated set.
    for (const s of lite) expect(fullScripts.has(s)).toBe(true)
    // And full must request at least one script lite never does (the
    // three.js chunk): size inequality plus subset already implies this
    // set is non-empty, but assert it directly so a future refactor that
    // breaks the subset property still fails loudly here, not just above.
    const fullOnly = [...fullScripts].filter((s) => !lite.has(s))
    expect(fullOnly.length).toBeGreaterThan(0)
  })

  test('full motion mounts the foil hero and draws the line to the end', async ({ page }) => {
    await page.goto(url)
    await expect(page.locator('[data-motion]')).toHaveAttribute('data-motion', 'full')
    await expect(page.locator('canvas[data-foil-hero]')).toHaveCount(1)

    const line = page.locator('[data-brass-line] path')

    // Anime v4's createDrawable proxies `draw` onto stroke-dasharray AND
    // stroke-dashoffset (see node_modules/animejs/dist/modules/svg/drawable.js).
    // For this draw range ('0 0' -> '0 1') the offset component is always
    // `v1 * -pathLength`, and v1 is 0 at BOTH ends of this range — so
    // strokeDashoffset never moves and asserting on it (the original bug)
    // passes even when the line never animates at all. The value that
    // actually carries progress is stroke-dasharray's first number (the
    // drawn-dash length), scaled against the element's own `pathLength`
    // attribute (which createDrawable sets to normalize progress to a
    // fixed unit regardless of the path's real on-screen length).
    const readDashLength = () => line.evaluate((el) => {
      // getComputedStyle serializes SVG length lists with a "px" suffix on
      // each value (e.g. "990.6px, 19.4px"), unlike the raw attribute
      // (e.g. "990.6 19.4") — parseFloat reads the leading number off
      // either form and ignores the rest, so one parse handles both.
      const dasharray = getComputedStyle(el).strokeDasharray || el.getAttribute('stroke-dasharray') || ''
      return parseFloat(dasharray) || 0
    })
    const pathLength = await line.evaluate((el) => Number(el.getAttribute('pathLength')) || 0)
    expect(pathLength).toBeGreaterThan(0)

    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(300)
    const dashAtTop = await readDashLength()

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(900)
    const dashAtBottom = await readDashLength()

    // Positive control: the value must actually have moved. A line that
    // never animates would report the same (or a static) dash length at
    // both scroll positions and fail here.
    expect(dashAtBottom).toBeGreaterThan(dashAtTop)
    // Undrawn near the top of the scroll-linked draw range...
    expect(dashAtTop).toBeLessThan(pathLength * 0.1)
    // ...and fully drawn by the bottom.
    expect(dashAtBottom).toBeGreaterThan(pathLength * 0.9)
  })

  test('the foil hero pauses when the tab is hidden', async ({ page }) => {
    await page.goto(url)
    await page.waitForSelector('canvas[data-foil-hero]')

    // Positive control: prove the render loop is actually running while the
    // tab is visible. Without this, framesWhileHidden === 0 below would
    // pass identically whether the tab pauses on hide OR the scene never
    // renders a single frame in the first place — the assertion alone
    // cannot distinguish "paused correctly" from "never ran".
    const framesWhileVisible = await countFrames(page, 400)
    expect(framesWhileVisible).toBeGreaterThan(0)

    // Simulate the tab being hidden, then confirm no frame is requested.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { get: () => true, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    const framesWhileHidden = await countFrames(page, 400)
    expect(framesWhileHidden).toBe(0)
  })

  test('the stage follows the scroll to the response act, then comes to rest', async ({ page }) => {
    await page.goto(url)
    await page.waitForSelector('canvas[data-foil-hero]')
    const stage = page.locator('[data-stage]')
    await expect(stage).toHaveAttribute('data-act', '0')

    await page.locator('[aria-labelledby="evening"]').evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await expect(stage).toHaveAttribute('data-act', '2')

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(stage).toHaveAttribute('data-act', '4')

    // Settled on the response act, the scene draws one still frame and
    // stops: a guest filling in the form is not paying for a render loop.
    await page.waitForTimeout(STAGE_SETTLE_MS)
    expect(await countDraws(page, 400)).toBe(0)

    // Positive control: one jump back to the top wakes it and it KEEPS
    // drawing through the glide — not a single stale frame and back to
    // sleep — so the zero above is a loop at rest, not a scene that never drew.
    const drawsAfterScroll = countDraws(page, 400)
    await page.evaluate(() => window.scrollTo(0, 0))
    expect(await drawsAfterScroll).toBeGreaterThan(5)
    await expect(stage).toHaveAttribute('data-act', '0')
  })

  test('the stage wakes when the page grows under a resting guest', async ({ page }) => {
    await page.goto(url)
    await page.waitForSelector('canvas[data-foil-hero]')
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(page.locator('[data-stage]')).toHaveAttribute('data-act', '4')
    await page.waitForTimeout(STAGE_SETTLE_MS)
    expect(await countDraws(page, 400)).toBe(0)

    // No scroll event: the response act simply grows, as it does when the
    // form swaps for its ticket. The act moves, so the scene must follow.
    const draws = countDraws(page, 400)
    await page.locator('[aria-labelledby="rsvp"]').evaluate((section) => {
      const spacer = document.createElement('div')
      spacer.style.height = '1500px'
      section.append(spacer)
    })
    expect(await draws).toBeGreaterThan(0)
  })

  test('lite motion follows the acts with CSS alone', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 })
    })
    // Dark: the light scheme deliberately caps the glow below 1.
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto(url)
    await expect(page.locator('[data-motion]')).toHaveAttribute('data-motion', 'lite')
    const stage = page.locator('[data-stage]')
    await expect(stage).toHaveAttribute('data-act', '0')
    await expect(page.locator('.stage-lite > [data-lite-act="0"]')).toHaveCSS('opacity', '1')
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(stage).toHaveAttribute('data-act', '4')
    await expect(page.locator('.stage-lite > [data-lite-act="4"]')).toHaveCSS('opacity', '1')
    await expect(page.locator('.stage-lite > [data-lite-act="0"]')).toHaveCSS('opacity', '0')
    await expect(page.locator('canvas')).toHaveCount(0)
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
    const me = page.getByTestId('guest-response').first()
    if ((await me.getAttribute('aria-pressed')) !== 'true') await me.click()
    await expect(me).toHaveAttribute('aria-pressed', 'true')
    await page.locator('form').first().evaluate((f: HTMLFormElement) => f.requestSubmit())
    await expect(page.getByTestId('rsvp-confirmed')).toContainText('look forward')
    await expect(page.locator('[data-sealed]')).toHaveCount(1)
  })
})
