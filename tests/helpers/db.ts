import { PrismaClient } from '@prisma/client'
import { parseEnv } from '@/lib/env'

/**
 * Resolves the physical database identity (host + database name) a MongoDB
 * connection string points at, ignoring query-string differences like
 * `replicaSet` that don't change which database is actually addressed.
 */
function resolveDatabaseIdentity(url: string): string {
  const parsed = new URL(url)
  const databaseName = parsed.pathname.replace(/^\//, '')
  return `${parsed.host}/${databaseName}`
}

/**
 * Throws if `appUrl` and `testUrl` resolve to the same physical database, so
 * an integration test run can never call `deleteMany()` against the real
 * application database. Compares host + database name rather than raw
 * strings, so near-misses like differing query strings are still caught.
 */
export function assertDistinctDatabases(appUrl: string, testUrl: string): void {
  if (resolveDatabaseIdentity(appUrl) === resolveDatabaseIdentity(testUrl)) {
    throw new Error(
      'Refusing to run integration tests: DATABASE_URL_TEST resolves to the same ' +
        'database as DATABASE_URL (same host and database name). Point ' +
        'DATABASE_URL_TEST at a distinct test database before running tests.',
    )
  }
}

// parseEnv() validates the full environment (and already rejects an exact
// DATABASE_URL_TEST === DATABASE_URL match); assertDistinctDatabases() adds
// a host+database comparison so near-misses (e.g. a differing query string)
// are caught too. Both run before the Prisma client is constructed, so a
// misconfigured environment can never reach resetDb()'s deleteMany() calls.
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
