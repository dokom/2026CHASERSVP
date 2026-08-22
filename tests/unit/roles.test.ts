import { describe, it, expect } from 'vitest'
import { hasRole, landingPathFor, ROLE_RANK } from '@/lib/auth/roles'

describe('hasRole', () => {
  it('grants OWNER every level', () => {
    expect(hasRole('OWNER', 'OWNER')).toBe(true)
    expect(hasRole('OWNER', 'ADMIN')).toBe(true)
    expect(hasRole('OWNER', 'STAFF')).toBe(true)
  })

  it('denies ADMIN owner-level access', () => {
    expect(hasRole('ADMIN', 'OWNER')).toBe(false)
    expect(hasRole('ADMIN', 'ADMIN')).toBe(true)
    expect(hasRole('ADMIN', 'STAFF')).toBe(true)
  })

  it('grants STAFF staff-level only', () => {
    expect(hasRole('STAFF', 'STAFF')).toBe(true)
    expect(hasRole('STAFF', 'ADMIN')).toBe(false)
    expect(hasRole('STAFF', 'OWNER')).toBe(false)
  })

  it('ranks OWNER above ADMIN above STAFF', () => {
    expect(ROLE_RANK.OWNER).toBeGreaterThan(ROLE_RANK.ADMIN)
    expect(ROLE_RANK.ADMIN).toBeGreaterThan(ROLE_RANK.STAFF)
  })
})

describe('landingPathFor', () => {
  it('sends STAFF straight to the check-in scanner', () => {
    expect(landingPathFor('STAFF')).toBe('/admin/checkin')
  })

  it('sends ADMIN and OWNER to the dashboard', () => {
    expect(landingPathFor('ADMIN')).toBe('/admin')
    expect(landingPathFor('OWNER')).toBe('/admin')
  })
})
