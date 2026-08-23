import type { PrismaClient, Prisma } from '@prisma/client'

export type AuditRow = {
  id: string
  createdAt: Date
  actor: { name: string; email: string } | null
  action: string
  entity: string
  entityId: string | null
  meta: unknown
  ip: string | null
}

export type AuditQuery = {
  actorId?: string
  entity?: string
  action?: string
  from?: Date
  to?: Date
  page: number
  pageSize: number
}

/** MongoDB ObjectId shape — 24 hex characters. */
const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/

function isValidObjectId(id: string): boolean {
  return OBJECT_ID_RE.test(id)
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0))
}

function endOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999))
}

function buildCreatedAtFilter(from?: Date, to?: Date): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined
  return {
    ...(from ? { gte: startOfDay(from) } : {}),
    ...(to ? { lte: endOfDay(to) } : {}),
  }
}

function toRow(raw: {
  id: string
  createdAt: Date
  actor: { name: string; email: string } | null
  action: string
  entity: string
  entityId: string | null
  meta: unknown
  ip: string | null
}): AuditRow {
  return {
    id: raw.id,
    createdAt: raw.createdAt,
    actor: raw.actor ? { name: raw.actor.name, email: raw.actor.email } : null,
    action: raw.action,
    entity: raw.entity,
    entityId: raw.entityId,
    meta: raw.meta,
    ip: raw.ip,
  }
}

/**
 * Lists audit rows, newest first, filtered by actor/entity/action-prefix/date
 * range and paginated. `actorId` is a MongoDB ObjectId filter — an
 * unparseable id (e.g. tampered query string) returns an empty page rather
 * than throwing, mirroring the guard used for `findUnique` elsewhere.
 */
export async function listAudit(
  db: PrismaClient,
  query: AuditQuery,
): Promise<{ rows: AuditRow[]; total: number }> {
  if (query.actorId !== undefined && !isValidObjectId(query.actorId)) {
    return { rows: [], total: 0 }
  }

  const createdAt = buildCreatedAtFilter(query.from, query.to)
  const where: Prisma.AuditLogWhereInput = {
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.entity ? { entity: query.entity } : {}),
    ...(query.action ? { action: { startsWith: query.action } } : {}),
    ...(createdAt ? { createdAt } : {}),
  }

  const [raw, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      include: { actor: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db.auditLog.count({ where }),
  ])

  return { rows: raw.map(toRow), total }
}

/** Distinct entity names that have at least one audit row, sorted alphabetically. */
export async function distinctEntities(db: PrismaClient): Promise<string[]> {
  const rows = await db.auditLog.findMany({
    distinct: ['entity'],
    select: { entity: true },
  })
  return rows.map((r) => r.entity).sort()
}
