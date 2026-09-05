import type { PrismaClient } from '@prisma/client'
import { resolveInviteByToken, type GuestInvite, type GuestRow } from './resolve'
import { getEvent, type EventDetail, type TableMarkerRow } from '@/lib/events/repository'
import { rsvpWindow, type RsvpWindow } from './deadline'
import { seatVisibility, partySeatVisibility, type SeatVisibility } from './seat-reveal'

/** One attending guest's table, present only while they are allowed to see it. */
export type Seat = {
  guestId: string
  name: string
  isPrimary: boolean
  table: string
  marker: TableMarkerRow | null
}

export type GuestPageData = {
  invite: GuestInvite
  event: EventDetail
  window: RsvpWindow
  /**
   * The party's showable seats, in party order (primary first). Empty
   * unless `seat.shown`, so the page cannot render a table it was supposed
   * to withhold.
   */
  seats: Seat[]
  seat: SeatVisibility
}

/** Spec §8: a guest's own table overrides the invite's, so a split party sends each person to the right one. */
function resolvedTable(guest: GuestRow, invite: GuestInvite): string | null {
  return guest.tableNumber ?? invite.tableNumber ?? null
}

function toSeat(guest: GuestRow, table: string, markers: TableMarkerRow[]): Seat {
  return {
    guestId: guest.id,
    name: `${guest.firstName} ${guest.lastName}`.trim(),
    isPrimary: guest.isPrimary,
    table,
    marker: markers.find((candidate) => candidate.tableNumber === table) ?? null,
  }
}

/**
 * Everything the guest page renders, in one call.
 *
 * Returns null both for an unknown token and for an unconfigured event: the
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

  const primary = invite.guests.find((guest) => guest.isPrimary) ?? invite.guests[0]
  const perGuest = invite.guests.map((guest) => ({ guest, table: resolvedTable(guest, invite) }))

  const seat = partySeatVisibility({
    seatsReleasedAt: event.seatsReleasedAt,
    primaryAttending: primary?.attending,
    guests: perGuest.map(({ guest, table }) => ({ attending: guest.attending, table })),
  })

  const seats = seat.shown
    ? perGuest
        .filter(({ guest, table }) =>
          seatVisibility({ seatsReleasedAt: event.seatsReleasedAt, attending: guest.attending, table }).shown)
        .map(({ guest, table }) => toSeat(guest, table!, event.tableMarkers))
    : []

  return {
    invite,
    event: { ...event, mealOptions: event.mealOptions.filter((meal) => meal.isActive) },
    window: rsvpWindow(event.rsvpDeadline, now),
    seats,
    seat,
  }
}
