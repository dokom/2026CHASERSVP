import { describe, it, expect } from 'vitest'
import { seatVisibility, partySeatVisibility } from '@/lib/guest/seat-reveal'

const RELEASED = new Date('2026-11-01T00:00:00Z')

describe('seatVisibility (one guest)', () => {
  it('shows the seat once seating is released and the guest is coming', () => {
    expect(seatVisibility({ seatsReleasedAt: RELEASED, attending: true, table: '12' })).toEqual({ shown: true })
  })

  it('hides the seat until the organiser releases seating', () => {
    expect(seatVisibility({ seatsReleasedAt: null, attending: true, table: '12' }))
      .toEqual({ shown: false, reason: 'NOT_RELEASED' })
  })

  it('hides the seat until the guest confirms, even after release', () => {
    expect(seatVisibility({ seatsReleasedAt: RELEASED, attending: null, table: '12' }))
      .toEqual({ shown: false, reason: 'NOT_CONFIRMED' })
    expect(seatVisibility({ seatsReleasedAt: RELEASED, attending: false, table: '12' }))
      .toEqual({ shown: false, reason: 'NOT_CONFIRMED' })
  })

  it('asks the guest to confirm before mentioning that seating is unreleased', () => {
    expect(seatVisibility({ seatsReleasedAt: null, attending: null, table: '12' }))
      .toEqual({ shown: false, reason: 'NOT_CONFIRMED' })
  })

  it('has nothing to show for a guest without a table', () => {
    expect(seatVisibility({ seatsReleasedAt: RELEASED, attending: true, table: null }))
      .toEqual({ shown: false, reason: 'NO_TABLE' })
  })
})

describe('partySeatVisibility', () => {
  it('is shown when at least one guest has a showable seat', () => {
    expect(partySeatVisibility({
      seatsReleasedAt: RELEASED, primaryAttending: false,
      guests: [{ attending: false, table: '1' }, { attending: true, table: '7' }],
    })).toEqual({ shown: true })
  })

  it("falls back to the primary guest's reason when nobody is showable", () => {
    expect(partySeatVisibility({
      seatsReleasedAt: RELEASED, primaryAttending: null,
      guests: [{ attending: null, table: '1' }, { attending: true, table: null }],
    })).toEqual({ shown: false, reason: 'NOT_CONFIRMED' })
    expect(partySeatVisibility({
      seatsReleasedAt: null, primaryAttending: true,
      guests: [{ attending: true, table: '1' }],
    })).toEqual({ shown: false, reason: 'NOT_RELEASED' })
  })

  it('reports NO_TABLE for a confirmed, released party with no tables at all', () => {
    expect(partySeatVisibility({
      seatsReleasedAt: RELEASED, primaryAttending: true,
      guests: [{ attending: true, table: null }],
    })).toEqual({ shown: false, reason: 'NO_TABLE' })
  })

  it('treats an empty party (unassigned placeholder) as unconfirmed', () => {
    expect(partySeatVisibility({ seatsReleasedAt: RELEASED, primaryAttending: undefined, guests: [] }))
      .toEqual({ shown: false, reason: 'NOT_CONFIRMED' })
  })
})
