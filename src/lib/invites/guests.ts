import type { PrismaClient, Prisma } from '@prisma/client'
import { writeAudit } from '@/lib/audit'
import { recomputeInviteStatus } from './repository'

export class GuestCheckedInError extends Error {
  constructor() {
    super('This guest has already checked in and cannot be removed')
    this.name = 'GuestCheckedInError'
  }
}

export type GuestDetails = {
  firstName: string
  lastName: string
  email?: string
  company?: string
  title?: string
  tableNumber?: string
}

function toData(details: GuestDetails) {
  return {
    firstName: details.firstName,
    lastName: details.lastName,
    email: details.email || null,
    company: details.company || null,
    title: details.title || null,
    tableNumber: details.tableNumber || null,
  }
}

/**
 * Attaches a person to an invite — this is how a printed placeholder becomes
 * somebody's invitation. The first guest on an invite becomes its primary,
 * whose name the guest page greets and whose answer gates the seat reveal.
 */
export async function addGuest(
  db: PrismaClient,
  actorId: string | null,
  inviteId: string,
  details: GuestDetails,
): Promise<string> {
  return db.$transaction(async (tx) => {
    const invite = await tx.invite.findUniqueOrThrow({
      where: { id: inviteId },
      select: { _count: { select: { guests: true } } },
    })

    // Touch the invite document so two admins adding the first guest at once
    // conflict instead of both becoming primary.
    await tx.invite.update({ where: { id: inviteId }, data: { updatedAt: new Date() } })

    const guest = await tx.guest.create({
      data: { inviteId, ...toData(details), isPrimary: invite._count.guests === 0 },
      select: { id: true },
    })
    await recomputeInviteStatus(tx, inviteId)
    await writeAudit(tx, {
      actorId, action: 'guest.add', entity: 'Guest', entityId: guest.id,
      meta: { inviteId, firstName: details.firstName, lastName: details.lastName },
    })
    return guest.id
  })
}

export class GuestNotOnInviteError extends Error {
  constructor() {
    super('That guest is not on this invite')
    this.name = 'GuestNotOnInviteError'
  }
}

/**
 * The admin form names both the invite and the guest; insist they agree.
 * An admin can edit any guest anyway, so this is not a privilege boundary —
 * it keeps a stale form (guest moved or deleted by a colleague) from
 * quietly editing one invite's guest under another invite's page.
 */
async function requireGuestOnInvite(
  tx: Prisma.TransactionClient,
  inviteId: string,
  guestId: string,
): Promise<{ isPrimary: boolean; checkedInAt: Date | null }> {
  const guest = await tx.guest.findUnique({
    where: { id: guestId },
    select: { inviteId: true, isPrimary: true, checkedInAt: true },
  })
  if (!guest || guest.inviteId !== inviteId) throw new GuestNotOnInviteError()
  return guest
}

export async function updateGuest(
  db: PrismaClient,
  actorId: string | null,
  inviteId: string,
  guestId: string,
  details: GuestDetails,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await requireGuestOnInvite(tx, inviteId, guestId)
    await tx.guest.update({ where: { id: guestId }, data: toData(details) })
    await writeAudit(tx, {
      actorId, action: 'guest.update', entity: 'Guest', entityId: guestId,
      meta: { inviteId, firstName: details.firstName, lastName: details.lastName },
    })
  })
}

/**
 * Removes a guest and, if they were the primary, promotes the next one so
 * the invite never loses the person the guest page greets. A checked-in
 * guest is never removed: their arrival is a fact of the evening.
 */
export async function removeGuest(
  db: PrismaClient,
  actorId: string | null,
  inviteId: string,
  guestId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const guest = await requireGuestOnInvite(tx, inviteId, guestId)
    if (guest.checkedInAt) throw new GuestCheckedInError()

    await tx.guest.delete({ where: { id: guestId } })

    if (guest.isPrimary) {
      const next = await tx.guest.findFirst({
        where: { inviteId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      })
      if (next) await tx.guest.update({ where: { id: next.id }, data: { isPrimary: true } })
    }

    await recomputeInviteStatus(tx, inviteId)
    await writeAudit(tx, {
      actorId, action: 'guest.remove', entity: 'Guest', entityId: guestId,
      meta: { inviteId },
    })
  })
}
