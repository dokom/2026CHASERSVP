import type { Prisma, PrismaClient } from '@prisma/client'
import { hashToken } from '@/lib/crypto/tokens'
import { deriveInviteStatus, type InviteStatus } from '@/lib/invites/status'
import { writeAudit } from '@/lib/audit'
import { rsvpWindow } from './deadline'
import type { GuestEntry, RsvpSubmission } from '@/lib/validation/guest'

export type RsvpResult =
  | { ok: true; inviteId: string; status: InviteStatus }
  | { ok: false; reason: 'NOT_FOUND' | 'CLOSED' | 'SEAT_LIMIT' | 'FOREIGN_GUEST' }

/** Thrown internally to short-circuit the transaction when the seat limit is exceeded. */
export class SeatAllowanceError extends Error {
  constructor() {
    super('Requested party size exceeds the seat allowance')
    this.name = 'SeatAllowanceError'
  }
}

/** Thrown internally to short-circuit the transaction when a guest id is not this invite's own. */
export class ForeignGuestError extends Error {
  constructor() {
    super('Submitted guest id does not belong to this invite')
    this.name = 'ForeignGuestError'
  }
}

function toGuestData(entry: GuestEntry): Omit<Prisma.GuestUncheckedCreateInput, 'inviteId'> {
  return {
    firstName: entry.firstName,
    lastName: entry.lastName,
    badgeName: entry.badgeName || null,
    company: entry.company || null,
    title: entry.title || null,
    email: entry.email || null,
    phone: entry.phone || null,
    mealOptionId: entry.mealOptionId || null,
    dietary: entry.dietary,
    accessibilityNeeds: entry.accessibilityNeeds || null,
    attending: true,
  }
}

/**
 * Upserts every submitted guest for an attending party and deletes any
 * previously-known guest the party did not resubmit (a seat given back).
 * `submittedIds` — ids already verified to belong to this invite — seeds the
 * kept set so newly-created guests can be added to it as they're made.
 */
async function applyAttendingGuests(
  tx: Prisma.TransactionClient,
  inviteId: string,
  guests: GuestEntry[],
  submittedIds: string[],
): Promise<void> {
  const keptIds = new Set(submittedIds)

  for (const entry of guests) {
    const data = toGuestData(entry)
    if (entry.id) {
      await tx.guest.update({ where: { id: entry.id }, data })
    } else {
      const created = await tx.guest.create({ data: { ...data, inviteId } })
      keptIds.add(created.id)
    }
  }

  await tx.guest.deleteMany({
    where: { inviteId, id: { notIn: [...keptIds] } },
  })
}

/**
 * Applies a guest's RSVP.
 *
 * The whole thing is one transaction: a party that half-submits is worse than
 * one that fails, because nobody notices. `now` and `deadline` are parameters
 * rather than reads of the clock or the database so the boundary is testable.
 */
export async function submitRsvp(
  db: PrismaClient,
  token: string,
  submission: RsvpSubmission,
  now: Date,
  deadline: Date,
): Promise<RsvpResult> {
  if (!token) return { ok: false, reason: 'NOT_FOUND' }
  if (rsvpWindow(deadline, now).hasClosed) return { ok: false, reason: 'CLOSED' }

  const invite = await db.invite.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, seatsAllotted: true, guests: { select: { id: true } } },
  })
  if (!invite) return { ok: false, reason: 'NOT_FOUND' }

  if (submission.attending && submission.guests.length > invite.seatsAllotted) {
    return { ok: false, reason: 'SEAT_LIMIT' }
  }

  // Every submitted id must already belong to THIS invite. Without this a guest
  // could rewrite another party's details by pasting their guest id.
  const ownIds = new Set(invite.guests.map((g) => g.id))
  const submittedIds = submission.guests.map((g) => g.id).filter((id): id is string => !!id)
  if (submittedIds.some((id) => !ownIds.has(id))) {
    return { ok: false, reason: 'FOREIGN_GUEST' }
  }

  const status = await db.$transaction(async (tx) => {
    if (!submission.attending) {
      await tx.guest.updateMany({ where: { inviteId: invite.id }, data: { attending: false } })
    } else {
      await applyAttendingGuests(tx, invite.id, submission.guests, submittedIds)
    }

    const guests = await tx.guest.findMany({
      where: { inviteId: invite.id },
      select: { attending: true },
    })
    const nextStatus = deriveInviteStatus(guests)

    await tx.invite.update({
      where: { id: invite.id },
      data: {
        status: nextStatus,
        respondedAt: now,
        ...(submission.extraSeatsRequested > 0
          ? {
              extraSeatsRequested: submission.extraSeatsRequested,
              extraSeatsStatus: 'PENDING' as const,
              extraSeatsReason: submission.extraSeatsReason || null,
            }
          : {}),
      },
    })

    await writeAudit(tx, {
      actorId: null,
      action: 'rsvp.submit',
      entity: 'Invite',
      entityId: invite.id,
      meta: {
        attending: submission.attending,
        partySize: submission.guests.length,
        extraSeatsRequested: submission.extraSeatsRequested,
      },
    })

    return nextStatus
  })

  return { ok: true, inviteId: invite.id, status }
}
