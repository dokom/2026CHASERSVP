import { describe, it, expect } from 'vitest'
import { rsvpWindow, assertRsvpOpen, RsvpClosedError } from '@/lib/guest/deadline'

const deadline = new Date('2026-10-24T23:59:00Z')

describe('rsvpWindow', () => {
  it('is open well before the deadline', () => {
    expect(rsvpWindow(deadline, new Date('2026-09-01T00:00:00Z')).isOpen).toBe(true)
  })

  it('is open one second before the deadline', () => {
    expect(rsvpWindow(deadline, new Date('2026-10-24T23:58:59Z')).isOpen).toBe(true)
  })

  it('is CLOSED exactly at the deadline', () => {
    // The deadline is the moment it shuts, not the last moment it is open.
    const window = rsvpWindow(deadline, deadline)
    expect(window.isOpen).toBe(false)
    expect(window.hasClosed).toBe(true)
  })

  it('is closed after the deadline', () => {
    expect(rsvpWindow(deadline, new Date('2026-10-25T00:00:00Z')).isOpen).toBe(false)
  })

  it('reports when it closes', () => {
    expect(rsvpWindow(deadline, new Date('2026-09-01T00:00:00Z')).closesAt).toEqual(deadline)
  })
})

describe('assertRsvpOpen', () => {
  it('passes while open', () => {
    expect(() => assertRsvpOpen(deadline, new Date('2026-09-01T00:00:00Z'))).not.toThrow()
  })

  it('throws RsvpClosedError once closed', () => {
    expect(() => assertRsvpOpen(deadline, new Date('2026-10-25T00:00:00Z')))
      .toThrow(RsvpClosedError)
  })

  it('throws exactly at the deadline', () => {
    expect(() => assertRsvpOpen(deadline, deadline)).toThrow(RsvpClosedError)
  })

  it('names the deadline in its message so a guest can be told when it shut', () => {
    try {
      assertRsvpOpen(deadline, new Date('2026-10-25T00:00:00Z'))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as Error).message).toContain('2026')
    }
  })
})
