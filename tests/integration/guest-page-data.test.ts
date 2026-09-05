import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { loadGuestPage } from '@/lib/guest/page-data'
import { createInvite } from '@/lib/invites/repository'

const NOW = new Date('2026-09-01T00:00:00Z')

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function seedEvent() {
  return testDb.event.create({
    data: {
      name: 'Gala', startsAt: new Date('2026-11-14T18:00:00Z'),
      venueName: 'The Grand Hall', address: '1 Placeholder Avenue',
      rsvpDeadline: new Date('2026-10-24T23:59:00Z'),
      // Seating released: these tests cover table RESOLUTION. The gate that
      // hides a table until release + confirmation is covered separately in
      // tests/integration/seat-release.test.ts.
      seatsReleasedAt: new Date('2026-08-01T00:00:00Z'),
      tableMarkers: { create: [{ tableNumber: '12', x: 0.4, y: 0.6 }] },
    },
  })
}

/** The seat gate needs a confirmed primary guest before it resolves a table. */
async function confirmParty(inviteId: string): Promise<void> {
  await testDb.guest.updateMany({ where: { inviteId }, data: { attending: true } })
}

describe('loadGuestPage', () => {
  it('returns null for an unknown token', async () => {
    await seedEvent()
    expect(await loadGuestPage(testDb, 'nope', NOW)).toBeNull()
  })

  it('returns null when no event is configured', async () => {
    const { token } = await createInvite(testDb, null, {
      label: 'P', seatsAllotted: 1, primaryGuest: { firstName: 'A', lastName: 'B' },
    })
    expect(await loadGuestPage(testDb, token, NOW)).toBeNull()
  })

  it('assembles the invite, event and open window', async () => {
    await seedEvent()
    const { token } = await createInvite(testDb, null, {
      label: 'Reyes Party', seatsAllotted: 2, tableNumber: '12',
      primaryGuest: { firstName: 'Jordan', lastName: 'Reyes' },
    })
    const data = await loadGuestPage(testDb, token, NOW)
    expect(data?.event.name).toBe('Gala')
    expect(data?.invite.label).toBe('Reyes Party')
    expect(data?.window.isOpen).toBe(true)
  })

  it('resolves the table from the invite and finds its marker', async () => {
    await seedEvent()
    const { invite, token } = await createInvite(testDb, null, {
      label: 'P', seatsAllotted: 1, tableNumber: '12',
      primaryGuest: { firstName: 'A', lastName: 'B' },
    })
    await confirmParty(invite.id)
    const data = await loadGuestPage(testDb, token, NOW)
    expect(data?.table).toBe('12')
    expect(data?.marker).toMatchObject({ tableNumber: '12', x: 0.4, y: 0.6 })
  })

  it("prefers the primary guest's own table over the invite's", async () => {
    await seedEvent()
    const { invite, token } = await createInvite(testDb, null, {
      label: 'P', seatsAllotted: 1, tableNumber: '12',
      primaryGuest: { firstName: 'A', lastName: 'B' },
    })
    await testDb.guest.updateMany({ where: { inviteId: invite.id }, data: { tableNumber: '3' } })
    await confirmParty(invite.id)
    const data = await loadGuestPage(testDb, token, NOW)
    expect(data?.table).toBe('3')
  })

  it('returns a null marker when the table has no placed marker', async () => {
    await seedEvent()
    const { invite, token } = await createInvite(testDb, null, {
      label: 'P', seatsAllotted: 1, tableNumber: '99',
      primaryGuest: { firstName: 'A', lastName: 'B' },
    })
    await confirmParty(invite.id)
    const data = await loadGuestPage(testDb, token, NOW)
    expect(data?.table).toBe('99')
    expect(data?.marker).toBeNull()
  })

  it('reports a closed window after the deadline', async () => {
    await seedEvent()
    const { token } = await createInvite(testDb, null, {
      label: 'P', seatsAllotted: 1, primaryGuest: { firstName: 'A', lastName: 'B' },
    })
    const data = await loadGuestPage(testDb, token, new Date('2026-11-01T00:00:00Z'))
    expect(data?.window.isOpen).toBe(false)
  })

  it('exposes only active meal options', async () => {
    const event = await seedEvent()
    await testDb.mealOption.create({
      data: { eventId: event.id, label: 'Beef', sortOrder: 0 },
    })
    await testDb.mealOption.create({
      data: { eventId: event.id, label: 'Retired', sortOrder: 1, isActive: false },
    })
    const { token } = await createInvite(testDb, null, {
      label: 'P', seatsAllotted: 1, primaryGuest: { firstName: 'A', lastName: 'B' },
    })
    const data = await loadGuestPage(testDb, token, NOW)
    expect(data?.event.mealOptions.map((m) => m.label)).toEqual(['Beef'])
  })
})
