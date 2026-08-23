import { test, expect, type Page, type CDPSession, type TestInfo } from '@playwright/test'
import { E2E_GUEST_TOKEN, STAFF_CREDENTIALS } from './global-setup'
import { signIn } from './sign-in'

// CDP is Chromium-only, and both configured projects (Pixel 7, Desktop
// Chrome) already run on the Chromium engine — this guard exists to keep
// the byte counts to a single reported figure per CI run rather than one
// per project, matching visual.spec.ts's and checkin.spec.ts's reasoning.
function desktopOnly(testInfo: TestInfo): void {
  test.skip(testInfo.project.name !== 'desktop', 'CDP perf figures — one report, not one per project')
}

type ScriptLoad = { pathname: string; url: string; encodedDataLength: number }

/**
 * Opens a CDP session, enables the Network domain, navigates to `path`, and
 * returns every `resourceType === 'Script'` request's encoded byte size —
 * the real over-the-wire figure (compressed), not the decoded source size.
 */
async function measureScriptLoads(page: Page, session: CDPSession, path: string): Promise<ScriptLoad[]> {
  const resourceTypeByRequest = new Map<string, string>()
  const urlByRequest = new Map<string, string>()
  const loads: ScriptLoad[] = []

  const onResponse = (event: { requestId: string; type: string; response: { url: string } }) => {
    resourceTypeByRequest.set(event.requestId, event.type)
    urlByRequest.set(event.requestId, event.response.url)
  }
  const onFinished = (event: { requestId: string; encodedDataLength: number }) => {
    if (resourceTypeByRequest.get(event.requestId) !== 'Script') return
    const url = urlByRequest.get(event.requestId)
    if (!url) return
    loads.push({ pathname: new URL(url).pathname, url, encodedDataLength: event.encodedDataLength })
  }

  session.on('Network.responseReceived', onResponse)
  session.on('Network.loadingFinished', onFinished)
  try {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
  } finally {
    session.off('Network.responseReceived', onResponse)
    session.off('Network.loadingFinished', onFinished)
  }
  return loads
}

const LITE_SCRIPT_BUDGET_BYTES = 150 * 1024

// I7: the raw total (nothing excluded, nothing forgiven) always has to
// clear this ceiling too. The core-budget check below can be satisfied by
// an unbounded "motion layer" exclusion that subtracts away an arbitrarily
// large fraction of the page's script — this hard raw number is what makes
// that escape route pointless: no exclusion, however large, can make a
// bloated page pass, because it still has to fit under 190 KB raw.
const RAW_SCRIPT_CEILING_BYTES = 190 * 1024

// I7: the exclusion itself must be small and singular, or "motion layer"
// classification becomes a way to hide an arbitrary amount of bloat behind
// a content-signature match. One chunk, capped at 40 KB — anything more is
// not "the motion layer," it's the budget check failing to fail.
const MOTION_LAYER_CHUNK_CEILING_BYTES = 40 * 1024

/**
 * Turbopack chunk filenames are content-hashed and change on every build,
 * so there is no stable path to match against. animejs — the "motion
 * layer" spec §4's budget explicitly excludes ("Guest JS bundle (motion
 * layer excluded, lazy) < 150kb gzipped") — leaves a small set of
 * distinctive identifiers in its minified output regardless of chunk hash
 * (easing-curve names, its SVG-draw helper). A chunk is classified as
 * "motion layer" if its source contains any of them; every other script
 * counts toward the budget. Lite tier still runs the animejs-driven CSS/
 * SVG motion (only the WebGL/three.js layer is skipped), so this chunk is
 * present even on a low-tier device and must be subtracted, not merely
 * absent.
 */
const MOTION_LAYER_MARKERS = ['outExpo', 'inOutQuad', 'createDrawable']

async function classifyScriptLoads(
  page: Page,
  loads: ScriptLoad[],
): Promise<{ core: ScriptLoad[]; motionLayer: ScriptLoad[] }> {
  const core: ScriptLoad[] = []
  const motionLayer: ScriptLoad[] = []
  for (const load of loads) {
    const body = await page.request.get(load.url).then((r) => r.text()).catch(() => '')
    const isMotionLayer = MOTION_LAYER_MARKERS.some((marker) => body.includes(marker))
    ;(isMotionLayer ? motionLayer : core).push(load)
  }
  return { core, motionLayer }
}

const sumBytes = (loads: ScriptLoad[]): number => loads.reduce((sum, l) => sum + l.encodedDataLength, 0)

test.describe('performance budget', () => {
  test('guest route ships under 150 KB of script on a low-tier device; full tier adds exactly the three.js chunk', async ({
    page,
    context,
  }, testInfo) => {
    desktopOnly(testInfo)

    // Low-tier device: deviceTier() reads navigator.deviceMemory, and a
    // value under 4 resolves to the 'lite' motion mode (see
    // src/lib/motion/preferences.ts), which never mounts the WebGL layer
    // and therefore never requests the three.js chunk.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 })
    })
    const liteSession = await context.newCDPSession(page)
    await liteSession.send('Network.enable')
    const liteLoads = await measureScriptLoads(page, liteSession, `/i/${E2E_GUEST_TOKEN}`)
    await expect(page.locator('[data-motion]')).toHaveAttribute('data-motion', 'lite')

    const liteRawTotalBytes = sumBytes(liteLoads)
    const { core: liteCore, motionLayer: liteMotionLayer } = await classifyScriptLoads(page, liteLoads)
    const liteCoreBytes = sumBytes(liteCore)
    const liteMotionLayerBytes = sumBytes(liteMotionLayer)
    const liteAnnotation =
      `core ${liteCoreBytes}B across ${liteCore.length} request(s); ` +
      `motion layer ${liteMotionLayerBytes}B across ${liteMotionLayer.length} request(s); ` +
      `raw total ${liteRawTotalBytes}B across ${liteLoads.length} request(s)`
    testInfo.annotations.push({ type: 'perf-lite-script-bytes', description: liteAnnotation })
    // Also a plain console line: CI reporters (github/dot) print test
    // stdout but do not all render custom testInfo.annotations inline, and
    // this number is the one the task explicitly wants visible in the log.
    console.log(`[perf] lite-tier script bytes: ${liteAnnotation}`)

    // I7: the exclusion is bounded on every side, so "classify a big chunk
    // as motion layer" can never be the thing that makes this test green.
    //   - exactly one chunk may be excluded — a second content-signature
    //     match is bloat wearing the motion layer's name, not the motion
    //     layer itself.
    //   - that one chunk is capped at 40 KB — the real animejs payload,
    //     not a dumping ground.
    //   - at least one script must remain after the exclusion — an empty
    //     liteCore would make the <150KB check vacuously true.
    expect(
      liteMotionLayer.length,
      `exactly one "motion layer" chunk must be excluded, found ${liteMotionLayer.length}: ` +
        `${liteMotionLayer.map((l) => l.pathname).join(', ') || '(none)'}`,
    ).toBe(1)
    expect(
      liteMotionLayerBytes,
      `the excluded motion-layer chunk must be at most 40 KB, was ${liteMotionLayerBytes}B`,
    ).toBeLessThanOrEqual(MOTION_LAYER_CHUNK_CEILING_BYTES)
    expect(
      liteCore.length,
      'at least one script must remain in the core bundle after excluding the motion layer',
    ).toBeGreaterThanOrEqual(1)

    // Spec §4: "Guest JS bundle (motion layer excluded, lazy) < 150kb
    // gzipped" — the budget is on the core bundle, not the raw total.
    expect(liteCoreBytes, `lite-tier CORE script bytes (motion layer excluded): ${liteCoreBytes}`)
      .toBeLessThanOrEqual(LITE_SCRIPT_BUDGET_BYTES)
    // And the raw total — no exclusion applied at all — must clear its own
    // ceiling regardless of how the core number above came out, so an
    // ever-larger "motion layer" can never be the reason this test passes.
    expect(liteRawTotalBytes, `lite-tier RAW script bytes (nothing excluded): ${liteRawTotalBytes}`)
      .toBeLessThanOrEqual(RAW_SCRIPT_CEILING_BYTES)

    // Full tier: a fresh page/context so the deviceMemory spoof above
    // never applies to it.
    const fullPage = await context.browser()!.newContext().then((c) => c.newPage())
    const fullSession = await fullPage.context().newCDPSession(fullPage)
    await fullSession.send('Network.enable')
    const fullLoads = await measureScriptLoads(fullPage, fullSession, `/i/${E2E_GUEST_TOKEN}`)
    await expect(fullPage.locator('[data-motion]')).toHaveAttribute('data-motion', 'full')

    const fullTotalBytes = sumBytes(fullLoads)
    testInfo.annotations.push({
      type: 'perf-full-script-bytes',
      description: `${fullTotalBytes} bytes across ${fullLoads.length} script request(s)`,
    })
    console.log(`[perf] full-tier script bytes: ${fullTotalBytes}B across ${fullLoads.length} request(s)`)
    await fullPage.context().close()

    expect(fullTotalBytes).toBeGreaterThan(liteRawTotalBytes)

    const litePaths = new Set(liteLoads.map((l) => l.pathname))
    const fullOnlyPaths = new Set(fullLoads.map((l) => l.pathname).filter((p) => !litePaths.has(p)))
    testInfo.annotations.push({
      type: 'perf-full-only-chunks',
      description: [...fullOnlyPaths].join(', ') || '(none)',
    })
    // The difference must be attributable to exactly one additional
    // request — the three.js chunk — not a cluster of unrelated scripts.
    expect(fullOnlyPaths.size).toBe(1)
  })

  test('the check-in page never scrolls horizontally at 375px', async ({ page }) => {
    await signIn(page, STAFF_CREDENTIALS.email, STAFF_CREDENTIALS.password)
    await expect(page).toHaveURL(/\/admin\/checkin$/)
    await page.setViewportSize({ width: 375, height: 740 })
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
