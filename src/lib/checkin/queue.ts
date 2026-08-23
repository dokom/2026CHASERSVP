export type QueuedCheckIn = { guestId: string; at: string; attempts: number }

export const MAX_ATTEMPTS = 5

/** A double-tap is one arrival: the first time wins and the duplicate is dropped. */
export function enqueue(queue: QueuedCheckIn[], guestId: string, at: string): QueuedCheckIn[] {
  if (queue.some((item) => item.guestId === guestId)) return queue
  return [...queue, { guestId, at, attempts: 0 }]
}

export function markSynced(queue: QueuedCheckIn[], guestId: string): QueuedCheckIn[] {
  return queue.filter((item) => item.guestId !== guestId)
}

export function markFailed(queue: QueuedCheckIn[], guestId: string): QueuedCheckIn[] {
  return queue.map((item) => (item.guestId === guestId ? { ...item, attempts: item.attempts + 1 } : item))
}

/** Oldest first; items past the cap stay in the queue for inspection but are not retried. */
export function nextBatch(queue: QueuedCheckIn[], max: number): QueuedCheckIn[] {
  return queue.filter((item) => item.attempts < MAX_ATTEMPTS).slice(0, max)
}
