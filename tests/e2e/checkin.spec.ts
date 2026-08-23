import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { E2E_CHECKIN_TOKEN, STAFF_CREDENTIALS, ADMIN_CREDENTIALS } from './global-setup'
import { signIn } from './sign-in'

/**
 * This suite taps a single seeded party's guests and asserts on the exact
 * before/after state of each tap — non-idempotent across repeats, unlike
 * most functional specs. The 'mobile' and 'desktop' projects otherwise
 * both run every spec file against the SAME never-re-wiped e2e database
 * (see global-setup.ts — the wipe happens once, before either project
 * starts), so a second pass over this file would find Morgan already
 * checked in from the first pass and fail assertions that expect a clean
 * start. Same rationale as visual.spec.ts's skipRedundantProject, plus
 * this additional correctness reason.
 */
function desktopOnly(testInfo: TestInfo): void {
  test.skip(testInfo.project.name !== 'desktop', 'state-mutating — runs once, not once per project')
}

// The check-in URL the QR code would encode. Built the same way the
// scanner's extractToken() expects — origin plus /i/<token> — since a
// staff member pasting the link is exactly what the manual fallback field
// accepts.
const appUrl = process.env.APP_URL ?? 'http://localhost:3000'
const CHECKIN_URL = `${appUrl}/i/${E2E_CHECKIN_TOKEN}`

type ResolvedGuest = { id: string; firstName: string; checkedInAt: string | null }
type ResolvedParty = { inviteId: string; label: string; tableNumber: string | null; guests: ResolvedGuest[] }

/** Pastes the invitation link into the manual field and returns the resolved party. */
async function resolveParty(page: Page): Promise<ResolvedParty> {
  const resolvePromise = page.waitForResponse(
    (r) => r.url().includes('/api/admin/checkin/resolve') && r.request().method() === 'POST',
  )
  await page.getByLabel('Invitation link').fill(CHECKIN_URL)
  await page.getByRole('button', { name: 'Find' }).click()
  const response = await resolvePromise
  return (await response.json()) as ResolvedParty
}

/** Reads "{checkedIn} of {attending} arrived" off the check-in page header. */
async function readProgress(page: Page): Promise<{ checkedIn: number; attending: number }> {
  const text = (await page.getByTestId('checkin-progress').textContent()) ?? ''
  const match = /(\d+) of (\d+) arrived/.exec(text)
  if (!match) throw new Error(`could not parse progress text: "${text}"`)
  return { checkedIn: Number(match[1]), attending: Number(match[2]) }
}

/** The button row for one guest, matched by first name (unique within this fixture party). */
function guestRow(page: Page, firstName: string) {
  return page.getByRole('button', { name: new RegExp(firstName) })
}

/** Reads the raw offline queue straight out of IndexedDB, bypassing React state entirely. */
async function readPersistedQueue(page: Page): Promise<{ guestId: string }[]> {
  return page.evaluate(async () => {
    const req = indexedDB.open('gala-checkin', 1)
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const value = await new Promise((resolve, reject) => {
      const r = db.transaction('queue', 'readonly').objectStore('queue').get('pending')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    return (value ?? []) as { guestId: string }[]
  })
}

test.describe('door check-in', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await signIn(page, STAFF_CREDENTIALS.email, STAFF_CREDENTIALS.password)
    await expect(page).toHaveURL(/\/admin\/checkin$/)
  })

  test('pasting the invitation link resolves the party with its table number', async ({ page }) => {
    const party = await resolveParty(page)
    expect(party.label).toBe('E2E Checkin Party')
    expect(party.tableNumber).toBe('7')

    await expect(page.getByRole('heading', { name: /E2E Checkin Party/ })).toBeVisible()
    await expect(page.getByText('Table 7')).toBeVisible()
    // Dana was seeded already checked in — resolving must surface that
    // without any tap from this test.
    await expect(guestRow(page, 'Dana')).toContainText('tap to undo')
  })

  test('tap checks a guest in, undo reverts it, tapping again re-checks it', async ({ page }) => {
    // I6's positive-state-first assertion is only observable if the write
    // it is waiting on takes long enough to observe: a check-in POST round
    // trip to localhost can complete well inside a single assertion poll,
    // which would make "1 to sync" flicker in and out before Playwright
    // ever samples it — a flake, not a false pass, but one that defeats
    // the point of asserting the positive state at all. Delaying only this
    // endpoint's response by a fixed, small amount makes the transient
    // state deterministically observable without changing what happens.
    await page.route('**/api/admin/checkin/guests/**', async (route) => {
      if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 400))
      await route.continue()
    })

    const before = await readProgress(page)

    const party = await resolveParty(page)
    const morgan = party.guests.find((g) => g.firstName === 'Morgan')
    if (!morgan) throw new Error('seed fixture missing Morgan')
    expect(morgan.checkedInAt).toBeNull()

    // Tap #1: check in. Assert the badge actually EXISTS first (I6: a bare
    // toHaveCount(0) fires the instant the assertion starts polling, which
    // is true both before the tap ever queues anything and after it
    // syncs — it proves nothing about a sync having happened at all).
    // Only once "1 to sync" has been observed do we wait for the badge to
    // clear, which is the real proof the queued write flushed to the
    // server rather than merely never having existed.
    await guestRow(page, 'Morgan').click()
    await expect(page.getByTestId('unsynced-count')).toContainText('1 to sync')
    await expect(page.getByTestId('unsynced-count')).toHaveCount(0)
    await expect(guestRow(page, 'Morgan')).toContainText('tap to undo')

    // The progress line updates on reload — re-resolving the party proves
    // the check-in round-tripped through the server, not just local state.
    await page.reload()
    await expect(page.getByTestId('checkin-progress')).toBeVisible()
    const afterFirstCheckIn = await readProgress(page)
    expect(afterFirstCheckIn.checkedIn).toBe(before.checkedIn + 1)

    const reResolved = await resolveParty(page)
    const morganAfterReload = reResolved.guests.find((g) => g.firstName === 'Morgan')
    expect(morganAfterReload?.checkedInAt).not.toBeNull()
    await expect(guestRow(page, 'Morgan')).toContainText('tap to undo')

    // Tap #2: undo.
    await guestRow(page, 'Morgan').click()
    await expect(guestRow(page, 'Morgan')).toContainText('Tap to check in')

    // Tap #3: re-check. Same I6 fix — positive state before the transition.
    await guestRow(page, 'Morgan').click()
    await expect(page.getByTestId('unsynced-count')).toContainText('1 to sync')
    await expect(page.getByTestId('unsynced-count')).toHaveCount(0)
    await expect(guestRow(page, 'Morgan')).toContainText('tap to undo')

    // Now confirm the full sequence landed in the audit log, newest first:
    // guest.checkIn, guest.undoCheckIn, guest.checkIn.
    const morganId = morgan.id
    await page.context().clearCookies()
    await signIn(page, process.env.ADMIN_SEED_EMAIL!, process.env.ADMIN_SEED_PASSWORD!)
    await expect(page).toHaveURL(/\/admin$/)
    await page.goto('/admin/audit?entity=Guest&action=guest.')
    const rows = page.locator('table tbody tr').filter({ hasText: morganId })
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText('guest.checkIn')
    await expect(rows.nth(1)).toContainText('guest.undoCheckIn')
    await expect(rows.nth(2)).toContainText('guest.checkIn')
  })

  test('offline: a tap queues in IndexedDB, survives reload, and syncs when back online', async ({ page, context }) => {
    const party = await resolveParty(page)
    const casey = party.guests.find((g) => g.firstName === 'Casey')
    if (!casey) throw new Error('seed fixture missing Casey')
    expect(casey.checkedInAt).toBeNull()

    await context.setOffline(true)
    await guestRow(page, 'Casey').click()
    await expect(guestRow(page, 'Casey')).toContainText('will sync')
    await expect(page.getByTestId('unsynced-count')).toContainText('1 to sync')

    // I5: the previous version of this test read IndexedDB in the same
    // page context and only reloaded AFTER the queue had already synced
    // and emptied — a page.reload() that changes nothing observable,
    // since deleting scanner.tsx's load-on-mount effect (`loadQueue().
    // then(setQueue)`) would still leave every assertion here green. To
    // actually exercise that effect, the reload below happens while the
    // tap is still unsynced, and the very first assertion after it reads
    // straight off the DOM the mount effect produced — not off a value
    // captured before the reload.
    //
    // A literal "reload while context.setOffline(true)" is not something
    // Chromium can do here: offline emulation blocks every request the
    // browser makes, navigation included, and this app has no service
    // worker to serve the shell from cache (confirmed empirically —
    // page.reload() throws net::ERR_INTERNET_DISCONNECTED). So the
    // reload's own document fetch is allowed through, while the one
    // thing that actually matters — the check-in write endpoint — stays
    // deliberately unreachable across it, so there is no way for Casey's
    // queued tap to sync during or immediately after the reload.
    await page.route('**/api/admin/checkin/guests/**', (route) => route.abort())
    await context.setOffline(false)
    await page.reload()
    await context.setOffline(true)

    await expect(page.getByTestId('checkin-progress')).toBeVisible()
    // Fresh mount, item never synced: this can only read "1 to sync" if
    // the mount effect actually reloaded the queue from IndexedDB.
    await expect(page.getByTestId('unsynced-count')).toContainText('1 to sync')
    // And the raw persisted record — not just the badge text — proves
    // the guest itself, not merely a count, came back from IndexedDB.
    const survivedReload = await readPersistedQueue(page)
    expect(survivedReload.some((item) => item.guestId === casey.id)).toBe(true)

    // Now actually go online: drop the route block and the CDP offline
    // flag together, which fires a real 'online' event on this already-
    // mounted document and drives scanner.tsx's own flush() — the same
    // path a staff member's phone takes when venue Wi-Fi returns.
    await page.unroute('**/api/admin/checkin/guests/**')
    await context.setOffline(false)
    await expect(page.getByTestId('unsynced-count')).toHaveCount(0, { timeout: 20_000 })

    // Reload before the fresh resolve: Scanner's de-dup guard
    // (`lastScan.current` in scanner.tsx) drops a second scan of the same
    // token within one mounted session, so re-pasting the identical URL
    // without a reload would never issue a second request at all. A
    // reload gives a clean Scanner mount — realistic for a staff member
    // who refreshes once the venue Wi-Fi returns — and resets that guard.
    await page.reload()
    await expect(page.getByTestId('checkin-progress')).toBeVisible()
    const freshParty = await resolveParty(page)
    const freshCasey = freshParty.guests.find((g) => g.firstName === 'Casey')
    expect(freshCasey?.checkedInAt).not.toBeNull()
  })

  test('a STAFF request to the guest export is refused', async ({ page }) => {
    const response = await page.request.get('/api/admin/guests/export', { maxRedirects: 0 })
    expect(response.status()).toBeGreaterThanOrEqual(300)
    const contentType = response.headers()['content-type'] ?? ''
    expect(contentType).not.toContain('text/csv')
  })
})

test('an ADMIN posting to resolve without the CSRF header gets 403', async ({ page }, testInfo) => {
  desktopOnly(testInfo)
  await signIn(page, ADMIN_CREDENTIALS.email, ADMIN_CREDENTIALS.password)
  await expect(page).toHaveURL(/\/admin$/)
  const response = await page.request.post('/api/admin/checkin/resolve', {
    data: { token: 'whatever' },
    headers: { 'Content-Type': 'application/json' }, // deliberately no X-CSRF-Token
  })
  expect(response.status()).toBe(403)
})
