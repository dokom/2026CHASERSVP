export type SeatVisibility =
  | { shown: true }
  | { shown: false; reason: 'NOT_RELEASED' | 'NOT_CONFIRMED' | 'NO_TABLE' }

/**
 * One guest sees their table only once BOTH gates open: the organiser has
 * released seating for everyone, and this guest has confirmed they are
 * coming. Until then the page shows a countdown instead.
 *
 * The order of the reasons matters for the copy the guest reads: an
 * unconfirmed guest is asked to RSVP first, because that is the gate they
 * control. Whether seating is released is not something they can act on.
 */
export function seatVisibility(input: {
  seatsReleasedAt: Date | null
  attending: boolean | null | undefined
  table: string | null
}): SeatVisibility {
  if (input.attending !== true) return { shown: false, reason: 'NOT_CONFIRMED' }
  if (!input.seatsReleasedAt) return { shown: false, reason: 'NOT_RELEASED' }
  if (!input.table) return { shown: false, reason: 'NO_TABLE' }
  return { shown: true }
}

/**
 * The party as a whole: shown as soon as any one guest's seat is showable.
 * When none is, the reason comes from the primary guest, so the pending
 * copy speaks to the person holding the phone.
 */
export function partySeatVisibility(input: {
  seatsReleasedAt: Date | null
  primaryAttending: boolean | null | undefined
  guests: { attending: boolean | null; table: string | null }[]
}): SeatVisibility {
  const anyShown = input.guests.some(
    (guest) => seatVisibility({ seatsReleasedAt: input.seatsReleasedAt, ...guest }).shown,
  )
  if (anyShown) return { shown: true }
  const primaryTable = input.guests.find((guest) => guest.table)?.table ?? null
  return seatVisibility({
    seatsReleasedAt: input.seatsReleasedAt,
    attending: input.primaryAttending,
    table: primaryTable,
  })
}
