import type { PrismaClient } from '@prisma/client'
import { hashToken } from '@/lib/crypto/tokens'
import { writeAudit } from '@/lib/audit'

export type PartyGuest = {
  id: string
  firstName: string
  lastName: string
  badgeName: string | null
  company: string | null
  tableNumber: string | null
  attending: boolean | null
  checkedInAt: Date | null
}

export type Party = {
  inviteId: string
  label: string
  tableNumber: string | null
  guests: PartyGuest[]
}

export type CheckInResult =
  | { ok: true; checkedInAt: Date; alreadyCheckedIn: boolean; wasDeclined: boolean }
  | { ok: false; reason: 'NOT_FOUND' }

/**
 * MongoDB ids are ObjectIds: `findUnique` on a malformed id THROWS rather than
 * returning null. Guest ids arrive from the scanner's POST body, so an
 * unparseable one means "not found", not a 500.
 */
function isMalformedIdError(error: unknown): boolean {
  return error instanceof Error && /malformed objectid/i.test(error.message)
}

/** What the door sees after a scan. Lookup is by tokenHash, never by id. */
export async function resolvePartyByToken(db: PrismaClient, token: string): Promise<Party | null> {
  if (!token) return null
  const invite = await db.invite.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true, label: true, tableNumber: true,
      guests: {
        select: {
          id: true, firstName: true, lastName: true, badgeName: true, company: true,
          tableNumber: true, attending: true, checkedInAt: true,
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
    },
  })
  if (!invite) return null
  return { inviteId: invite.id, label: invite.label, tableNumber: invite.tableNumber, guests: invite.guests }
}

/**
 * Idempotent by design: the offline queue replays, and a staff member will
 * double-tap. A second check-in reports the ORIGINAL time and writes nothing.
 * A guest who declined and turned up anyway is checked in — reality at the
 * door beats the RSVP — and the result says so.
 */
export async function checkInGuest(
  db: PrismaClient, actorId: string, guestId: string, at: Date,
): Promise<CheckInResult> {
  const guest = await db.guest
    .findUnique({ where: { id: guestId }, select: { id: true, attending: true, checkedInAt: true } })
    .catch((error: unknown) => { if (isMalformedIdError(error)) return null; throw error })
  if (!guest) return { ok: false, reason: 'NOT_FOUND' }

  const wasDeclined = guest.attending === false
  if (guest.checkedInAt) {
    return { ok: true, checkedInAt: guest.checkedInAt, alreadyCheckedIn: true, wasDeclined }
  }

  await db.$transaction(async (tx) => {
    await tx.guest.update({ where: { id: guestId }, data: { checkedInAt: at, checkedInById: actorId } })
    await writeAudit(tx, {
      actorId, action: 'guest.checkIn', entity: 'Guest', entityId: guestId,
      meta: { at: at.toISOString(), wasDeclined },
    })
  })
  return { ok: true, checkedInAt: at, alreadyCheckedIn: false, wasDeclined }
}

export async function undoCheckIn(db: PrismaClient, actorId: string, guestId: string): Promise<{ ok: boolean }> {
  const guest = await db.guest
    .findUnique({ where: { id: guestId }, select: { checkedInAt: true } })
    .catch((error: unknown) => { if (isMalformedIdError(error)) return null; throw error })
  if (!guest) return { ok: false }
  if (!guest.checkedInAt) return { ok: true }

  await db.$transaction(async (tx) => {
    await tx.guest.update({ where: { id: guestId }, data: { checkedInAt: null, checkedInById: null } })
    await writeAudit(tx, { actorId, action: 'guest.undoCheckIn', entity: 'Guest', entityId: guestId })
  })
  return { ok: true }
}

export async function checkInProgress(db: PrismaClient): Promise<{ attending: number; checkedIn: number }> {
  const [attending, checkedIn] = await Promise.all([
    db.guest.count({ where: { attending: true } }),
    db.guest.count({ where: { checkedInAt: { not: null } } }),
  ])
  return { attending, checkedIn }
}
