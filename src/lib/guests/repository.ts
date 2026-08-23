import type { PrismaClient, Prisma } from '@prisma/client'

export type GuestListRow = {
  id: string
  inviteId: string
  inviteLabel: string
  firstName: string
  lastName: string
  badgeName: string | null
  company: string | null
  title: string | null
  email: string | null
  phone: string | null
  attending: boolean | null
  mealOptionId: string | null
  meal: string | null
  dietary: string[]
  accessibilityNeeds: string | null
  table: string | null
  checkedInAt: Date | null
}

const SELECT = {
  id: true, inviteId: true, firstName: true, lastName: true, badgeName: true,
  company: true, title: true, email: true, phone: true, attending: true,
  mealOptionId: true, dietary: true, accessibilityNeeds: true, tableNumber: true,
  checkedInAt: true,
  invite: { select: { label: true, tableNumber: true } },
  mealOption: { select: { label: true } },
} satisfies Prisma.GuestSelect

type RawRow = Prisma.GuestGetPayload<{ select: typeof SELECT }>

/** `table` prefers the guest's own seat over the party's default. */
function toRow(raw: RawRow): GuestListRow {
  const { invite, mealOption, tableNumber, ...rest } = raw
  return {
    ...rest,
    inviteLabel: invite.label,
    meal: mealOption?.label ?? null,
    table: tableNumber ?? invite.tableNumber,
  }
}

export type GuestQuery = {
  search?: string
  attending?: 'yes' | 'no' | 'unanswered'
  mealOptionId?: string
  checkedIn?: boolean
  page?: number
  pageSize?: number
}

function buildWhere(query: GuestQuery): Prisma.GuestWhereInput {
  const search = query.search?.trim()
  const attendingFilter: Record<string, boolean | null> = {
    yes: true as const,
    no: false as const,
    unanswered: null,
  }

  return {
    ...(search
      ? {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { company: { contains: search, mode: 'insensitive' } },
            { invite: { label: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
    ...(query.attending !== undefined ? { attending: attendingFilter[query.attending] } : {}),
    ...(query.mealOptionId ? { mealOptionId: query.mealOptionId } : {}),
    ...(query.checkedIn !== undefined
      ? { checkedInAt: query.checkedIn ? { not: null } : null }
      : {}),
  }
}

export async function listGuests(
  db: PrismaClient,
  query: GuestQuery,
): Promise<{ rows: GuestListRow[]; total: number }> {
  const page = query.page ?? 1
  const pageSize = query.pageSize ?? 50
  const where = buildWhere(query)

  const [raw, total] = await Promise.all([
    db.guest.findMany({
      where,
      select: SELECT,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.guest.count({ where }),
  ])

  return { rows: raw.map(toRow), total }
}

const EXPORT_BATCH_SIZE = 500

/**
 * Streams every guest for the CSV export, paging by `skip/take` rather than
 * loading the whole table into memory — the guest list can run into the
 * thousands for a large gala. `batchSize` defaults to 500 in production; the
 * integration suite lowers it to prove multi-batch behaviour without
 * seeding hundreds of rows.
 */
export async function* allGuestsForExport(
  db: PrismaClient,
  batchSize: number = EXPORT_BATCH_SIZE,
): AsyncIterable<GuestListRow> {
  let skip = 0
  for (;;) {
    const page = await db.guest.findMany({
      select: SELECT,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      skip,
      take: batchSize,
    })
    for (const raw of page) yield toRow(raw)
    if (page.length < batchSize) return
    skip += batchSize
  }
}
