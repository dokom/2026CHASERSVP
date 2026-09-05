import type { PrismaClient, Prisma } from '@prisma/client'
import { hashToken } from '@/lib/crypto/tokens'
import { writeAudit } from '@/lib/audit'

const MAX_TRANSACTION_ATTEMPTS = 5

/** Prisma's code for a MongoDB replica-set transaction that lost a write race. */
function isTransientTransactionConflict(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === 'P2034'
}

/**
 * MongoDB's transaction engine does not queue conflicting writers — two
 * interactive transactions touching the same document concurrently (an
 * offline-queue replay racing a live tap on the same guest) means the
 * loser THROWS rather than blocking. Since the loser's write is a no-op
 * once retried (the winner already flipped the guarded field, so its own
 * `updateMany` matches zero rows and it falls through to the
 * already-checked-in branch), a bounded retry makes the operation behave
 * as atomic from the caller's perspective without weakening the guard.
 */
async function runTransaction<T>(
  db: PrismaClient, fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(fn)
    } catch (error) {
      if (!isTransientTransactionConflict(error) || attempt === MAX_TRANSACTION_ATTEMPTS) throw error
    }
  }
  /* istanbul ignore next -- loop always returns or throws */
  throw new Error('unreachable')
}

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
  guests: PartyGuest[]
}

export type CheckInResult =
  | { ok: true; checkedInAt: Date; alreadyCheckedIn: boolean; wasDeclined: boolean }
  | { ok: false; reason: 'NOT_FOUND' }

/**
 * MongoDB ids are ObjectIds: `findUnique`/`findFirst` on a malformed id
 * THROWS rather than returning null. Guest ids arrive from the scanner's
 * POST body, so an unparseable one means "not found", not a 500.
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
  // Spec §8: a guest's own table overrides the invite's, so the door sends
  // each person of a split party to the right table.
  const guests = invite.guests.map((guest) => ({ ...guest, tableNumber: guest.tableNumber ?? invite.tableNumber }))
  return { inviteId: invite.id, label: invite.label, guests }
}

type ScopedGuest = { id: string; attending: boolean | null; checkedInAt: Date | null }

/**
 * Binds a guest id to the invite token presented at the door BEFORE any
 * write. A session only proves "this is an authenticated staff member" —
 * it says nothing about which party is standing in front of them. Guest
 * ids are sequential-ish ObjectIds (timestamp + counter), so without this
 * check any staff session could enumerate ids and check in, undo, or read
 * check-in state for a guest belonging to an entirely different party.
 * The invite token is what the guest is physically holding (scanned off
 * their invitation), so it is the only credential that actually scopes
 * the write to the right party. A mismatch or unknown token/guest looks
 * identical to the caller — NOT_FOUND — so the endpoint never confirms
 * that a given guest id exists.
 */
async function resolveScopedGuest(db: PrismaClient, token: string, guestId: string): Promise<ScopedGuest | null> {
  if (!token) return null
  const invite = await db.invite.findUnique({ where: { tokenHash: hashToken(token) }, select: { id: true } })
  if (!invite) return null
  const guest = await db.guest
    .findFirst({
      where: { id: guestId, inviteId: invite.id },
      select: { id: true, attending: true, checkedInAt: true },
    })
    .catch((error: unknown) => { if (isMalformedIdError(error)) return null; throw error })
  return guest
}

/**
 * Idempotent by design: the offline queue replays, and a staff member will
 * double-tap. A second check-in reports the ORIGINAL time and writes
 * nothing. A guest who declined and turned up anyway is checked in —
 * reality at the door beats the RSVP — and the result says so.
 *
 * The write itself is atomic: `updateMany` only touches a row that is
 * still not checked in, so two overlapping replays can never both see
 * "not yet checked in" and both write an audit row — only the one that
 * actually flips the row audits. `checkedInAt` is never written on guest
 * creation, so most guests have the field entirely UNSET rather than
 * explicitly `null`; MongoDB's `{ checkedInAt: null }` filter does not
 * match an unset field, so both cases are matched explicitly.
 */
export async function checkInGuest(
  db: PrismaClient, actorId: string, token: string, guestId: string, at: Date,
): Promise<CheckInResult> {
  const scoped = await resolveScopedGuest(db, token, guestId)
  if (!scoped) return { ok: false, reason: 'NOT_FOUND' }
  const wasDeclined = scoped.attending === false

  const won = await runTransaction(db, async (tx) => {
    const result = await tx.guest.updateMany({
      where: { id: guestId, OR: [{ checkedInAt: null }, { checkedInAt: { isSet: false } }] },
      data: { checkedInAt: at, checkedInById: actorId },
    })
    if (result.count === 1) {
      await writeAudit(tx, {
        actorId, action: 'guest.checkIn', entity: 'Guest', entityId: guestId,
        meta: { at: at.toISOString(), wasDeclined },
      })
    }
    return result.count === 1
  })

  if (won) return { ok: true, checkedInAt: at, alreadyCheckedIn: false, wasDeclined }

  // Lost the race (or a queued replay): report the time that actually won.
  const current = await db.guest.findUnique({ where: { id: guestId }, select: { checkedInAt: true } })
  return { ok: true, checkedInAt: current?.checkedInAt ?? at, alreadyCheckedIn: true, wasDeclined }
}

export async function undoCheckIn(
  db: PrismaClient, actorId: string, token: string, guestId: string,
): Promise<{ ok: boolean }> {
  const scoped = await resolveScopedGuest(db, token, guestId)
  if (!scoped) return { ok: false }

  await runTransaction(db, async (tx) => {
    const result = await tx.guest.updateMany({
      where: { id: guestId, checkedInAt: { not: null } },
      data: { checkedInAt: null, checkedInById: null },
    })
    if (result.count === 1) {
      await writeAudit(tx, { actorId, action: 'guest.undoCheckIn', entity: 'Guest', entityId: guestId })
    }
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
