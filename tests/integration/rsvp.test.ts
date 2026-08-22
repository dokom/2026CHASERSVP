import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { submitRsvp } from '@/lib/guest/rsvp'
import { createInvite } from '@/lib/invites/repository'

const OPEN = new Date('2026-09-01T00:00:00Z')
const DEADLINE = new Date('2026-10-24T23:59:00Z')
const CLOSED = new Date('2026-11-01T00:00:00Z')

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function seedInvite(seats = 2) {
  return createInvite(testDb, null, {
    label: 'Reyes Party',
    seatsAllotted: seats,
    primaryGuest: { firstName: 'Jordan', lastName: 'Reyes', email: 'jordan@example.com' },
  })
}

const entry = (over: Record<string, unknown> = {}) => ({
  firstName: 'Jordan', lastName: 'Reyes', dietary: [], ...over,
})

describe('submitRsvp', () => {
  it('records an acceptance and marks the invite ATTENDING', async () => {
    const { invite, token } = await seedInvite()
    const primary = await testDb.guest.findFirstOrThrow({ where: { inviteId: invite.id } })

    const result = await submitRsvp(testDb, token, {
      attending: true,
      guests: [entry({ id: primary.id, company: 'Northwind', title: 'VP' })],
      extraSeatsRequested: 0,
    }, OPEN, DEADLINE)

    expect(result).toMatchObject({ ok: true, status: 'ATTENDING' })
    const fresh = await testDb.guest.findUniqueOrThrow({ where: { id: primary.id } })
    expect(fresh).toMatchObject({ attending: true, company: 'Northwind', title: 'VP' })
  })

  it('records a decline and marks the invite DECLINED', async () => {
    const { invite, token } = await seedInvite()
    const result = await submitRsvp(testDb, token,
      { attending: false, guests: [], extraSeatsRequested: 0 }, OPEN, DEADLINE)
    expect(result).toMatchObject({ ok: true, status: 'DECLINED' })
    const guests = await testDb.guest.findMany({ where: { inviteId: invite.id } })
    expect(guests.every((g) => g.attending === false)).toBe(true)
  })

  it('stamps respondedAt', async () => {
    const { invite, token } = await seedInvite()
    await submitRsvp(testDb, token,
      { attending: false, guests: [], extraSeatsRequested: 0 }, OPEN, DEADLINE)
    const fresh = await testDb.invite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(fresh.respondedAt).not.toBeNull()
  })

  it('creates additional guests up to the seat allowance', async () => {
    const { invite, token } = await seedInvite(2)
    const primary = await testDb.guest.findFirstOrThrow({ where: { inviteId: invite.id } })
    await submitRsvp(testDb, token, {
      attending: true,
      guests: [entry({ id: primary.id }), entry({ firstName: 'Sam', lastName: 'Reyes' })],
      extraSeatsRequested: 0,
    }, OPEN, DEADLINE)
    expect(await testDb.guest.count({ where: { inviteId: invite.id } })).toBe(2)
  })

  it('refuses more guests than the seat allowance', async () => {
    const { token } = await seedInvite(1)
    const result = await submitRsvp(testDb, token, {
      attending: true,
      guests: [entry(), entry({ firstName: 'Sam' })],
      extraSeatsRequested: 0,
    }, OPEN, DEADLINE)
    expect(result).toEqual({ ok: false, reason: 'SEAT_LIMIT' })
  })

  it('REFUSES a guest id belonging to another invite', async () => {
    // Horizontal privilege escalation: without this check a guest could rewrite
    // any other party's details by pasting their guest id into the payload.
    const { token } = await seedInvite()
    const other = await createInvite(testDb, null, {
      label: 'Okafor Party', seatsAllotted: 1,
      primaryGuest: { firstName: 'Ada', lastName: 'Okafor' },
    })
    const victim = await testDb.guest.findFirstOrThrow({ where: { inviteId: other.invite.id } })

    const result = await submitRsvp(testDb, token, {
      attending: true,
      guests: [entry({ id: victim.id, firstName: 'Hijacked' })],
      extraSeatsRequested: 0,
    }, OPEN, DEADLINE)

    expect(result).toEqual({ ok: false, reason: 'FOREIGN_GUEST' })
    const untouched = await testDb.guest.findUniqueOrThrow({ where: { id: victim.id } })
    expect(untouched.firstName).toBe('Ada')
  })

  it('writes nothing at all when a foreign guest id is present', async () => {
    const { invite, token } = await seedInvite()
    const other = await createInvite(testDb, null, {
      label: 'Okafor Party', seatsAllotted: 1,
      primaryGuest: { firstName: 'Ada', lastName: 'Okafor' },
    })
    const victim = await testDb.guest.findFirstOrThrow({ where: { inviteId: other.invite.id } })
    const primary = await testDb.guest.findFirstOrThrow({ where: { inviteId: invite.id } })

    await submitRsvp(testDb, token, {
      attending: true,
      guests: [entry({ id: primary.id, company: 'Should not persist' }), entry({ id: victim.id })],
      extraSeatsRequested: 0,
    }, OPEN, DEADLINE)

    const fresh = await testDb.guest.findUniqueOrThrow({ where: { id: primary.id } })
    expect(fresh.company).toBeNull()
  })

  it('refuses once the deadline has passed', async () => {
    const { token } = await seedInvite()
    const result = await submitRsvp(testDb, token,
      { attending: false, guests: [], extraSeatsRequested: 0 }, CLOSED, DEADLINE)
    expect(result).toEqual({ ok: false, reason: 'CLOSED' })
  })

  it('refuses an unknown token', async () => {
    const result = await submitRsvp(testDb, 'nope',
      { attending: false, guests: [], extraSeatsRequested: 0 }, OPEN, DEADLINE)
    expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' })
  })

  it('records an extra-seat request as PENDING without creating seats', async () => {
    const { invite, token } = await seedInvite(1)
    await submitRsvp(testDb, token, {
      attending: true,
      guests: [entry()],
      extraSeatsRequested: 2,
      extraSeatsReason: 'Bringing my parents',
    }, OPEN, DEADLINE)

    const fresh = await testDb.invite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(fresh.extraSeatsStatus).toBe('PENDING')
    expect(fresh.extraSeatsRequested).toBe(2)
    expect(fresh.seatsAllotted).toBe(1)
  })

  it('is idempotent — resubmitting replaces rather than duplicates', async () => {
    const { invite, token } = await seedInvite(2)
    const payload = {
      attending: true,
      guests: [entry(), entry({ firstName: 'Sam' })],
      extraSeatsRequested: 0,
    }
    await submitRsvp(testDb, token, payload, OPEN, DEADLINE)
    await submitRsvp(testDb, token, payload, OPEN, DEADLINE)
    expect(await testDb.guest.count({ where: { inviteId: invite.id } })).toBe(2)
  })

  it('audits the submission without recording the token', async () => {
    const { token } = await seedInvite()
    await submitRsvp(testDb, token,
      { attending: false, guests: [], extraSeatsRequested: 0 }, OPEN, DEADLINE)
    const log = await testDb.auditLog.findFirst({ where: { action: 'rsvp.submit' } })
    expect(log).not.toBeNull()
    expect(log?.actorId).toBeNull()
    expect(JSON.stringify(log)).not.toContain(token)
  })
})
