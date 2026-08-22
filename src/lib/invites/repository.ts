import type { PrismaClient, Prisma } from '@prisma/client'
import { generateInviteToken, hashToken } from '@/lib/crypto/tokens'
import { seal, open } from '@/lib/crypto/secret-box'
import { getEnv } from '@/lib/env'
import { deriveInviteStatus, type InviteStatus } from './status'
import { writeAudit, type AuditClient } from '@/lib/audit'

export class SeatLimitError extends Error {
  constructor(seats: number, guests: number) {
    super(`Cannot reduce to ${seats} seats — this invite already has ${guests} guests`)
    this.name = 'SeatLimitError'
  }
}

export type InviteRow = {
  id: string
  label: string
  seatsAllotted: number
  status: InviteStatus
  tableNumber: string | null
  extraSeatsRequested: number
  extraSeatsStatus: 'NONE' | 'PENDING' | 'APPROVED' | 'DENIED'
  respondedAt: Date | null
  createdAt: Date
  guestCount: number
}

const ROW_SELECT = {
  id: true, label: true, seatsAllotted: true, status: true, tableNumber: true,
  extraSeatsRequested: true, extraSeatsStatus: true, respondedAt: true, createdAt: true,
  _count: { select: { guests: true } },
} satisfies Prisma.InviteSelect

type RawRow = Prisma.InviteGetPayload<{ select: typeof ROW_SELECT }>

function toRow(raw: RawRow): InviteRow {
  const { _count, ...rest } = raw
  return { ...rest, guestCount: _count.guests } as InviteRow
}

export type CreateInviteInput = {
  label: string
  seatsAllotted: number
  tableNumber?: string
  adminNotes?: string
  primaryGuest: {
    firstName: string
    lastName: string
    email?: string
    company?: string
    title?: string
  }
}

export async function createInvite(
  db: PrismaClient,
  actorId: string | null,
  input: CreateInviteInput,
): Promise<{ invite: InviteRow; token: string }> {
  const token = generateInviteToken()

  const invite = await db.$transaction(async (tx) => {
    const created = await tx.invite.create({
      data: {
        tokenHash: hashToken(token),
        tokenCipher: seal(token, getEnv().SESSION_SECRET),
        label: input.label,
        seatsAllotted: input.seatsAllotted,
        tableNumber: input.tableNumber || null,
        adminNotes: input.adminNotes || null,
        guests: {
          create: {
            firstName: input.primaryGuest.firstName,
            lastName: input.primaryGuest.lastName,
            email: input.primaryGuest.email || null,
            company: input.primaryGuest.company || null,
            title: input.primaryGuest.title || null,
            isPrimary: true,
          },
        },
      },
      select: ROW_SELECT,
    })
    await writeAudit(tx, {
      actorId,
      action: 'invite.create',
      entity: 'Invite',
      entityId: created.id,
      meta: { label: input.label, seatsAllotted: input.seatsAllotted },
    })
    return created
  })

  return { invite: toRow(invite), token }
}

export type InviteQuery = {
  search?: string
  status?: InviteStatus
  page?: number
  pageSize?: number
}

export async function listInvites(
  db: PrismaClient,
  query: InviteQuery,
): Promise<{ rows: InviteRow[]; total: number }> {
  const page = query.page ?? 1
  const pageSize = query.pageSize ?? 50
  const search = query.search?.trim()

  const where: Prisma.InviteWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(search
      ? {
          OR: [
            { label: { contains: search, mode: 'insensitive' } },
            { guests: { some: { firstName: { contains: search, mode: 'insensitive' } } } },
            { guests: { some: { lastName: { contains: search, mode: 'insensitive' } } } },
            { guests: { some: { email: { contains: search, mode: 'insensitive' } } } },
            { guests: { some: { company: { contains: search, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  }

  const [raw, total] = await Promise.all([
    db.invite.findMany({
      where,
      select: ROW_SELECT,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.invite.count({ where }),
  ])

  return { rows: raw.map(toRow), total }
}

export type InviteDetail = InviteRow & {
  adminNotes: string | null
  extraSeatsReason: string | null
  guests: {
    id: string
    firstName: string
    lastName: string
    badgeName: string | null
    company: string | null
    title: string | null
    email: string | null
    phone: string | null
    isPrimary: boolean
    attending: boolean | null
    tableNumber: string | null
  }[]
}

/**
 * MongoDB ids are ObjectIds: `findUnique` on a malformed id THROWS rather than
 * returning null. Ids arrive straight from URLs, so an unparseable one means
 * "not found", not a 500.
 */
function isMalformedIdError(error: unknown): boolean {
  return error instanceof Error && /malformed objectid/i.test(error.message)
}

export async function getInvite(db: PrismaClient, id: string): Promise<InviteDetail | null> {
  const raw = await db.invite
    .findUnique({
      where: { id },
      select: {
        ...ROW_SELECT,
        adminNotes: true,
        extraSeatsReason: true,
        guests: {
          select: {
            id: true, firstName: true, lastName: true, badgeName: true, company: true,
            title: true, email: true, phone: true, isPrimary: true, attending: true,
            tableNumber: true,
          },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
      },
    })
    .catch((error: unknown) => {
      if (isMalformedIdError(error)) return null
      throw error
    })
  if (!raw) return null
  const { _count, ...rest } = raw
  return { ...rest, guestCount: _count.guests } as InviteDetail
}

export type UpdateInvitePatch = {
  label?: string
  seatsAllotted?: number
  tableNumber?: string
  adminNotes?: string
}

export async function updateInvite(
  db: PrismaClient,
  actorId: string | null,
  id: string,
  patch: UpdateInvitePatch,
): Promise<void> {
  await db.$transaction(async (tx) => {
    if (patch.seatsAllotted !== undefined) {
      const guests = await tx.guest.count({ where: { inviteId: id } })
      if (patch.seatsAllotted < guests) throw new SeatLimitError(patch.seatsAllotted, guests)
    }
    await tx.invite.update({
      where: { id },
      data: {
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.seatsAllotted !== undefined ? { seatsAllotted: patch.seatsAllotted } : {}),
        ...(patch.tableNumber !== undefined ? { tableNumber: patch.tableNumber || null } : {}),
        ...(patch.adminNotes !== undefined ? { adminNotes: patch.adminNotes || null } : {}),
      },
    })
    await writeAudit(tx, {
      actorId, action: 'invite.update', entity: 'Invite', entityId: id, meta: { ...patch },
    })
  })
}

export async function regenerateInviteToken(
  db: PrismaClient,
  actorId: string | null,
  id: string,
): Promise<string> {
  const token = generateInviteToken()
  await db.$transaction(async (tx) => {
    await tx.invite.update({
      where: { id },
      data: { tokenHash: hashToken(token), tokenCipher: seal(token, getEnv().SESSION_SECRET) },
    })
    await writeAudit(tx, {
      actorId, action: 'invite.regenerateToken', entity: 'Invite', entityId: id,
    })
  })
  return token
}

export async function deleteInvite(
  db: PrismaClient,
  actorId: string | null,
  id: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const invite = await tx.invite.findUniqueOrThrow({ where: { id }, select: { label: true } })
    await tx.invite.delete({ where: { id } })
    await writeAudit(tx, {
      actorId, action: 'invite.delete', entity: 'Invite', entityId: id,
      meta: { label: invite.label },
    })
  })
}

export async function resolveExtraSeats(
  db: PrismaClient,
  actorId: string | null,
  id: string,
  decision: 'APPROVED' | 'DENIED',
): Promise<void> {
  await db.$transaction(async (tx) => {
    const invite = await tx.invite.findUniqueOrThrow({
      where: { id },
      select: { seatsAllotted: true, extraSeatsRequested: true },
    })
    await tx.invite.update({
      where: { id },
      data: {
        extraSeatsStatus: decision,
        ...(decision === 'APPROVED'
          ? { seatsAllotted: invite.seatsAllotted + invite.extraSeatsRequested }
          : {}),
      },
    })
    await writeAudit(tx, {
      actorId, action: 'invite.resolveExtraSeats', entity: 'Invite', entityId: id,
      meta: { decision, requested: invite.extraSeatsRequested },
    })
  })
}

/**
 * Recovers the plaintext tokens for QR export. Reads `tokenCipher`, never the hash.
 * Invites whose cipher cannot be opened (wrong or rotated SESSION_SECRET) are
 * omitted rather than throwing, so one bad row does not break a 1000-code export.
 */
export async function listInviteTokens(
  db: PrismaClient,
  where: Prisma.InviteWhereInput = {},
): Promise<{ id: string; label: string; token: string }[]> {
  const secret = getEnv().SESSION_SECRET
  const rows = await db.invite.findMany({
    where,
    select: { id: true, label: true, tokenCipher: true },
    orderBy: { label: 'asc' },
  })

  const out: { id: string; label: string; token: string }[] = []
  for (const row of rows) {
    try {
      out.push({ id: row.id, label: row.label, token: open(row.tokenCipher, secret) })
    } catch {
      // Unrecoverable token — the operator must regenerate this invite.
    }
  }
  return out
}

export async function getInviteToken(db: PrismaClient, id: string): Promise<string | null> {
  const row = await db.invite
    .findUnique({ where: { id }, select: { tokenCipher: true } })
    .catch((error: unknown) => {
      if (isMalformedIdError(error)) return null
      throw error
    })
  if (!row) return null
  try {
    return open(row.tokenCipher, getEnv().SESSION_SECRET)
  } catch {
    return null
  }
}

/** Recomputes and persists an invite's status. Call inside the transaction that changed attendance. */
export async function recomputeInviteStatus(tx: AuditClient, inviteId: string): Promise<void> {
  const guests = await tx.guest.findMany({
    where: { inviteId },
    select: { attending: true },
  })
  await tx.invite.update({
    where: { id: inviteId },
    data: { status: deriveInviteStatus(guests) },
  })
}
