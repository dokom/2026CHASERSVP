import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { seed } from '../../prisma/seed'

const ENV = {
  ADMIN_SEED_EMAIL: 'owner@example.com',
  ADMIN_SEED_PASSWORD: 'seeded password 1',
}

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

describe('seed', () => {
  it('creates an owner, an event, agenda items, and meal options', async () => {
    const summary = await seed(testDb, ENV)
    expect(summary.ownerCreated).toBe(true)
    expect(summary.eventCreated).toBe(true)

    const owner = await testDb.adminUser.findUniqueOrThrow({ where: { email: ENV.ADMIN_SEED_EMAIL } })
    expect(owner.role).toBe('OWNER')
    expect(await testDb.event.count()).toBe(1)
    expect(await testDb.agendaItem.count()).toBeGreaterThan(0)
    expect(await testDb.mealOption.count()).toBeGreaterThan(0)
  })

  it('creates sample invites with recoverable tokens', async () => {
    const summary = await seed(testDb, ENV)
    expect(summary.invitesCreated).toBeGreaterThan(0)
    const invites = await testDb.invite.findMany()
    expect(invites.every((i) => i.tokenCipher.startsWith('v1.'))).toBe(true)
  })

  it('is idempotent — a second run creates nothing new', async () => {
    await seed(testDb, ENV)
    const counts = {
      users: await testDb.adminUser.count(),
      events: await testDb.event.count(),
      invites: await testDb.invite.count(),
      agenda: await testDb.agendaItem.count(),
      meals: await testDb.mealOption.count(),
    }

    const second = await seed(testDb, ENV)
    expect(second).toEqual({ ownerCreated: false, eventCreated: false, invitesCreated: 0 })
    expect(await testDb.adminUser.count()).toBe(counts.users)
    expect(await testDb.event.count()).toBe(counts.events)
    expect(await testDb.invite.count()).toBe(counts.invites)
    expect(await testDb.agendaItem.count()).toBe(counts.agenda)
    expect(await testDb.mealOption.count()).toBe(counts.meals)
  })

  it('sets an RSVP deadline before the event start', async () => {
    await seed(testDb, ENV)
    const event = await testDb.event.findFirstOrThrow()
    expect(event.rsvpDeadline.getTime()).toBeLessThan(event.startsAt.getTime())
  })

  it('marks the seeded owner as needing a password change', async () => {
    await seed(testDb, ENV)
    const owner = await testDb.adminUser.findUniqueOrThrow({ where: { email: ENV.ADMIN_SEED_EMAIL } })
    expect(owner.mustChangePassword).toBe(true)
  })
})
