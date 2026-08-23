import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { resolvePartyByToken, checkInGuest, undoCheckIn, checkInProgress } from '@/lib/checkin/repository'
import { createInvite } from '@/lib/invites/repository'

const AT = new Date('2026-11-14T18:12:00Z')

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function seed() {
  const staff = await testDb.adminUser.create({
    data: { email: 'door@example.com', name: 'Door', passwordHash: 'x', role: 'STAFF' },
  })
  const { invite, token } = await createInvite(testDb, null, {
    label: 'Reyes Party', seatsAllotted: 2, tableNumber: '12',
    primaryGuest: { firstName: 'Jordan', lastName: 'Reyes' },
  })
  const sam = await testDb.guest.create({
    data: { inviteId: invite.id, firstName: 'Sam', lastName: 'Reyes', attending: true },
  })
  await testDb.guest.updateMany({ where: { inviteId: invite.id, isPrimary: true }, data: { attending: true } })
  return { staff, invite, token, sam }
}

describe('resolvePartyByToken', () => {
  it('returns the party with check-in state', async () => {
    const { token } = await seed()
    const party = await resolvePartyByToken(testDb, token)
    expect(party?.label).toBe('Reyes Party')
    expect(party?.tableNumber).toBe('12')
    expect(party?.guests).toHaveLength(2)
    expect(party?.guests.every((g) => g.checkedInAt === null)).toBe(true)
  })

  it('returns null for an unknown or empty token', async () => {
    expect(await resolvePartyByToken(testDb, 'nope')).toBeNull()
    expect(await resolvePartyByToken(testDb, '')).toBeNull()
  })

  it('never exposes the token hash', async () => {
    const { token } = await seed()
    expect(JSON.stringify(await resolvePartyByToken(testDb, token))).not.toContain('tokenHash')
  })
})

describe('checkInGuest', () => {
  it('checks a guest in and audits it with the staff actor', async () => {
    const { staff, sam } = await seed()
    const result = await checkInGuest(testDb, staff.id, sam.id, AT)
    expect(result).toMatchObject({ ok: true, alreadyCheckedIn: false, wasDeclined: false })
    const fresh = await testDb.guest.findUniqueOrThrow({ where: { id: sam.id } })
    expect(fresh.checkedInAt).toEqual(AT)
    expect(fresh.checkedInById).toBe(staff.id)
    const log = await testDb.auditLog.findFirst({ where: { action: 'guest.checkIn' } })
    expect(log?.actorId).toBe(staff.id)
  })

  it('is IDEMPOTENT: a second check-in reports the original time and writes nothing', async () => {
    const { staff, sam } = await seed()
    await checkInGuest(testDb, staff.id, sam.id, AT)
    const later = new Date('2026-11-14T19:00:00Z')
    const second = await checkInGuest(testDb, staff.id, sam.id, later)
    expect(second).toMatchObject({ ok: true, alreadyCheckedIn: true })
    if (second.ok) expect(second.checkedInAt).toEqual(AT)
    expect(await testDb.auditLog.count({ where: { action: 'guest.checkIn' } })).toBe(1)
  })

  it('checks in a guest who had declined, and says so', async () => {
    const { staff, sam } = await seed()
    await testDb.guest.update({ where: { id: sam.id }, data: { attending: false } })
    const result = await checkInGuest(testDb, staff.id, sam.id, AT)
    expect(result).toMatchObject({ ok: true, wasDeclined: true })
    const log = await testDb.auditLog.findFirst({ where: { action: 'guest.checkIn' } })
    expect((log?.meta as Record<string, unknown>).wasDeclined).toBe(true)
  })

  it('returns NOT_FOUND for an unknown id', async () => {
    const { staff } = await seed()
    expect(await checkInGuest(testDb, staff.id, '0'.repeat(24), AT)).toEqual({ ok: false, reason: 'NOT_FOUND' })
  })

  it('returns NOT_FOUND rather than throwing for a malformed id', async () => {
    const { staff } = await seed()
    await expect(checkInGuest(testDb, staff.id, 'not-an-objectid', AT))
      .resolves.toEqual({ ok: false, reason: 'NOT_FOUND' })
  })
})

describe('undoCheckIn', () => {
  it('clears the check-in and audits it', async () => {
    const { staff, sam } = await seed()
    await checkInGuest(testDb, staff.id, sam.id, AT)
    expect(await undoCheckIn(testDb, staff.id, sam.id)).toEqual({ ok: true })
    const fresh = await testDb.guest.findUniqueOrThrow({ where: { id: sam.id } })
    expect(fresh.checkedInAt).toBeNull()
    expect(fresh.checkedInById).toBeNull()
    expect(await testDb.auditLog.count({ where: { action: 'guest.undoCheckIn' } })).toBe(1)
  })

  it('is a no-op on a guest who was never checked in', async () => {
    const { staff, sam } = await seed()
    expect(await undoCheckIn(testDb, staff.id, sam.id)).toEqual({ ok: true })
    expect(await testDb.auditLog.count({ where: { action: 'guest.undoCheckIn' } })).toBe(0)
  })
})

describe('checkInProgress', () => {
  it('counts attending guests and how many have arrived', async () => {
    const { staff, sam } = await seed()
    await checkInGuest(testDb, staff.id, sam.id, AT)
    expect(await checkInProgress(testDb)).toEqual({ attending: 2, checkedIn: 1 })
  })
})
