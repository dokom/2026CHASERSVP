import { test, expect } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { createInvite } from '../../src/lib/invites/repository'
import { E2E_GUEST_TOKEN, ADMIN_CREDENTIALS } from './global-setup'
import { signIn } from './sign-in'
import { E2E_DATABASE_URL } from '../../playwright.config'

/**
 * A throwaway invite for the token-regeneration test below. It must NOT be
 * "whichever invite is first in the list": the list is ordered by invite
 * number, so that is the seeded E2E Guest Party — and regenerating ITS
 * token silently invalidates E2E_GUEST_TOKEN for every later guest spec.
 */
async function disposableInviteId(): Promise<string> {
  const prisma = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } })
  try {
    const { invite } = await createInvite(prisma, null, {
      label: `E2E CSP Reveal ${Date.now()}`,
      seatsAllotted: 1,
      primaryGuest: { firstName: 'Sam', lastName: 'Reveal' },
    })
    return invite.id
  } finally {
    await prisma.$disconnect()
  }
}

const PAGES = [
  { name: 'guest portal', path: () => `/i/${E2E_GUEST_TOKEN}`, auth: false },
  { name: 'login', path: () => '/admin/login', auth: false },
  { name: 'dashboard', path: () => '/admin', auth: true },
  { name: 'invites', path: () => '/admin/invites', auth: true },
  { name: 'event', path: () => '/admin/event', auth: true },
  { name: 'check-in', path: () => '/admin/checkin', auth: true },
]

for (const page of PAGES) {
  test(`CSP is enforced and violation-free on the ${page.name}`, async ({ page: p }) => {
    const violations: string[] = []
    p.on('console', (m) => { if (/Content Security Policy|Refused to/.test(m.text())) violations.push(m.text()) })
    if (page.auth) await signIn(p, ADMIN_CREDENTIALS.email, ADMIN_CREDENTIALS.password)
    const response = await p.goto(page.path())
    const csp = response?.headers()['content-security-policy'] ?? ''
    expect(csp).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]+'/)
    expect(csp).toContain("frame-ancestors 'none'")
    await p.waitForLoadState('networkidle')
    // The page must actually work under the policy, not merely carry the header.
    await expect(p.locator('h1').first()).toBeVisible()
    expect(violations).toEqual([])
  })
}

test('the nonce differs between requests', async ({ page }) => {
  const a = (await page.goto('/admin/login'))?.headers()['content-security-policy']
  const b = (await page.goto('/admin/login'))?.headers()['content-security-policy']
  expect(a).not.toBe(b)
})

test('the invite-token reveal script still runs under the policy', async ({ page }) => {
  await signIn(page, ADMIN_CREDENTIALS.email, ADMIN_CREDENTIALS.password)
  // Wait for the post-login redirect to land before navigating away — the
  // sign-in click resolves as soon as it's actionable, not once the session
  // cookie is actually set, so an immediate goto() can race it and land back
  // on /admin/login instead (see visual.spec.ts's admin screenshots for the
  // same wait, and this test's own flakiness under full-suite load without it).
  await expect(page).toHaveURL(/\/admin$/)
  await page.goto(`/admin/invites/${await disposableInviteId()}`)
  const violations: string[] = []
  page.on('console', (m) => { if (/Content Security Policy/.test(m.text())) violations.push(m.text()) })
  await page.getByRole('button', { name: 'Regenerate QR token' }).click()
  await expect(page.getByTestId('invite-url')).toBeVisible()
  expect(violations).toEqual([])
})
