import { describe, it, expect } from 'vitest'
import { enqueue, markSynced, markFailed, nextBatch, MAX_ATTEMPTS } from '@/lib/checkin/queue'

const T1 = '2026-11-14T18:00:00.000Z'
const T2 = '2026-11-14T18:05:00.000Z'

describe('offline check-in queue', () => {
  it('enqueues a check-in', () => {
    expect(enqueue([], 'g1', T1)).toEqual([{ guestId: 'g1', at: T1, attempts: 0 }])
  })

  it('dedupes by guest and keeps the FIRST time — a double-tap is one arrival', () => {
    const q = enqueue(enqueue([], 'g1', T1), 'g1', T2)
    expect(q).toHaveLength(1)
    expect(q[0]?.at).toBe(T1)
  })

  it('never mutates its input', () => {
    const before = enqueue([], 'g1', T1)
    const snapshot = JSON.stringify(before)
    enqueue(before, 'g2', T2)
    markFailed(before, 'g1')
    markSynced(before, 'g1')
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('removes a synced item', () => {
    const q = enqueue(enqueue([], 'g1', T1), 'g2', T2)
    expect(markSynced(q, 'g1').map((i) => i.guestId)).toEqual(['g2'])
  })

  it('counts failures', () => {
    const q = markFailed(markFailed(enqueue([], 'g1', T1), 'g1'), 'g1')
    expect(q[0]?.attempts).toBe(2)
  })

  it('flushes oldest first, up to the batch size', () => {
    const q = enqueue(enqueue(enqueue([], 'g1', T1), 'g2', T2), 'g3', T2)
    expect(nextBatch(q, 2).map((i) => i.guestId)).toEqual(['g1', 'g2'])
  })

  it('gives up on an item past the attempt cap, but keeps it for inspection', () => {
    let q = enqueue([], 'g1', T1)
    for (let i = 0; i < MAX_ATTEMPTS; i++) q = markFailed(q, 'g1')
    expect(nextBatch(q, 10)).toEqual([])
    expect(q).toHaveLength(1)
  })
})
