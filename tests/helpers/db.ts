import { PrismaClient } from '@prisma/client'

const url = process.env.DATABASE_URL_TEST
if (!url) throw new Error('DATABASE_URL_TEST is required to run integration tests')

export const testDb = new PrismaClient({ datasources: { db: { url } } })

/** Child collections first, so cascade emulation never races a parent delete. */
const MODELS = [
  'auditLog', 'guest', 'invite', 'tableMarker', 'mealOption',
  'agendaItem', 'event', 'mediaAsset', 'loginAttempt',
  'adminSession', 'adminUser',
] as const

// MongoDB has no TRUNCATE; deleteMany per collection is the equivalent.
export async function resetDb(): Promise<void> {
  for (const model of MODELS) {
    await (testDb[model] as { deleteMany: () => Promise<unknown> }).deleteMany()
  }
}
