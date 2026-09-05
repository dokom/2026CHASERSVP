import { describe, it, expect } from 'vitest'
import { formatInviteNumber, nextNumbers, numberWidth, placeholderLabel } from '@/lib/invites/numbering'

describe('numberWidth', () => {
  it('never goes below three digits', () => {
    expect(numberWidth(1)).toBe(3)
    expect(numberWidth(999)).toBe(3)
  })

  it('grows with the highest number in the run', () => {
    expect(numberWidth(1000)).toBe(4)
    expect(numberWidth(12345)).toBe(5)
  })
})

describe('formatInviteNumber', () => {
  it('zero-pads to three digits by default', () => {
    expect(formatInviteNumber(7)).toBe('007')
    expect(formatInviteNumber(42)).toBe('042')
    expect(formatInviteNumber(300)).toBe('300')
  })

  it('pads to the width of the highest number in the batch', () => {
    expect(formatInviteNumber(7, 1200)).toBe('0007')
  })

  it('is what a fresh placeholder is labelled', () => {
    expect(placeholderLabel(3, 250)).toBe('003')
  })
})

describe('nextNumbers', () => {
  it('starts at 1 when nothing is numbered yet', () => {
    expect(nextNumbers(null, 3)).toEqual([1, 2, 3])
  })

  it('continues after the highest number in use', () => {
    expect(nextNumbers(120, 2)).toEqual([121, 122])
  })

  it('returns nothing for a zero count', () => {
    expect(nextNumbers(5, 0)).toEqual([])
  })
})
