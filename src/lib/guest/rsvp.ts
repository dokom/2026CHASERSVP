import type { Prisma, PrismaClient } from '@prisma/client'
import { hashToken } from '@/lib/crypto/tokens'
import { deriveInviteStatus, type InviteStatus } from '@/lib/invites/status'
import { writeAudit } from '@/lib/audit'
import { rsvpWindow } from './deadline'
import type { GuestResponse, RsvpSubmission } from '@/lib/validation/guest'

export type RsvpResult =
  | { ok: true; inviteId: string; status: InviteStatus }
  | {
      ok: false
      reason:
        | 'NOT_FOUND'
        | 'CLOSED'
        | 'SEAT_LIMIT'
        | 'FOREIGN_GUEST'
        | 'DUPLICATE_GUEST'
        | 'INVALID_MEAL_OPTION'
    }

type Refusal = Extract<RsvpResult, { ok: false }>['reason']
type KnownGuest = { id: string; isPrimary: boolean; firstName: string; lastName: string }
type KnownResponse = GuestResponse & { id: string }

const SELECT_INVITE = {
  id: true,
  seatsAllotted: true,
  guests: {
    select: { id: true, isPrimary: true, firstName: true, lastName: true },
    orderBy: { createdAt: 'asc' as const },
  },
}

/** A companion the guest added without naming them: "Guest of Jordan Reyes". */
function companionName(host: KnownGuest | undefined, entry: GuestResponse): { firstName: string; lastName: string } {
  return {
    firstName: entry.firstName || (host ? `Guest of ${host.firstName}` : 'Guest'),
    lastName: entry.lastName || host?.lastName || '',
  }
}

/**
 * Records a known guest's answer. Only `attending` and (when coming) the meal
 * are written. Everything the organiser imported (name, company, email) and
 * everything the door has done (table, check-in) is structurally untouched:
 * this update never spreads a whole object over the row.
 */
async function answerForKnownGuest(tx: Prisma.TransactionClient, entry: KnownResponse): Promise<void> {
  await tx.guest.update({
    where: { id: entry.id },
    data: {
      attending: entry.attending,
      ...(entry.attending ? { mealOptionId: entry.mealOptionId || null } : {}),
    },
  })
}

/** Ids that repeat, or that belong to some other party, refuse the whole submission. */
function checkSubmittedIds(submittedIds: string[], known: KnownGuest[]): Refusal | null {
  // Two entries claiming the same id collapse to one row: without this check,
  // [id1, id1] on a 2-seat party would silently answer for one guest twice.
  if (new Set(submittedIds).size !== submittedIds.length) return 'DUPLICATE_GUEST'
  // Every submitted id must already belong to THIS invite. Without this a guest
  // could answer for another party's members by pasting their guest id.
  const ownIds = new Set(known.map((g) => g.id))
  if (submittedIds.some((id) => !ownIds.has(id))) return 'FOREIGN_GUEST'
  return null
}

/**
 * A submitted mealOptionId is just an ObjectId-shaped string at this point.
 * Mongo has no foreign key to stop a retired option or an unrelated
 * document's id from being written through, so intersect against the active
 * options actually referenced instead of trusting the shape check alone.
 */
async function hasOnlyActiveMeals(db: PrismaClient, guests: GuestResponse[]): Promise<boolean> {
  const mealIds = guests
    .filter((g) => g.attending)
    .map((g) => g.mealOptionId)
    .filter((id): id is string => !!id)
  if (mealIds.length === 0) return true
  const active = await db.mealOption.findMany({ where: { id: { in: mealIds }, isActive: true }, select: { id: true } })
  const activeIds = new Set(active.map((m) => m.id))
  return mealIds.every((id) => activeIds.has(id))
}

/**
 * Applies a party's RSVP.
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

  const invite = await db.invite.findUnique({ where: { tokenHash: hashToken(token) }, select: SELECT_INVITE })
  if (!invite) return { ok: false, reason: 'NOT_FOUND' }

  const submittedIds = submission.guests.map((g) => g.id).filter((id): id is string => !!id)
  const idProblem = checkSubmittedIds(submittedIds, invite.guests)
  if (idProblem) return { ok: false, reason: idProblem }

  // The party after this submission is everyone already known plus every
  // companion being added. Checked against the allowance BEFORE anything is
  // written, so a stripped or replayed form can never mint phantom seats,
  // and nothing ever has to be deleted to make room. That is what used to put
  // a checked-in guest's record at risk.
  const companions = submission.guests.filter((g) => !g.id && g.attending)
  if (invite.guests.length + companions.length > invite.seatsAllotted) {
    return { ok: false, reason: 'SEAT_LIMIT' }
  }

  if (!(await hasOnlyActiveMeals(db, submission.guests))) return { ok: false, reason: 'INVALID_MEAL_OPTION' }

  const host = invite.guests.find((g) => g.isPrimary) ?? invite.guests[0]

  const status = await db.$transaction(async (tx) => {
    for (const entry of submission.guests) {
      if (entry.id) {
        await answerForKnownGuest(tx, entry as KnownResponse)
      } else if (entry.attending) {
        await tx.guest.create({
          data: { inviteId: invite.id, ...companionName(host, entry), attending: true, mealOptionId: entry.mealOptionId || null },
        })
      }
    }

    const guests = await tx.guest.findMany({ where: { inviteId: invite.id }, select: { attending: true } })
    const nextStatus = deriveInviteStatus(guests)
    const partySize = guests.filter((g) => g.attending).length

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
      meta: { attending: partySize > 0, partySize, extraSeatsRequested: submission.extraSeatsRequested },
    })

    return nextStatus
  })

  return { ok: true, inviteId: invite.id, status }
}
