import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { getEvent, setSeatsReleased } from '@/lib/events/repository'
import { loadGuestPage } from '@/lib/guest/page-data'
import { createInvite } from '@/lib/invites/repository'
import { createPlaceholderInvites } from '@/lib/invites/placeholders'
import { listInviteTokens } from '@/lib/invites/repository'

const NOW = new Date('2026-09-01T00:00:00Z')

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function seedEvent(seatsReleasedAt: Date | null = null) {
  return testDb.event.create({
    data: {
      name: 'Gala', startsAt: new Date('2026-11-14T18:00:00Z'),
      venueName: 'The Grand Hall', address: '1 Placeholder Avenue',
      rsvpDeadline: new Date('2026-10-24T23:59:00Z'),
      seatsReleasedAt,
      tableMarkers: { create: [{ tableNumber: '12', x: 0.4, y: 0.6 }] },
    },
  })
}

async function seatedParty(attending: boolean | null): Promise<string> {
  const { invite, token } = await createInvite(testDb, null, {
    label: 'Reyes Party', seatsAllotted: 1, tableNumber: '12',
    primaryGuest: { firstName: 'Jordan', lastName: 'Reyes' },
  })
  if (attending !== null) {
    await testDb.guest.updateMany({ where: { inviteId: invite.id }, data: { attending } })
  }
  return token
}

describe('setSeatsReleased', () => {
  it('starts hidden, releases with a timestamp, and can be hidden again', async () => {
    const event = await seedEvent()
    expect((await getEvent(testDb))?.seatsReleasedAt).toBeNull()

    await setSeatsReleased(testDb, null, event.id, true, NOW)
    expect((await getEvent(testDb))?.seatsReleasedAt).toEqual(NOW)

    await setSeatsReleased(testDb, null, event.id, false)
    expect((await getEvent(testDb))?.seatsReleasedAt).toBeNull()

    const audit = await testDb.auditLog.findMany({ where: { action: 'event.setSeatsReleased' } })
    expect(audit.map((a) => a.meta)).toEqual([{ released: true }, { released: false }])
  })
})

describe('loadGuestPage seat gate', () => {
  it('withholds the table until seating is released, even for a confirmed guest', async () => {
    await seedEvent(null)
    const token = await seatedParty(true)
    const data = await loadGuestPage(testDb, token, NOW)
    expect(data?.seat).toEqual({ shown: false, reason: 'NOT_RELEASED' })
    expect(data?.seats).toEqual([])
  })

  it('withholds the table from an unconfirmed guest after release', async () => {
    await seedEvent(NOW)
    const token = await seatedParty(null)
    const data = await loadGuestPage(testDb, token, NOW)
    expect(data?.seat).toEqual({ shown: false, reason: 'NOT_CONFIRMED' })
    expect(data?.seats).toEqual([])
  })

  it('withholds the table from a guest who declined', async () => {
    await seedEvent(NOW)
    const token = await seatedParty(false)
    expect((await loadGuestPage(testDb, token, NOW))?.seat).toEqual({ shown: false, reason: 'NOT_CONFIRMED' })
  })

  it('shows the table and marker once released AND confirmed', async () => {
    await seedEvent(NOW)
    const token = await seatedParty(true)
    const data = await loadGuestPage(testDb, token, NOW)
    expect(data?.seat).toEqual({ shown: true })
    expect(data?.seats).toHaveLength(1)
    expect(data?.seats[0]).toMatchObject({ table: '12', marker: expect.objectContaining({ tableNumber: '12' }) })
  })

  it('treats an unassigned placeholder as unconfirmed', async () => {
    await seedEvent(NOW)
    await createPlaceholderInvites(testDb, null, { count: 1, seatsAllotted: 1 })
    const [row] = await listInviteTokens(testDb)
    const data = await loadGuestPage(testDb, row!.token, NOW)
    expect(data?.invite.guests).toEqual([])
    expect(data?.seat).toEqual({ shown: false, reason: 'NOT_CONFIRMED' })
  })
})
