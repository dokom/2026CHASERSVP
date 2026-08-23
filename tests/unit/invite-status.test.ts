import { describe, it, expect } from 'vitest'
import { deriveInviteStatus } from '@/lib/invites/status'

const yes = { attending: true }
const no = { attending: false }
const unset = { attending: null }

describe('deriveInviteStatus', () => {
  it('is PENDING when no guest has answered', () => {
    expect(deriveInviteStatus([unset, unset])).toBe('PENDING')
  })

  it('is PENDING for an invite with no guests', () => {
    expect(deriveInviteStatus([])).toBe('PENDING')
  })

  it('is ATTENDING when every guest is attending', () => {
    expect(deriveInviteStatus([yes, yes])).toBe('ATTENDING')
  })

  it('is DECLINED when every guest declined', () => {
    expect(deriveInviteStatus([no, no])).toBe('DECLINED')
  })

  it('is PARTIAL when guests disagree', () => {
    expect(deriveInviteStatus([yes, no])).toBe('PARTIAL')
  })

  it('is PARTIAL when some are attending and some have not answered', () => {
    expect(deriveInviteStatus([yes, unset])).toBe('PARTIAL')
  })

  it('is PARTIAL when some declined and some have not answered', () => {
    expect(deriveInviteStatus([no, unset])).toBe('PARTIAL')
  })

  it('handles a single attending guest', () => {
    expect(deriveInviteStatus([yes])).toBe('ATTENDING')
  })

  it('handles a single declining guest', () => {
    expect(deriveInviteStatus([no])).toBe('DECLINED')
  })
})
