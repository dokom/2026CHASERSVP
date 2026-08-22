import { config } from 'dotenv'
import { execSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../../src/lib/crypto/password'
import { assertDistinctDatabases } from '../../src/lib/db-identity'
import { createInvite } from '../../src/lib/invites/repository'
import { E2E_DATABASE_URL } from '../../playwright.config'

config({ path: '.env' })

/**
 * Bridges the plaintext guest invite token, generated fresh below on every
 * run, from globalSetup's process to the worker processes that run the spec
 * files. globalSetup and test files never share a JS heap — Playwright runs
 * globalSetup in the main process and each test file in a forked worker —
 * so a plain mutable module variable set inside globalSetup() would be
 * invisible to guest-rsvp.spec.ts. `process.env` IS inherited by workers
 * forked after globalSetup resolves, so it is used here as the carrier; the
 * env var itself is a private hand-off, never logged, never part of a URL.
 */
const TOKEN_ENV_VAR = '__E2E_GUEST_INVITE_TOKEN'

/**
 * The plaintext token for the guest invite seeded below, importable by
 * guest-rsvp.spec.ts (and any other spec that needs a known invite).
 * Evaluated once, when this module is first loaded by a worker process —
 * which Playwright guarantees happens only after globalSetup() below has
 * already run to completion and populated `process.env`.
 */
export const E2E_GUEST_TOKEN = process.env[TOKEN_ENV_VAR] ?? ''

// Every collection in the schema, ordered child-before-parent, mirroring
// tests/helpers/db.ts (which resets the integration-test database the same
// way). MongoDB enforces no foreign keys, so the order has no effect on
// correctness — it's just a stable, easy-to-scan order for debugging output.
const MODELS = [
  'auditLog', 'guest', 'invite', 'tableMarker', 'mealOption',
  'agendaItem', 'event', 'mediaAsset', 'loginAttempt',
  'adminSession', 'adminUser',
] as const

// Fixed, obvious credentials for the two lower-privileged accounts used by
// tests/e2e/authorization.spec.ts to prove the role gate in
// src/lib/auth/guard.ts actually blocks STAFF/ADMIN from routes above their
// rank. Not derived from ADMIN_SEED_EMAIL/PASSWORD (those stay OWNER-only)
// so each role's session is unambiguous in test output.
export const STAFF_CREDENTIALS = {
  email: 'e2e-staff@example.com',
  password: 'e2e-staff-password-123',
} as const

export const ADMIN_CREDENTIALS = {
  email: 'e2e-admin@example.com',
  password: 'e2e-admin-password-123',
} as const

export default async function globalSetup(): Promise<void> {
  const email = process.env.ADMIN_SEED_EMAIL
  const password = process.env.ADMIN_SEED_PASSWORD
  if (!email || !password) {
    throw new Error('ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD are required for E2E tests')
  }

  const appUrl = process.env.DATABASE_URL
  if (!appUrl) {
    throw new Error('DATABASE_URL is required (see .env.example)')
  }

  // This function wipes every collection below on every run. Refuse to run
  // at all if the e2e database resolves to the same physical database as
  // the dev database — the same protection tests/helpers/db.ts applies
  // before its own resetDb(), and for the same reason.
  assertDistinctDatabases(appUrl, E2E_DATABASE_URL)

  // Push the schema to the e2e database so a fresh machine works with no
  // manual setup. Must happen before the PrismaClient below connects.
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
    stdio: 'inherit',
  })

  const prisma = new PrismaClient({ datasources: { db: { url: E2E_DATABASE_URL } } })
  try {
    for (const model of MODELS) {
      await (prisma[model] as { deleteMany: () => Promise<unknown> }).deleteMany()
    }

    // The database is guaranteed empty at this point, so a plain create
    // (rather than the previous upsert) is sufficient.
    const passwordHash = await hashPassword(password)
    await prisma.adminUser.create({
      data: { email: email.toLowerCase(), name: 'E2E Owner', role: 'OWNER', passwordHash },
    })

    // STAFF and ADMIN accounts for tests/e2e/authorization.spec.ts, which
    // proves the role gate in src/lib/auth/guard.ts actually blocks access
    // above each account's rank.
    const staffPasswordHash = await hashPassword(STAFF_CREDENTIALS.password)
    await prisma.adminUser.create({
      data: {
        email: STAFF_CREDENTIALS.email,
        name: 'E2E Staff',
        role: 'STAFF',
        passwordHash: staffPasswordHash,
      },
    })

    const adminPasswordHash = await hashPassword(ADMIN_CREDENTIALS.password)
    await prisma.adminUser.create({
      data: {
        email: ADMIN_CREDENTIALS.email,
        name: 'E2E Admin',
        role: 'ADMIN',
        passwordHash: adminPasswordHash,
      },
    })

    // Fixture event, agenda, meals and one invite for the guest-portal and
    // event-config specs. Seeded fresh every run — see the database wipe
    // above — so neither suite can drift the way the admin fixtures once did.
    const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const rsvpDeadline = new Date(startsAt.getTime() - 24 * 60 * 60 * 1000)

    const event = await prisma.event.create({
      data: {
        name: 'The Grand Gala',
        tagline: 'An evening under the stars',
        startsAt,
        timezone: 'America/New_York',
        venueName: 'Grand Ballroom',
        address: '123 Fifth Avenue, New York, NY',
        dressCode: 'Black tie',
        rsvpDeadline,
      },
    })

    await prisma.agendaItem.createMany({
      data: [
        {
          eventId: event.id,
          title: 'Cocktail Reception',
          startsAt: new Date(startsAt.getTime() - 60 * 60 * 1000),
          sortOrder: 0,
        },
        { eventId: event.id, title: 'Dinner & Dancing', startsAt, sortOrder: 1 },
      ],
    })

    await prisma.mealOption.createMany({
      data: [
        { eventId: event.id, label: 'Chicken', sortOrder: 0 },
        { eventId: event.id, label: 'Vegetarian', sortOrder: 1 },
      ],
    })

    // Invite tokens are stored hashed — a spec can never read one back out
    // of the database. createInvite() (rather than a hand-rolled row) is
    // what actually generates, hashes and seals the token, so this fixture
    // exercises the exact same path production does.
    const { token } = await createInvite(prisma, null, {
      label: 'E2E Guest Party',
      seatsAllotted: 2,
      tableNumber: '12',
      primaryGuest: { firstName: 'Riley', lastName: 'Chen' },
    })
    process.env[TOKEN_ENV_VAR] = token
  } finally {
    await prisma.$disconnect()
  }
}
