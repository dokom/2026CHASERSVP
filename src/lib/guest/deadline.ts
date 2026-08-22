export class RsvpClosedError extends Error {
  readonly closedAt: Date

  constructor(closedAt: Date) {
    super(`RSVPs closed on ${closedAt.toISOString()}`)
    this.name = 'RsvpClosedError'
    this.closedAt = closedAt
  }
}

export type RsvpWindow = {
  isOpen: boolean
  hasClosed: boolean
  closesAt: Date
}

/**
 * The deadline is the instant the window shuts, not the last instant it is
 * open — `now === deadline` is closed. Both callers (the page, which renders
 * read-only, and the action, which refuses the write) must agree on that, so
 * the comparison lives here rather than in either of them.
 */
export function rsvpWindow(deadline: Date, now: Date): RsvpWindow {
  const hasClosed = now.getTime() >= deadline.getTime()
  return { isOpen: !hasClosed, hasClosed, closesAt: deadline }
}

export function assertRsvpOpen(deadline: Date, now: Date): void {
  if (rsvpWindow(deadline, now).hasClosed) throw new RsvpClosedError(deadline)
}
