import type { PrismaClient, Prisma } from '@prisma/client'

export type AuditClient = PrismaClient | Prisma.TransactionClient

export type AuditEntry = {
  actorId: string | null
  action: string
  entity: string
  entityId?: string | null
  meta?: Record<string, unknown>
  ip?: string | null
}

/** Keys whose values must never reach the audit table, at any nesting depth. */
export const REDACTED_KEYS = new Set([
  'token', 'tokenHash', 'password', 'passwordHash', 'sessionToken', 'secret',
])

const MAX_DEPTH = 5
const MAX_NODES = 2000
const MAX_STRING_LEN = 2000
const TRUNCATE_SUFFIX = '…[truncated]'
const MAX_META_BYTES = 16 * 1024

type RedactState = { nodes: number }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LEN) return value
  return `${value.slice(0, MAX_STRING_LEN)}${TRUNCATE_SUFFIX}`
}

/**
 * Redacts a container (object or array), recursing into its members.
 * Non-mutating: always returns a new structure. Ancestors are tracked to
 * detect circular references, and depth/node budgets bound the work so a
 * pathological input can't hang the writer.
 */
function redactContainer(
  value: unknown[] | Record<string, unknown>,
  depth: number,
  ancestors: Set<unknown>,
  state: RedactState,
): unknown {
  if (ancestors.has(value)) return '[circular]'
  if (depth >= MAX_DEPTH) return '[truncated]'
  const nextAncestors = new Set(ancestors)
  nextAncestors.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, null, depth + 1, nextAncestors, state))
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    out[k] = state.nodes > MAX_NODES
      ? '[truncated]'
      : redactValue(v, k, depth + 1, nextAncestors, state)
  }
  return out
}

function redactValue(
  value: unknown,
  key: string | null,
  depth: number,
  ancestors: Set<unknown>,
  state: RedactState,
): unknown {
  state.nodes += 1
  if (state.nodes > MAX_NODES) return '[truncated]'
  if (key !== null && REDACTED_KEYS.has(key)) return '[redacted]'
  if (typeof value === 'string') return truncateString(value)
  if (Array.isArray(value)) return redactContainer(value, depth, ancestors, state)
  if (isPlainObject(value)) return redactContainer(value, depth, ancestors, state)
  return value
}

/**
 * Caps the total serialized size of an already-redacted meta document. If it
 * still exceeds the cap (or can't be serialized at all), the whole thing is
 * replaced with a small marker rather than thrown — an audit write must
 * never be able to fail the transaction it's recording.
 */
function capMetaSize(meta: Record<string, unknown>): Record<string, unknown> {
  let serialized: string
  try {
    serialized = JSON.stringify(meta)
  } catch {
    return { _dropped: true, reason: 'meta could not be serialized' }
  }
  if (Buffer.byteLength(serialized, 'utf8') <= MAX_META_BYTES) return meta
  return { _dropped: true, reason: 'meta exceeded size limit after truncation' }
}

function redact(meta: Record<string, unknown>): Record<string, unknown> {
  const state: RedactState = { nodes: 0 }
  const redacted = redactValue(meta, null, 0, new Set(), state) as Record<string, unknown>
  return capMetaSize(redacted)
}

/**
 * Writes an audit row. Pass the transaction client when auditing a mutation so
 * the log and the change commit or roll back together. `meta` is redacted and
 * size-capped defensively, since it carries attacker-influenced input.
 */
export async function writeAudit(tx: AuditClient, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      meta: entry.meta ? redact(entry.meta) : undefined,
      ip: entry.ip ?? null,
    },
  })
}
