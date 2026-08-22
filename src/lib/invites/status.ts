export type InviteStatus = 'PENDING' | 'ATTENDING' | 'DECLINED' | 'PARTIAL'

export type GuestAttendance = { attending: boolean | null }

/**
 * Derives an invite's status from its guests.
 *
 * PENDING   — nobody has answered
 * ATTENDING — everybody is coming
 * DECLINED  — nobody is coming
 * PARTIAL   — anything else, including a partially answered invite
 */
export function deriveInviteStatus(guests: GuestAttendance[]): InviteStatus {
  if (guests.length === 0) return 'PENDING'

  let attending = 0
  let declined = 0
  let unanswered = 0

  for (const guest of guests) {
    if (guest.attending === true) attending++
    else if (guest.attending === false) declined++
    else unanswered++
  }

  if (unanswered === guests.length) return 'PENDING'
  if (attending === guests.length) return 'ATTENDING'
  if (declined === guests.length) return 'DECLINED'
  return 'PARTIAL'
}
