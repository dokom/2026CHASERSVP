import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import {
  getEvent, updateEventDetails, upsertAgendaItem, deleteAgendaItem,
  upsertMealOption, setMealOptionActive,
} from '@/lib/events/repository'

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function seedEvent() {
  return testDb.event.create({
    data: {
      name: 'The 2026 Annual Gala',
      startsAt: new Date('2026-11-14T18:00:00Z'),
      venueName: 'The Grand Hall',
      address: '1 Placeholder Avenue',
      rsvpDeadline: new Date('2026-10-24T23:59:00Z'),
    },
  })
}

describe('event repository', () => {
  it('returns null before an event is configured', async () => {
    expect(await getEvent(testDb)).toBeNull()
  })

  it('loads the event with its empty collections', async () => {
    await seedEvent()
    const event = await getEvent(testDb)
    expect(event).toMatchObject({ name: 'The 2026 Annual Gala', venueName: 'The Grand Hall' })
    expect(event?.agendaItems).toEqual([])
    expect(event?.mealOptions).toEqual([])
    expect(event?.tableMarkers).toEqual([])
  })

  it('updates editable details and audits the change', async () => {
    const seeded = await seedEvent()
    await updateEventDetails(testDb, null, seeded.id, { name: 'Renamed', dressCode: 'Black tie' })
    const event = await getEvent(testDb)
    expect(event).toMatchObject({ name: 'Renamed', dressCode: 'Black tie' })
    expect(await testDb.auditLog.count({ where: { action: 'event.update' } })).toBe(1)
  })

  it('adds agenda items and returns them in sortOrder', async () => {
    const seeded = await seedEvent()
    await upsertAgendaItem(testDb, null, seeded.id, {
      title: 'Dinner', startsAt: new Date('2026-11-14T19:00:00Z'), sortOrder: 1,
    })
    await upsertAgendaItem(testDb, null, seeded.id, {
      title: 'Cocktails', startsAt: new Date('2026-11-14T18:00:00Z'), sortOrder: 0,
    })
    const event = await getEvent(testDb)
    expect(event?.agendaItems.map((a) => a.title)).toEqual(['Cocktails', 'Dinner'])
  })

  it('updates an existing agenda item rather than duplicating it', async () => {
    const seeded = await seedEvent()
    const id = await upsertAgendaItem(testDb, null, seeded.id, {
      title: 'Dinner', startsAt: new Date('2026-11-14T19:00:00Z'), sortOrder: 0,
    })
    await upsertAgendaItem(testDb, null, seeded.id, {
      id, title: 'Dinner service', startsAt: new Date('2026-11-14T19:30:00Z'), sortOrder: 0,
    })
    const event = await getEvent(testDb)
    expect(event?.agendaItems).toHaveLength(1)
    expect(event?.agendaItems[0]?.title).toBe('Dinner service')
  })

  it('deletes an agenda item', async () => {
    const seeded = await seedEvent()
    const id = await upsertAgendaItem(testDb, null, seeded.id, {
      title: 'Dinner', startsAt: new Date('2026-11-14T19:00:00Z'), sortOrder: 0,
    })
    await deleteAgendaItem(testDb, null, id)
    expect((await getEvent(testDb))?.agendaItems).toEqual([])
  })

  it('adds meal options', async () => {
    const seeded = await seedEvent()
    await upsertMealOption(testDb, null, seeded.id, { label: 'Beef', sortOrder: 0 })
    expect((await getEvent(testDb))?.mealOptions[0]?.label).toBe('Beef')
  })

  it('DEACTIVATES a meal option instead of deleting it, so a guest choice is never stranded', async () => {
    const seeded = await seedEvent()
    const mealId = await upsertMealOption(testDb, null, seeded.id, { label: 'Beef', sortOrder: 0 })
    const invite = await testDb.invite.create({
      data: { tokenHash: 'h', tokenCipher: 'c', label: 'Party' },
    })
    await testDb.guest.create({
      data: { inviteId: invite.id, firstName: 'A', lastName: 'B', mealOptionId: mealId },
    })

    await setMealOptionActive(testDb, null, mealId, false)

    const event = await getEvent(testDb)
    expect(event?.mealOptions).toHaveLength(1)
    expect(event?.mealOptions[0]?.isActive).toBe(false)
    const guest = await testDb.guest.findFirstOrThrow()
    expect(guest.mealOptionId).toBe(mealId)
  })

  it('returns the oldest event when more than one somehow exists', async () => {
    const first = await seedEvent()
    await testDb.event.create({
      data: {
        name: 'Stray second event',
        startsAt: new Date('2027-01-01T00:00:00Z'),
        venueName: 'Elsewhere',
        address: 'Nowhere',
        rsvpDeadline: new Date('2026-12-01T00:00:00Z'),
      },
    })
    expect((await getEvent(testDb))?.id).toBe(first.id)
  })

  it('audits every mutation', async () => {
    const seeded = await seedEvent()
    const agendaId = await upsertAgendaItem(testDb, null, seeded.id, {
      title: 'Dinner', startsAt: new Date('2026-11-14T19:00:00Z'), sortOrder: 0,
    })
    await deleteAgendaItem(testDb, null, agendaId)
    const mealId = await upsertMealOption(testDb, null, seeded.id, { label: 'Beef', sortOrder: 0 })
    await setMealOptionActive(testDb, null, mealId, false)
    const actions = (await testDb.auditLog.findMany()).map((l) => l.action)
    expect(actions).toEqual(expect.arrayContaining([
      'agendaItem.upsert', 'agendaItem.delete', 'mealOption.upsert', 'mealOption.setActive',
    ]))
  })
})
