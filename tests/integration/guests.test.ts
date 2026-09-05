import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { listGuests, allGuestsForExport } from '@/lib/guests/repository'

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function seedInvite(label: string, tableNumber: string | null) {
  return testDb.invite.create({
    data: {
      tokenHash: `hash-${label}-${Math.random()}`,
      tokenCipher: `cipher-${label}`,
      number: Math.floor(Math.random() * 1_000_000),
      label,
      seatsAllotted: 5,
      tableNumber,
    },
  })
}

async function seedMealOption(label: string) {
  const event = await testDb.event.create({
    data: {
      name: 'Gala',
      startsAt: new Date('2026-11-14T18:00:00Z'),
      venueName: 'Hall',
      address: '1 Main St',
      rsvpDeadline: new Date('2026-11-01T00:00:00Z'),
    },
  })
  return testDb.mealOption.create({ data: { eventId: event.id, label } })
}

describe('guest repository', () => {
  it('searches by last name case-insensitively', async () => {
    const inviteA = await seedInvite('Party One', '1')
    const inviteB = await seedInvite('Party Two', '2')
    await testDb.guest.create({ data: { inviteId: inviteA.id, firstName: 'Jordan', lastName: 'Reyes' } })
    await testDb.guest.create({ data: { inviteId: inviteB.id, firstName: 'Amara', lastName: 'Okafor' } })
    const { rows, total } = await listGuests(testDb, { search: 'reyes', page: 1, pageSize: 50 })
    expect(total).toBe(1)
    expect(rows[0]?.lastName).toBe('Reyes')
  })

  it('searches by invite label case-insensitively', async () => {
    const invite = await seedInvite('Northwind Corp', '2')
    await testDb.guest.create({ data: { inviteId: invite.id, firstName: 'Sam', lastName: 'Lee' } })
    const { total } = await listGuests(testDb, { search: 'northwind', page: 1, pageSize: 50 })
    expect(total).toBe(1)
  })

  it('filters attending: no to only declined guests', async () => {
    const invite = await seedInvite('Party', '1')
    await testDb.guest.create({ data: { inviteId: invite.id, firstName: 'A', lastName: 'A', attending: true } })
    await testDb.guest.create({ data: { inviteId: invite.id, firstName: 'B', lastName: 'B', attending: false } })
    await testDb.guest.create({ data: { inviteId: invite.id, firstName: 'C', lastName: 'C', attending: null } })
    const { rows, total } = await listGuests(testDb, { attending: 'no', page: 1, pageSize: 50 })
    expect(total).toBe(1)
    expect(rows[0]?.firstName).toBe('B')
  })

  it('filters attending: unanswered to only null guests', async () => {
    const invite = await seedInvite('Party', '1')
    await testDb.guest.create({ data: { inviteId: invite.id, firstName: 'A', lastName: 'A', attending: true } })
    await testDb.guest.create({ data: { inviteId: invite.id, firstName: 'C', lastName: 'C', attending: null } })
    const { rows, total } = await listGuests(testDb, { attending: 'unanswered', page: 1, pageSize: 50 })
    expect(total).toBe(1)
    expect(rows[0]?.attending).toBeNull()
  })

  it('filters by checkedIn', async () => {
    const invite = await seedInvite('Party', '1')
    await testDb.guest.create({
      data: { inviteId: invite.id, firstName: 'A', lastName: 'A', checkedInAt: new Date() },
    })
    await testDb.guest.create({ data: { inviteId: invite.id, firstName: 'B', lastName: 'B' } })
    const { rows, total } = await listGuests(testDb, { checkedIn: true, page: 1, pageSize: 50 })
    expect(total).toBe(1)
    expect(rows[0]?.firstName).toBe('A')
  })

  it('filters by mealOptionId', async () => {
    const meal = await seedMealOption('Beef')
    const invite = await seedInvite('Party', '1')
    await testDb.guest.create({
      data: { inviteId: invite.id, firstName: 'A', lastName: 'A', mealOptionId: meal.id },
    })
    await testDb.guest.create({ data: { inviteId: invite.id, firstName: 'B', lastName: 'B' } })
    const { rows, total } = await listGuests(testDb, { mealOptionId: meal.id, page: 1, pageSize: 50 })
    expect(total).toBe(1)
    expect(rows[0]?.meal).toBe('Beef')
  })

  it('paginates', async () => {
    const invite = await seedInvite('Party', '1')
    for (let i = 0; i < 5; i++) {
      await testDb.guest.create({
        data: { inviteId: invite.id, firstName: `G${i}`, lastName: String.fromCharCode(65 + i) },
      })
    }
    const page = await listGuests(testDb, { page: 2, pageSize: 2 })
    expect(page.rows).toHaveLength(2)
    expect(page.total).toBe(5)
  })

  it('resolves table from the guest, falling back to the invite', async () => {
    const invite = await seedInvite('Party', '9')
    await testDb.guest.create({
      data: { inviteId: invite.id, firstName: 'A', lastName: 'A', tableNumber: '3' },
    })
    await testDb.guest.create({ data: { inviteId: invite.id, firstName: 'B', lastName: 'B' } })
    const { rows } = await listGuests(testDb, { page: 1, pageSize: 50 })
    const own = rows.find((r) => r.firstName === 'A')
    const inherited = rows.find((r) => r.firstName === 'B')
    expect(own?.table).toBe('3')
    expect(inherited?.table).toBe('9')
  })

  it('yields every guest exactly once across batches', async () => {
    const invite = await seedInvite('Big Party', '1')
    const total = 120
    for (let i = 0; i < total; i++) {
      await testDb.guest.create({
        data: {
          inviteId: invite.id,
          firstName: `G${i}`,
          lastName: String(i).padStart(4, '0'),
        },
      })
    }
    const seen = new Set<string>()
    for await (const row of allGuestsForExport(testDb, 50)) {
      seen.add(row.id)
    }
    expect(seen.size).toBe(total)
  })
})
