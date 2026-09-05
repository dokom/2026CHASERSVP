import type { PrismaClient } from '@prisma/client'
import { resolveInviteByToken, type GuestInvite } from './resolve'
import { getEvent, type EventDetail, type TableMarkerRow } from '@/lib/events/repository'
import { rsvpWindow, type RsvpWindow } from './deadline'
import { seatVisibility, type SeatVisibility } from './seat-reveal'

export type GuestPageData = {
  invite: GuestInvite
  event: EventDetail
  window: RsvpWindow
  /**
   * The party's table and its floorplan marker, present only while the
   * guest is allowed to see them — see `seat`. Kept null otherwise so the
   * page cannot render a table number it was supposed to withhold.
   */
  table: string | null
  marker: TableMarkerRow | null
  seat: SeatVisibility
}

/**
 * Everything the guest page renders, in one call.
 *
 * Returns null both for an unknown token and for an unconfigured event — the
 * page renders the same "we could not find your invitation" state either way,
 * because distinguishing them for the visitor would leak whether a token is
 * merely wrong or genuinely valid.
 */
export async function loadGuestPage(
  db: PrismaClient,
  token: string,
  now: Date,
): Promise<GuestPageData | null> {
  const [invite, event] = await Promise.all([resolveInviteByToken(db, token), getEvent(db)])
  if (!invite || !event) return null

  // Spec §8: a guest's own table overrides the invite's, so a party split
  // across tables still sends each person to the right one.
  const primary = invite.guests.find((guest) => guest.isPrimary) ?? invite.guests[0]
  const assignedTable = primary?.tableNumber ?? invite.tableNumber ?? null

  const seat = seatVisibility({
    seatsReleasedAt: event.seatsReleasedAt,
    primaryAttending: primary?.attending,
    table: assignedTable,
  })
  const table = seat.shown ? assignedTable : null
  const marker = table
    ? (event.tableMarkers.find((candidate) => candidate.tableNumber === table) ?? null)
    : null

  return {
    invite,
    event: { ...event, mealOptions: event.mealOptions.filter((meal) => meal.isActive) },
    window: rsvpWindow(event.rsvpDeadline, now),
    table,
    marker,
    seat,
  }
}
