import { PrismaClient } from '@prisma/client'
import { parseEnv } from '@/lib/env'
import { assertDistinctDatabases } from '@/lib/db-identity'

// parseEnv() validates the full environment (and already rejects an exact
// DATABASE_URL_TEST === DATABASE_URL match); assertDistinctDatabases() adds
// a normalized host+database comparison (see src/lib/db-identity.ts) so
// near-misses — differing query strings, default vs. explicit port, host
// case, trailing slashes, embedded credentials — are caught too. Both run
// before the Prisma client is constructed, so a misconfigured environment
// can never reach resetDb()'s deleteMany() calls.
const env = parseEnv(process.env)
assertDistinctDatabases(env.DATABASE_URL, env.DATABASE_URL_TEST)

export const testDb = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL_TEST } } })

// MongoDB deleteMany() has no foreign-key enforcement, so this order has no
// effect on correctness — it's just a stable, easy-to-scan order for
// debugging output.
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
