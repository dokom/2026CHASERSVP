import { describe, it, expect } from 'vitest'
import { countdownParts } from '@/lib/guest/countdown'

const TARGET = new Date('2026-11-14T18:00:00Z')

describe('countdownParts', () => {
  it('splits the remaining time into days, hours, minutes and seconds', () => {
    const now = new Date('2026-11-12T15:30:15Z')
    expect(countdownParts(TARGET, now)).toEqual({
      days: 2, hours: 2, minutes: 29, seconds: 45, hasArrived: false,
    })
  })

  it('reports zero, and arrival, once the target has passed', () => {
    expect(countdownParts(TARGET, new Date('2026-11-14T18:00:00Z'))).toEqual({
      days: 0, hours: 0, minutes: 0, seconds: 0, hasArrived: true,
    })
    expect(countdownParts(TARGET, new Date('2026-12-01T00:00:00Z')).hasArrived).toBe(true)
  })

  it('floors partial seconds so the display never shows a fraction', () => {
    const now = new Date(TARGET.getTime() - 1500)
    expect(countdownParts(TARGET, now)).toMatchObject({ seconds: 1, hasArrived: false })
  })
})
