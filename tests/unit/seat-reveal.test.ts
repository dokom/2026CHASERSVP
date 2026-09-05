import { describe, it, expect } from 'vitest'
import { seatVisibility } from '@/lib/guest/seat-reveal'

const RELEASED = new Date('2026-11-01T00:00:00Z')

describe('seatVisibility', () => {
  it('shows the seat once seating is released and the primary guest is coming', () => {
    expect(seatVisibility({ seatsReleasedAt: RELEASED, primaryAttending: true, table: '12' }))
      .toEqual({ shown: true })
  })

  it('hides the seat until the organiser releases seating', () => {
    expect(seatVisibility({ seatsReleasedAt: null, primaryAttending: true, table: '12' }))
      .toEqual({ shown: false, reason: 'NOT_RELEASED' })
  })

  it('hides the seat until the guest confirms, even after release', () => {
    expect(seatVisibility({ seatsReleasedAt: RELEASED, primaryAttending: null, table: '12' }))
      .toEqual({ shown: false, reason: 'NOT_CONFIRMED' })
    expect(seatVisibility({ seatsReleasedAt: RELEASED, primaryAttending: false, table: '12' }))
      .toEqual({ shown: false, reason: 'NOT_CONFIRMED' })
  })

  it('asks the guest to confirm before mentioning that seating is unreleased', () => {
    expect(seatVisibility({ seatsReleasedAt: null, primaryAttending: null, table: '12' }))
      .toEqual({ shown: false, reason: 'NOT_CONFIRMED' })
  })

  it('has nothing to show for a party without a table', () => {
    expect(seatVisibility({ seatsReleasedAt: RELEASED, primaryAttending: true, table: null }))
      .toEqual({ shown: false, reason: 'NO_TABLE' })
  })
})
