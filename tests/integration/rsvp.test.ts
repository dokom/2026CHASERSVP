import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { submitRsvp } from '@/lib/guest/rsvp'
import { createInvite } from '@/lib/invites/repository'
import { hashToken } from '@/lib/crypto/tokens'

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

/** Seeds the singleton Event plus one active and one retired meal option. */
async function seedMealOptions() {
  const event = await testDb.event.create({
    data: {
      name: 'Test Gala',
      startsAt: new Date('2026-10-01T00:00:00Z'),
      venueName: 'Grand Hall',
      address: '1 Main St',
      rsvpDeadline: DEADLINE,
    },
  })
  const active = await testDb.mealOption.create({
    data: { eventId: event.id, label: 'Chicken', isActive: true },
  })
  const retired = await testDb.mealOption.create({
    data: { eventId: event.id, label: 'Discontinued Fish', isActive: false },
  })
  return { active, retired }
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

  // --- C2: resubmission must not destroy seat/check-in state -------------

  it('REFUSES to delete a checked-in guest, and reassigns isPrimary, when a ' +
    'resubmission strips hidden id inputs', async () => {
    const { invite, token } = await seedInvite(2)
    const primary = await testDb.guest.findFirstOrThrow({ where: { inviteId: invite.id } })

    // First submission, with real ids, seats the party normally.
    await submitRsvp(testDb, token, {
      attending: true,
      guests: [entry({ id: primary.id }), entry({ firstName: 'Sam', lastName: 'Reyes' })],
      extraSeatsRequested: 0,
    }, OPEN, DEADLINE)

    const [g1, g2] = await testDb.guest.findMany({
      where: { inviteId: invite.id }, orderBy: { createdAt: 'asc' },
    })
    // g1 is the seeded primary. Seat and check in g2 the way door staff would.
    const checkinTime = new Date('2026-09-15T18:00:00Z')
    await testDb.guest.update({
      where: { id: g2!.id }, data: { tableNumber: '7', checkedInAt: checkinTime },
    })

    // Resubmission with every hidden id input stripped — indistinguishable,
    // from this function's point of view, from a form that never sent them.
    const result = await submitRsvp(testDb, token, {
      attending: true,
      guests: [entry({ firstName: g1!.firstName }), entry({ firstName: 'Sam', lastName: 'Reyes' })],
      extraSeatsRequested: 0,
    }, OPEN, DEADLINE)

    expect(result).toMatchObject({ ok: true })

    const stillCheckedIn = await testDb.guest.findUnique({ where: { id: g2!.id } })
    expect(stillCheckedIn).not.toBeNull()
    expect(stillCheckedIn?.checkedInAt?.toISOString()).toBe(checkinTime.toISOString())
    expect(stillCheckedIn?.tableNumber).toBe('7')

    // g1 (not checked in) was legitimately replaced by the resubmission, but
    // the party must still have exactly one primary guest afterward.
    const finalGuests = await testDb.guest.findMany({ where: { inviteId: invite.id } })
    expect(finalGuests.filter((g) => g.isPrimary)).toHaveLength(1)
  })

  it('preserves isPrimary and tableNumber across a resubmission that reuses the same id', async () => {
    const { invite, token } = await seedInvite(1)
    const primary = await testDb.guest.findFirstOrThrow({ where: { inviteId: invite.id } })
    await testDb.guest.update({ where: { id: primary.id }, data: { tableNumber: '3' } })

    const payload = {
      attending: true,
      guests: [entry({ id: primary.id, company: 'Northwind' })],
      extraSeatsRequested: 0,
    }
    await submitRsvp(testDb, token, payload, OPEN, DEADLINE)
    await submitRsvp(testDb, token, payload, OPEN, DEADLINE)

    const fresh = await testDb.guest.findUniqueOrThrow({ where: { id: primary.id } })
    expect(fresh.isPrimary).toBe(true)
    expect(fresh.tableNumber).toBe('3')
    expect(fresh.company).toBe('Northwind')
    expect(await testDb.guest.count({ where: { inviteId: invite.id } })).toBe(1)
  })

  // --- I1: mealOptionId must reference an active option -------------------

  it('REJECTS a mealOptionId that has been retired', async () => {
    const { retired } = await seedMealOptions()
    const { token } = await seedInvite(1)
    const result = await submitRsvp(testDb, token, {
      attending: true,
      guests: [entry({ mealOptionId: retired.id })],
      extraSeatsRequested: 0,
    }, OPEN, DEADLINE)
    expect(result).toEqual({ ok: false, reason: 'INVALID_MEAL_OPTION' })
  })

  it('REJECTS a mealOptionId belonging to no meal option at all', async () => {
    await seedMealOptions()
    const { token } = await seedInvite(1)
    const result = await submitRsvp(testDb, token, {
      attending: true,
      guests: [entry({ mealOptionId: '507f1f77bcf86cd799439011' })],
      extraSeatsRequested: 0,
    }, OPEN, DEADLINE)
    expect(result).toEqual({ ok: false, reason: 'INVALID_MEAL_OPTION' })
  })

  it('ACCEPTS an active mealOptionId', async () => {
    const { active } = await seedMealOptions()
    const { token } = await seedInvite(1)
    const result = await submitRsvp(testDb, token, {
      attending: true,
      guests: [entry({ mealOptionId: active.id })],
      extraSeatsRequested: 0,
    }, OPEN, DEADLINE)
    expect(result).toMatchObject({ ok: true })
  })

  // --- I2: duplicate own-ids must not delete a party member ---------------

  it('REJECTS duplicate guest ids instead of silently deleting the other party member', async () => {
    const { invite, token } = await seedInvite(2)
    const primary = await testDb.guest.findFirstOrThrow({ where: { inviteId: invite.id } })
    await submitRsvp(testDb, token, {
      attending: true,
      guests: [entry({ id: primary.id }), entry({ firstName: 'Sam', lastName: 'Reyes' })],
      extraSeatsRequested: 0,
    }, OPEN, DEADLINE)
    const [g1, g2] = await testDb.guest.findMany({
      where: { inviteId: invite.id }, orderBy: { createdAt: 'asc' },
    })

    const result = await submitRsvp(testDb, token, {
      attending: true,
      guests: [entry({ id: g1!.id }), entry({ id: g1!.id, firstName: 'Duplicate' })],
      extraSeatsRequested: 0,
    }, OPEN, DEADLINE)

    expect(result).toEqual({ ok: false, reason: 'DUPLICATE_GUEST' })
    expect(await testDb.guest.findUnique({ where: { id: g2!.id } })).not.toBeNull()
  })

  it('audits the submission with real information and without ever recording the token', async () => {
    const { invite, token } = await seedInvite(2)
    await submitRsvp(testDb, token, {
      attending: true,
      guests: [entry(), entry({ firstName: 'Sam', lastName: 'Reyes' })],
      extraSeatsRequested: 0,
    }, OPEN, DEADLINE)

    const log = await testDb.auditLog.findFirstOrThrow({ where: { action: 'rsvp.submit' } })
    expect(log.actorId).toBeNull()
    expect(log.entityId).toBe(invite.id)
    // Positive assertions on real content: a no-op audit writer (or one that
    // merely console.logs the token elsewhere) cannot satisfy these, unlike a
    // bare "the row doesn't contain the token" check.
    expect(log.meta).toMatchObject({ attending: true, partySize: 2, extraSeatsRequested: 0 })
    expect(JSON.stringify(log)).not.toContain(token)
    expect(JSON.stringify(log)).not.toContain(hashToken(token))
  })
})
