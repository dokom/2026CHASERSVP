/**
 * Pure MongoDB connection-string identity comparison.
 *
 * This module intentionally has NO Prisma import and NO `process.env`
 * access, so it can be unit-tested without a live environment or a
 * generated Prisma client. `tests/helpers/db.ts` is the only place that
 * wires this logic to real environment variables and a real client.
 */

/** Thrown when a connection string cannot be parsed as MongoDB syntax. */
export class DatabaseUrlParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseUrlParseError'
  }
}

// Matches mongodb:// and mongodb+srv://, with an optional `user:pass@`,
// one-or-more comma-separated hosts (each optionally `host:port`), an
// optional `/database` path, and an optional `?query` string. `new URL()`
// cannot parse the multi-host form, which is the canonical production
// replica-set shape (e.g. `mongodb://h1:27017,h2:27017/db?replicaSet=rs0`).
const MONGO_URL_PATTERN =
  /^(?<scheme>mongodb(?:\+srv)?):\/\/(?:[^@/]*@)?(?<hosts>[^/?]+)(?<path>\/[^?]*)?(?:\?.*)?$/

const DEFAULT_PORT = '27017'

/**
 * Normalizes one `host` or `host:port` segment: lowercases the hostname
 * (WHATWG `URL` does not lowercase non-special schemes like `mongodb:` for
 * you) and fills in MongoDB's default port when none is given, so
 * `h` and `h:27017` compare equal. `mongodb+srv://` never carries an
 * explicit port (it's resolved via DNS SRV records), so no port is added.
 */
function normalizeHost(hostSegment: string, scheme: string): string {
  const [hostname, port] = hostSegment.split(':')
  const lowerHostname = hostname.toLowerCase()
  if (scheme === 'mongodb+srv') return lowerHostname
  return `${lowerHostname}:${port ?? DEFAULT_PORT}`
}

/** Normalizes a comma-separated replica-set host list. */
function normalizeHosts(hostsSegment: string, scheme: string): string {
  return hostsSegment
    .split(',')
    .map((host) => normalizeHost(host, scheme))
    .join(',')
}

/**
 * Extracts and normalizes the database name from a `/database` path
 * segment. A trailing slash (`/gala/`) does not change the database name,
 * so it is stripped. Database names stay case-sensitive — MongoDB treats
 * them that way, unlike hostnames.
 */
function normalizeDatabase(pathSegment: string | undefined): string {
  if (!pathSegment) return ''
  return pathSegment.replace(/^\//, '').replace(/\/+$/, '')
}

/**
 * Resolves the physical database identity (normalized host(s) + database
 * name) a MongoDB connection string points at, ignoring differences that
 * don't change which database is actually addressed: embedded credentials,
 * query-string params (e.g. `replicaSet`), default vs. explicit port, host
 * case, and a trailing slash after the database name.
 *
 * `varName` is used only to name the offending environment variable in the
 * error thrown when `url` cannot be parsed at all — this never happens
 * silently, since treating an unparseable string as "just some distinct
 * database" would defeat the whole point of the guard.
 */
export function resolveDatabaseIdentity(url: string, varName: string): string {
  const match = MONGO_URL_PATTERN.exec(url)
  if (!match?.groups) {
    throw new DatabaseUrlParseError(
      `Could not parse ${varName} as a MongoDB connection string. Expected ` +
        'mongodb:// or mongodb+srv:// with a valid host, e.g. ' +
        '"mongodb://host:27017/dbname" or "mongodb+srv://host/dbname".',
    )
  }
  const { scheme, hosts, path } = match.groups
  return `${normalizeHosts(hosts, scheme)}/${normalizeDatabase(path)}`
}

/**
 * Throws if `appUrl` and `testUrl` resolve to the same physical database, so
 * an integration test run can never call `deleteMany()` against the real
 * application database. Compares normalized host(s) + database name rather
 * than raw strings, so near-misses (differing query string, default vs.
 * explicit port, host case, trailing slash, embedded credentials) are all
 * still caught.
 */
export function assertDistinctDatabases(appUrl: string, testUrl: string): void {
  const appIdentity = resolveDatabaseIdentity(appUrl, 'DATABASE_URL')
  const testIdentity = resolveDatabaseIdentity(testUrl, 'DATABASE_URL_TEST')
  if (appIdentity === testIdentity) {
    throw new Error(
      'Refusing to run integration tests: DATABASE_URL_TEST resolves to the same ' +
        'database as DATABASE_URL (same host and database name). Point ' +
        'DATABASE_URL_TEST at a distinct test database before running tests.',
    )
  }
}
