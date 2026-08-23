import { test, expect, type TestInfo } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { dashboard } from '../../src/lib/stats/rsvp'
import { createInvite } from '../../src/lib/invites/repository'
import { ADMIN_CREDENTIALS } from './global-setup'
import { E2E_DATABASE_URL } from '../../playwright.config'
import { signIn } from './sign-in'

// See checkin.spec.ts's identical helper: this file also seeds a
// stamp-unique fixture in beforeAll, so a second pass under 'mobile' would
// double it — one project's worth of signal is all this buys.
function desktopOnly(testInfo: TestInfo): void {
  test.skip(testInfo.project.name !== 'desktop', 'own fixture seed — runs once, not once per project')
}

// A uniquely-named, uniquely-declined guest this file owns end to end, so
// the /admin/guests "attending=no" filter test never has to guess whether
// some other spec's decline (guest-rsvp.spec.ts) has landed yet — file
// order is not a contract this suite should depend on.
const STAMP = Date.now()
const DECLINED_LABEL = `E2E Dashboard Declined ${STAMP}`
const DECLINED_LAST_NAME = `Ellery${STAMP}`

test.describe('dashboard and guest list', () => {
  test.beforeAll(async () => {
    const prisma = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } })
    try {
      const { invite } = await createInvite(prisma, null, {
        label: DECLINED_LABEL,
        seatsAllotted: 1,
        primaryGuest: { firstName: 'Devon', lastName: DECLINED_LAST_NAME },
      })
      await prisma.guest.updateMany({ where: { inviteId: invite.id }, data: { attending: false } })
      await prisma.invite.update({
        where: { id: invite.id },
        data: { status: 'DECLINED', respondedAt: new Date() },
      })
    } finally {
      await prisma.$disconnect()
    }
  })

  test('the stat tiles match what is actually in the database', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    const prisma = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } })
    let expected: Awaited<ReturnType<typeof dashboard>>
    try {
      expected = await dashboard(prisma, new Date())
    } finally {
      await prisma.$disconnect()
    }

    await signIn(page, ADMIN_CREDENTIALS.email, ADMIN_CREDENTIALS.password)
    await expect(page).toHaveURL(/\/admin$/)

    const rate = expected.invites.total
      ? Math.round((expected.invites.responded / expected.invites.total) * 100)
      : 0
    await expect(page.locator('[data-stat="Invited"]')).toHaveText(String(expected.invites.total))
    await expect(page.locator('[data-stat="Responded"]')).toHaveText(`${rate}%`)
    await expect(page.locator('[data-stat="Coming"]')).toHaveText(String(expected.guests.attending))
    await expect(page.locator('[data-stat="Arrived"]')).toHaveText(String(expected.guests.checkedIn))

    // Both seeded meal options — including the case where an option has
    // zero selections yet — must be listed, not silently dropped.
    for (const meal of expected.meals) {
      await expect(page.getByText(meal.isActive ? meal.label : `${meal.label} (retired)`)).toBeVisible()
    }
  })

  test('/admin/guests filters by attending=no to just the declined fixture', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await signIn(page, ADMIN_CREDENTIALS.email, ADMIN_CREDENTIALS.password)
    await expect(page).toHaveURL(/\/admin$/)
    await page.goto('/admin/guests')
    await expect(page.getByRole('cell', { name: DECLINED_LAST_NAME, exact: false }).first()).toBeVisible()

    await page.goto(`/admin/guests?attending=no&search=${DECLINED_LAST_NAME}`)
    const rows = page.locator('table tbody tr')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('Devon')
    await expect(rows.first()).toContainText(DECLINED_LAST_NAME)
    await expect(rows.first().getByRole('cell').nth(3)).toHaveText('no')
  })

  test('the export link downloads a CSV with a UTF-8 BOM and a header row', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await signIn(page, ADMIN_CREDENTIALS.email, ADMIN_CREDENTIALS.password)
    await expect(page).toHaveURL(/\/admin$/)
    const response = await page.request.get('/api/admin/guests/export')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/csv')
    const body = await response.body()
    // A UTF-8 BOM is the byte sequence EF BB BF, not the three-character
    // string '﻿' — reading it as text first would let a mis-encoded
    // BOM slip past this assertion.
    expect(body.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    const text = body.toString('utf8')
    const firstLine = text.replace(/^﻿/, '').split('\r\n')[0]
    expect(firstLine).toBe(
      'invite,firstName,lastName,badgeName,company,title,email,phone,attending,meal,dietary,accessibilityNeeds,table,checkedInAt',
    )
    expect(text).toContain(DECLINED_LAST_NAME)
  })

  test('/admin/audit as OWNER shows rows and filters by entity', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await signIn(page, process.env.ADMIN_SEED_EMAIL!, process.env.ADMIN_SEED_PASSWORD!)
    await expect(page).toHaveURL(/\/admin$/)

    await page.goto('/admin/audit')
    const anyRows = page.locator('table tbody tr')
    expect(await anyRows.count()).toBeGreaterThan(0)

    await page.goto('/admin/audit?entity=Invite')
    const inviteRows = page.locator('table tbody tr')
    const rowCount = await inviteRows.count()
    expect(rowCount).toBeGreaterThan(0)
    for (const row of await inviteRows.all()) {
      await expect(row).toContainText('Invite')
    }
  })

  test('/admin/audit as ADMIN redirects away', async ({ page }, testInfo) => {
    desktopOnly(testInfo)
    await signIn(page, ADMIN_CREDENTIALS.email, ADMIN_CREDENTIALS.password)
    await expect(page).toHaveURL(/\/admin$/)
    await page.goto('/admin/audit')
    await expect(page).toHaveURL(/\/admin$/)
  })
})
