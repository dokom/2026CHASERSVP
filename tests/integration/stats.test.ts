import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { dashboard } from '@/lib/stats/rsvp'

const NOW = new Date('2026-09-10T12:00:00Z')

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function seed() {
  const event = await testDb.event.create({
    data: {
      name: 'Gala', startsAt: new Date('2026-11-14T18:00:00Z'), venueName: 'Hall', address: 'x',
      rsvpDeadline: new Date('2026-10-24T23:59:00Z'),
      mealOptions: { create: [{ label: 'Beef', sortOrder: 0 }, { label: 'Fish', sortOrder: 1, isActive: false }] },
    },
    include: { mealOptions: true },
  })
  const [beef, fish] = event.mealOptions
  const mk = (label: string, status: 'PENDING' | 'ATTENDING' | 'DECLINED' | 'PARTIAL', respondedAt: Date | null) =>
    testDb.invite.create({ data: { tokenHash: label, tokenCipher: 'c', number: label.charCodeAt(0), label, status, respondedAt, seatsAllotted: 2 } })

  const a = await mk('A', 'ATTENDING', new Date('2026-09-01T10:00:00Z'))
  const b = await mk('B', 'ATTENDING', new Date('2026-09-01T15:00:00Z'))
  const c = await mk('C', 'DECLINED', new Date('2026-09-03T10:00:00Z'))
  const d = await mk('D', 'PARTIAL', new Date('2026-09-05T10:00:00Z'))
  await mk('E', 'PENDING', null)

  await testDb.guest.createMany({ data: [
    { inviteId: a.id, firstName: 'A1', lastName: 'x', attending: true, mealOptionId: beef!.id, checkedInAt: NOW },
    { inviteId: a.id, firstName: 'A2', lastName: 'x', attending: true, mealOptionId: fish!.id },
    { inviteId: b.id, firstName: 'B1', lastName: 'x', attending: true, mealOptionId: beef!.id },
    { inviteId: c.id, firstName: 'C1', lastName: 'x', attending: false },
    { inviteId: d.id, firstName: 'D1', lastName: 'x', attending: true },
    { inviteId: d.id, firstName: 'D2', lastName: 'x', attending: false },
  ] })
}

describe('dashboard', () => {
  it('counts invites by status', async () => {
    await seed()
    const d = await dashboard(testDb)
    expect(d.invites).toEqual({ total: 5, responded: 4, attending: 2, declined: 1, partial: 1, pending: 1 })
  })

  it('counts people coming and arrived', async () => {
    await seed()
    const d = await dashboard(testDb)
    expect(d.guests).toEqual({ attending: 4, checkedIn: 1 })
  })

  it('tallies meals INCLUDING retired options — a retired choice still eats', async () => {
    await seed()
    const d = await dashboard(testDb)
    expect(d.meals).toEqual(expect.arrayContaining([
      { label: 'Beef', count: 2, isActive: true },
      { label: 'Fish', count: 1, isActive: false },
    ]))
  })

  it('counts only ATTENDING guests toward meals', async () => {
    await seed()
    // C1 declined; if it had a meal it must not count.
    const invite = await testDb.invite.findFirstOrThrow({ where: { label: 'C' } })
    const meal = await testDb.mealOption.findFirstOrThrow({ where: { label: 'Beef' } })
    await testDb.guest.updateMany({ where: { inviteId: invite.id }, data: { mealOptionId: meal.id } })
    const d = await dashboard(testDb)
    expect(d.meals.find((m) => m.label === 'Beef')?.count).toBe(2)
  })

  it('buckets responses by UTC day in ascending order', async () => {
    await seed()
    const d = await dashboard(testDb)
    expect(d.responsesByDay).toEqual([
      { date: '2026-09-01', count: 2 },
      { date: '2026-09-03', count: 1 },
      { date: '2026-09-05', count: 1 },
    ])
  })

  it('is all zeros on an empty database rather than throwing', async () => {
    const d = await dashboard(testDb)
    expect(d.invites.total).toBe(0)
    expect(d.meals).toEqual([])
    expect(d.responsesByDay).toEqual([])
  })
})
