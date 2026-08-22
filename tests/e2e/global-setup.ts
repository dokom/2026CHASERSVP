import { config } from 'dotenv'
import { execSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../../src/lib/crypto/password'
import { assertDistinctDatabases } from '../../src/lib/db-identity'
import { E2E_DATABASE_URL } from '../../playwright.config'

config({ path: '.env' })

// Every collection in the schema, ordered child-before-parent, mirroring
// tests/helpers/db.ts (which resets the integration-test database the same
// way). MongoDB enforces no foreign keys, so the order has no effect on
// correctness — it's just a stable, easy-to-scan order for debugging output.
const MODELS = [
  'auditLog', 'guest', 'invite', 'tableMarker', 'mealOption',
  'agendaItem', 'event', 'mediaAsset', 'loginAttempt',
  'adminSession', 'adminUser',
] as const

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
  } finally {
    await prisma.$disconnect()
  }
}
