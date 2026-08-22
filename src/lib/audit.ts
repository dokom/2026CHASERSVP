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

/** Keys whose values must never reach the audit table. */
export const REDACTED_KEYS = new Set([
  'token', 'tokenHash', 'password', 'passwordHash', 'sessionToken', 'secret',
])

function redact(meta: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(meta).map(([k, v]) => [k, REDACTED_KEYS.has(k) ? '[redacted]' : v]),
  )
}

/**
 * Writes an audit row. Pass the transaction client when auditing a mutation so
 * the log and the change commit or roll back together.
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
