import { test, expect, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { createInvite } from '../../src/lib/invites/repository'
import { E2E_DATABASE_URL } from '../../playwright.config'

/**
 * A throwaway invite this test owns, opened by id. Never "the first row":
 * the list is ordered by invite number, so the first row is the seeded
 * E2E Guest Party, and renaming or re-keying it breaks every later spec
 * that relies on E2E_GUEST_TOKEN or the label 'E2E Guest Party'.
 */
async function disposableInviteId(label: string): Promise<string> {
  const prisma = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } })
  try {
    const { invite } = await createInvite(prisma, null, {
      label, seatsAllotted: 1, primaryGuest: { firstName: 'Dana', lastName: 'Disposable' },
    })
    return invite.id
  } finally {
    await prisma.$disconnect()
  }
}

async function signIn(page: Page) {
  await page.goto('/admin/login')
  await page.getByLabel('Email').fill(process.env.ADMIN_SEED_EMAIL!)
  await page.getByLabel('Password').fill(process.env.ADMIN_SEED_PASSWORD!)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/admin$/)
}

test.describe('invite management', () => {
  test('creates an invite and finds it by search', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/invites')

    // "Add a single invite" is a collapsed <details> disclosure by design
    // (the page is a list first, a create form second) — open it before
    // interacting with the fields inside.
    await page.locator('summary', { hasText: 'Add a single invite' }).click()

    const label = `Okafor Party ${Date.now()}`
    await page.getByLabel('Invite label').fill(label)
    await page.getByLabel('Seats', { exact: true }).fill('2')
    await page.getByLabel('First name').fill('Ada')
    await page.getByLabel('Last name').fill('Okafor')
    await page.getByRole('button', { name: 'Create invite' }).click()

    await expect(page.getByRole('cell', { name: label })).toBeVisible()

    await page.getByLabel('Search').fill('Okafor')
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByRole('cell', { name: label })).toBeVisible()
  })

  test('creates numbered placeholders, then assigns a person to one without changing its code', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/invites')

    // A collapsed <details> like "Add a single invite" — open it first.
    await page.locator('summary', { hasText: 'Create numbered placeholders' }).click()
    const placeholders = page.locator('form').filter({ has: page.getByRole('button', { name: 'Create placeholders' }) })
    await placeholders.getByLabel('How many').fill('2')
    await placeholders.getByLabel('Seats each').fill('1')
    // The action revalidates in place (no redirect), so wait for its POST to
    // land before reading the database — the click resolves as soon as it
    // is dispatched, not once the batch is committed.
    await Promise.all([
      page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/admin/invites')),
      placeholders.getByRole('button', { name: 'Create placeholders' }).click(),
    ])
    await expect(page.getByRole('columnheader', { name: 'No.' })).toBeVisible()

    // Numbers continue from whatever earlier specs created, so find the
    // batch through the database rather than assuming it starts at 001.
    const prisma = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } })
    let newest: { id: string; number: number; label: string; tokenHash: string }
    try {
      newest = await prisma.invite.findFirstOrThrow({
        orderBy: { number: 'desc' },
        select: { id: true, number: true, label: true, tokenHash: true },
      })
    } finally {
      await prisma.$disconnect()
    }
    expect(newest.label).toBe(String(newest.number).padStart(3, '0'))

    // Searching by the printed number finds the card.
    await page.getByLabel('Search').fill(newest.label)
    await page.getByRole('button', { name: 'Apply' }).click()
    await page.getByRole('row', { name: new RegExp(`\\b${newest.label}\\b`) }).getByRole('link', { name: 'Open' }).click()

    await expect(page.getByTestId('invite-number')).toContainText(newest.label)
    await expect(page.getByTestId('invite-no-guests')).toBeVisible()

    const addGuest = page.locator('form').filter({ has: page.getByRole('button', { name: 'Add guest' }) })
    await addGuest.getByLabel('First name').fill('Priya')
    await addGuest.getByLabel('Last name').fill('Natarajan')
    await addGuest.getByRole('button', { name: 'Add guest' }).click()

    const guest = page.getByTestId('invite-guest').first()
    await expect(guest).toContainText('Priya Natarajan')
    await expect(guest).toContainText('primary')
    await expect(page.getByTestId('invite-no-guests')).toHaveCount(0)

    // The token — and therefore the printed QR code — is untouched.
    const after = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } })
    try {
      const row = await after.invite.findUniqueOrThrow({ where: { id: newest.id }, select: { tokenHash: true } })
      expect(row.tokenHash).toBe(newest.tokenHash)
    } finally {
      await after.$disconnect()
    }
  })

  test('opens invite detail and renames it', async ({ page }) => {
    await signIn(page)
    await page.goto(`/admin/invites/${await disposableInviteId(`E2E Rename ${Date.now()}`)}`)

    const renamed = `Renamed ${Date.now()}`
    await page.getByLabel('Invite label').fill(renamed)
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByLabel('Invite label')).toHaveValue(renamed)
  })

  test('regenerates a token and shows it exactly once', async ({ page }) => {
    await signIn(page)
    await page.goto(`/admin/invites/${await disposableInviteId(`E2E Rekey ${Date.now()}`)}`)
    await page.getByRole('button', { name: 'Regenerate QR token' }).click()

    const link = page.getByTestId('invite-url')
    await expect(link).toBeVisible()
    await expect(link).toContainText('/i/')

    // page.reload() re-requests the SAME url, including the ?inviteUrl=...
    // query string, so the token would still render — that's not what's
    // worth proving. The token isn't persisted server-side, so navigating
    // to the bare detail URL (no query string), as an operator normally
    // would, must never re-display it.
    const bareUrl = page.url().split('?')[0] ?? page.url()
    await page.goto(bareUrl)
    await expect(page.getByTestId('invite-url')).toHaveCount(0)
  })

  test('refuses to shrink seats below the guest count', async ({ page }) => {
    await signIn(page)
    await page.goto(`/admin/invites/${await disposableInviteId(`E2E Shrink ${Date.now()}`)}`)
    // exact: the guests section's accessible name ("Guests (1 of 1 seats)")
    // would otherwise match the substring too.
    await page.getByLabel('Seats', { exact: true }).fill('0')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
  })
})
