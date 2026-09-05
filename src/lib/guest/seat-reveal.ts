export type SeatVisibility =
  | { shown: true }
  | { shown: false; reason: 'NOT_RELEASED' | 'NOT_CONFIRMED' | 'NO_TABLE' }

/**
 * A guest sees their table only once BOTH gates open: the organiser has
 * released seating for everyone, and this party's primary guest has
 * confirmed they are coming. Until then the page shows a countdown instead.
 *
 * The order of the reasons matters for the copy the guest reads: an
 * unconfirmed guest is asked to RSVP first, because that is the gate they
 * control — whether seating is released is not something they can act on.
 */
export function seatVisibility(input: {
  seatsReleasedAt: Date | null
  primaryAttending: boolean | null | undefined
  table: string | null
}): SeatVisibility {
  if (input.primaryAttending !== true) return { shown: false, reason: 'NOT_CONFIRMED' }
  if (!input.seatsReleasedAt) return { shown: false, reason: 'NOT_RELEASED' }
  if (!input.table) return { shown: false, reason: 'NO_TABLE' }
  return { shown: true }
}
