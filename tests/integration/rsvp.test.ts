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
  const seeded = await createInvite(testDb, null, {
    label: 'Reyes Party',
    seatsAllotted: seats,
    primaryGuest: { firstName: 'Jordan', lastName: 'Reyes', email: 'jordan@example.com', company: 'Northwind' },
  })
  const primary = await testDb.guest.findFirstOrThrow({ where: { inviteId: seeded.invite.id } })
  return { ...seeded, primary }
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
  const active = await testDb.mealOption.create({ data: { eventId: event.id, label: 'Chicken', isActive: true } })
  const retired = await testDb.mealOption.create({ data: { eventId: event.id, label: 'Discontinued Fish', isActive: false } })
  return { active, retired }
}

const coming = (id: string, over: Record<string, unknown> = {}) => ({ id, attending: true, ...over })
const notComing = (id: string) => ({ id, attending: false })
/** A companion the guest adds on the form: no id yet. */
const companion = (over: Record<string, unknown> = {}) => ({ attending: true, ...over })

describe('submitRsvp', () => {
  it('records an acceptance and marks the invite ATTENDING', async () => {
    const { invite, token, primary } = await seedInvite()
    const result = await submitRsvp(testDb, token, { guests: [coming(primary.id)], extraSeatsRequested: 0 }, OPEN, DEADLINE)

    expect(result).toMatchObject({ ok: true, status: 'ATTENDING' })
    const fresh = await testDb.guest.findUniqueOrThrow({ where: { id: primary.id } })
    expect(fresh.attending).toBe(true)
    expect((await testDb.invite.findUniqueOrThrow({ where: { id: invite.id } })).status).toBe('ATTENDING')
  })

  it('records a decline and marks the invite DECLINED', async () => {
    const { invite, token, primary } = await seedInvite()
    const result = await submitRsvp(testDb, token, { guests: [notComing(primary.id)], extraSeatsRequested: 0 }, OPEN, DEADLINE)

    expect(result).toMatchObject({ ok: true, status: 'DECLINED' })
    expect((await testDb.invite.findUniqueOrThrow({ where: { id: invite.id } })).status).toBe('DECLINED')
  })

  it('marks a split party PARTIAL', async () => {
    const { token, primary } = await seedInvite(2)
    await submitRsvp(testDb, token, { guests: [coming(primary.id), companion()], extraSeatsRequested: 0 }, OPEN, DEADLINE)
    const added = await testDb.guest.findFirstOrThrow({ where: { isPrimary: false } })

    const result = await submitRsvp(testDb, token, { guests: [coming(primary.id), notComing(added.id)], extraSeatsRequested: 0 }, OPEN, DEADLINE)
    expect(result).toMatchObject({ ok: true, status: 'PARTIAL' })
  })

  it('stamps respondedAt', async () => {
    const { invite, token, primary } = await seedInvite()
    await submitRsvp(testDb, token, { guests: [coming(primary.id)], extraSeatsRequested: 0 }, OPEN, DEADLINE)
    const fresh = await testDb.invite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(fresh.respondedAt?.toISOString()).toBe(OPEN.toISOString())
  })

  // --- the guest never edits what the organiser imported --------------------

  it('leaves imported contact details untouched when answering', async () => {
    const { token, primary } = await seedInvite()
    await submitRsvp(testDb, token, { guests: [coming(primary.id)], extraSeatsRequested: 0 }, OPEN, DEADLINE)
    const fresh = await testDb.guest.findUniqueOrThrow({ where: { id: primary.id } })
    expect(fresh).toMatchObject({ firstName: 'Jordan', lastName: 'Reyes', email: 'jordan@example.com', company: 'Northwind' })
  })

  it('ignores names sent for a known guest', async () => {
    const { token, primary } = await seedInvite()
    await submitRsvp(testDb, token, {
      guests: [coming(primary.id, { firstName: 'Hijacked', lastName: 'Name' })],
      extraSeatsRequested: 0,
    }, OPEN, DEADLINE)
    const fresh = await testDb.guest.findUniqueOrThrow({ where: { id: primary.id } })
    expect(fresh.firstName).toBe('Jordan')
  })

  // --- companions ----------------------------------------------------------

  it('adds a named companion up to the seat allowance', async () => {
    const { invite, token, primary } = await seedInvite(2)
    await submitRsvp(testDb, token, {
      guests: [coming(primary.id), companion({ firstName: 'Sam', lastName: 'Reyes' })],
      extraSeatsRequested: 0,
    }, OPEN, DEADLINE)
    const guests = await testDb.guest.findMany({ where: { inviteId: invite.id } })
    expect(guests).toHaveLength(2)
    expect(guests.find((g) => !g.isPrimary)).toMatchObject({ firstName: 'Sam', lastName: 'Reyes', attending: true })
  })

  it('names an unnamed companion after the host', async () => {
    const { token, primary } = await seedInvite(2)
    await submitRsvp(testDb, token, { guests: [coming(primary.id), companion()], extraSeatsRequested: 0 }, OPEN, DEADLINE)
    const added = await testDb.guest.findFirstOrThrow({ where: { isPrimary: false } })
    expect(added).toMatchObject({ firstName: 'Guest of Jordan', lastName: 'Reyes' })
  })

  it('does not create a companion who is marked as not coming', async () => {
    const { invite, token, primary } = await seedInvite(2)
    await submitRsvp(testDb, token, { guests: [coming(primary.id), { attending: false }], extraSeatsRequested: 0 }, OPEN, DEADLINE)
    expect(await testDb.guest.count({ where: { inviteId: invite.id } })).toBe(1)
  })

  it('refuses more guests than the seat allowance', async () => {
    const { token, primary } = await seedInvite(1)
    const result = await submitRsvp(testDb, token, { guests: [coming(primary.id), companion()], extraSeatsRequested: 0 }, OPEN, DEADLINE)
    expect(result).toEqual({ ok: false, reason: 'SEAT_LIMIT' })
  })

  // --- ids ------------------------------------------------------------------

  it('REFUSES a guest id belonging to another invite', async () => {
    // Horizontal privilege escalation: without this check a guest could answer
    // for any other party by pasting their guest id into the payload.
    const { token } = await seedInvite()
    const other = await createInvite(testDb, null, {
      label: 'Okafor Party', seatsAllotted: 1, primaryGuest: { firstName: 'Ada', lastName: 'Okafor' },
    })
    const victim = await testDb.guest.findFirstOrThrow({ where: { inviteId: other.invite.id } })

    const result = await submitRsvp(testDb, token, { guests: [notComing(victim.id)], extraSeatsRequested: 0 }, OPEN, DEADLINE)

    expect(result).toEqual({ ok: false, reason: 'FOREIGN_GUEST' })
    const untouched = await testDb.guest.findUniqueOrThrow({ where: { id: victim.id } })
    expect(untouched.attending).toBeNull()
  })

  it('writes nothing at all when a foreign guest id is present', async () => {
    const { token, primary } = await seedInvite()
    const other = await createInvite(testDb, null, {
      label: 'Okafor Party', seatsAllotted: 1, primaryGuest: { firstName: 'Ada', lastName: 'Okafor' },
    })
    const victim = await testDb.guest.findFirstOrThrow({ where: { inviteId: other.invite.id } })

    await submitRsvp(testDb, token, { guests: [coming(primary.id), coming(victim.id)], extraSeatsRequested: 0 }, OPEN, DEADLINE)

    const fresh = await testDb.guest.findUniqueOrThrow({ where: { id: primary.id } })
    expect(fresh.attending).toBeNull()
  })

  it('REJECTS duplicate guest ids', async () => {
    const { token, primary } = await seedInvite(2)
    const result = await submitRsvp(testDb, token, {
      guests: [coming(primary.id), notComing(primary.id)],
      extraSeatsRequested: 0,
    }, OPEN, DEADLINE)
    expect(result).toEqual({ ok: false, reason: 'DUPLICATE_GUEST' })
    expect((await testDb.guest.findUniqueOrThrow({ where: { id: primary.id } })).attending).toBeNull()
  })

  // --- window and token -----------------------------------------------------

  it('refuses once the deadline has passed', async () => {
    const { token, primary } = await seedInvite()
    const result = await submitRsvp(testDb, token, { guests: [notComing(primary.id)], extraSeatsRequested: 0 }, CLOSED, DEADLINE)
    expect(result).toEqual({ ok: false, reason: 'CLOSED' })
  })

  it('refuses an unknown token', async () => {
    const result = await submitRsvp(testDb, 'nope', { guests: [companion()], extraSeatsRequested: 0 }, OPEN, DEADLINE)
    expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' })
  })

  it('records an extra-seat request as PENDING without creating seats', async () => {
    const { invite, token, primary } = await seedInvite(1)
    await submitRsvp(testDb, token, {
      guests: [coming(primary.id)], extraSeatsRequested: 2, extraSeatsReason: 'Bringing my parents',
    }, OPEN, DEADLINE)

    const fresh = await testDb.invite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(fresh.extraSeatsStatus).toBe('PENDING')
    expect(fresh.extraSeatsRequested).toBe(2)
    expect(fresh.seatsAllotted).toBe(1)
  })

  // --- C2: a resubmission must never destroy seat or check-in state -----------

  it('REFUSES a resubmission that strips the ids rather than replacing a checked-in guest', async () => {
    const { invite, token, primary } = await seedInvite(2)
    await submitRsvp(testDb, token, {
      guests: [coming(primary.id), companion({ firstName: 'Sam', lastName: 'Reyes' })], extraSeatsRequested: 0,
    }, OPEN, DEADLINE)
    const sam = await testDb.guest.findFirstOrThrow({ where: { firstName: 'Sam' } })
    const checkinTime = new Date('2026-09-15T18:00:00Z')
    await testDb.guest.update({ where: { id: sam.id }, data: { tableNumber: '7', checkedInAt: checkinTime } })

    // Every hidden id stripped: indistinguishable from a form that never sent
    // them. Both entries now look like companions, and the party would grow to
    // four on a two-seat invite.
    const result = await submitRsvp(testDb, token, { guests: [companion(), companion()], extraSeatsRequested: 0 }, OPEN, DEADLINE)

    expect(result).toEqual({ ok: false, reason: 'SEAT_LIMIT' })
    const stillCheckedIn = await testDb.guest.findUniqueOrThrow({ where: { id: sam.id } })
    expect(stillCheckedIn.checkedInAt?.toISOString()).toBe(checkinTime.toISOString())
    expect(stillCheckedIn.tableNumber).toBe('7')
    expect(await testDb.guest.count({ where: { inviteId: invite.id } })).toBe(2)
  })

  it('preserves isPrimary and tableNumber across repeated answers', async () => {
    const { invite, token, primary } = await seedInvite(1)
    await testDb.guest.update({ where: { id: primary.id }, data: { tableNumber: '3' } })

    const payload = { guests: [coming(primary.id)], extraSeatsRequested: 0 }
    await submitRsvp(testDb, token, payload, OPEN, DEADLINE)
    await submitRsvp(testDb, token, payload, OPEN, DEADLINE)

    const fresh = await testDb.guest.findUniqueOrThrow({ where: { id: primary.id } })
    expect(fresh.isPrimary).toBe(true)
    expect(fresh.tableNumber).toBe('3')
    expect(await testDb.guest.count({ where: { inviteId: invite.id } })).toBe(1)
  })

  // --- I1: mealOptionId must reference an active option -------------------

  it('REJECTS a mealOptionId that has been retired', async () => {
    const { retired } = await seedMealOptions()
    const { token, primary } = await seedInvite(1)
    const result = await submitRsvp(testDb, token, { guests: [coming(primary.id, { mealOptionId: retired.id })], extraSeatsRequested: 0 }, OPEN, DEADLINE)
    expect(result).toEqual({ ok: false, reason: 'INVALID_MEAL_OPTION' })
  })

  it('REJECTS a mealOptionId belonging to no meal option at all', async () => {
    await seedMealOptions()
    const { token, primary } = await seedInvite(1)
    const result = await submitRsvp(testDb, token, {
      guests: [coming(primary.id, { mealOptionId: '507f1f77bcf86cd799439011' })], extraSeatsRequested: 0,
    }, OPEN, DEADLINE)
    expect(result).toEqual({ ok: false, reason: 'INVALID_MEAL_OPTION' })
  })

  it('ACCEPTS an active mealOptionId and stores it', async () => {
    const { active } = await seedMealOptions()
    const { token, primary } = await seedInvite(1)
    const result = await submitRsvp(testDb, token, { guests: [coming(primary.id, { mealOptionId: active.id })], extraSeatsRequested: 0 }, OPEN, DEADLINE)
    expect(result).toMatchObject({ ok: true })
    expect((await testDb.guest.findUniqueOrThrow({ where: { id: primary.id } })).mealOptionId).toBe(active.id)
  })

  it('ignores a meal choice for a guest who is not coming', async () => {
    const { retired } = await seedMealOptions()
    const { token, primary } = await seedInvite(1)
    const result = await submitRsvp(testDb, token, { guests: [{ ...notComing(primary.id), mealOptionId: retired.id }], extraSeatsRequested: 0 }, OPEN, DEADLINE)
    expect(result).toMatchObject({ ok: true, status: 'DECLINED' })
  })

  it('audits the submission with real information and without ever recording the token', async () => {
    const { invite, token, primary } = await seedInvite(2)
    await submitRsvp(testDb, token, {
      guests: [coming(primary.id), companion({ firstName: 'Sam', lastName: 'Reyes' })], extraSeatsRequested: 0,
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
