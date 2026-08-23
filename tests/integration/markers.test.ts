import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { upsertTableMarker, deleteTableMarker, MarkerOutOfBoundsError } from '@/lib/events/markers'

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function seedEvent() {
  return testDb.event.create({
    data: {
      name: 'Gala', startsAt: new Date('2026-11-14T18:00:00Z'),
      venueName: 'Hall', address: 'Somewhere',
      rsvpDeadline: new Date('2026-10-24T23:59:00Z'),
    },
  })
}

describe('table markers', () => {
  it('places a marker', async () => {
    const event = await seedEvent()
    const id = await upsertTableMarker(testDb, null, event.id, { tableNumber: '12', x: 0.4, y: 0.6 })
    const marker = await testDb.tableMarker.findUniqueOrThrow({ where: { id } })
    expect(marker).toMatchObject({ tableNumber: '12', x: 0.4, y: 0.6 })
  })

  it('MOVES an existing marker rather than adding a second for the same table', async () => {
    const event = await seedEvent()
    await upsertTableMarker(testDb, null, event.id, { tableNumber: '12', x: 0.1, y: 0.1 })
    await upsertTableMarker(testDb, null, event.id, { tableNumber: '12', x: 0.9, y: 0.9 })
    const markers = await testDb.tableMarker.findMany({ where: { eventId: event.id } })
    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({ x: 0.9, y: 0.9 })
  })

  it('accepts the exact boundaries', async () => {
    const event = await seedEvent()
    await expect(upsertTableMarker(testDb, null, event.id, { tableNumber: '1', x: 0, y: 0 }))
      .resolves.toBeTruthy()
    await expect(upsertTableMarker(testDb, null, event.id, { tableNumber: '2', x: 1, y: 1 }))
      .resolves.toBeTruthy()
  })

  it('rejects coordinates outside 0-1', async () => {
    const event = await seedEvent()
    for (const bad of [{ x: -0.01, y: 0.5 }, { x: 1.01, y: 0.5 }, { x: 0.5, y: -1 }, { x: 0.5, y: 2 }]) {
      await expect(upsertTableMarker(testDb, null, event.id, { tableNumber: '1', ...bad }))
        .rejects.toBeInstanceOf(MarkerOutOfBoundsError)
    }
  })

  it('rejects NaN coordinates', async () => {
    const event = await seedEvent()
    await expect(upsertTableMarker(testDb, null, event.id, { tableNumber: '1', x: NaN, y: 0.5 }))
      .rejects.toBeInstanceOf(MarkerOutOfBoundsError)
  })

  it('rejects an empty table number', async () => {
    const event = await seedEvent()
    await expect(upsertTableMarker(testDb, null, event.id, { tableNumber: '  ', x: 0.5, y: 0.5 }))
      .rejects.toThrow()
  })

  it('deletes a marker', async () => {
    const event = await seedEvent()
    const id = await upsertTableMarker(testDb, null, event.id, { tableNumber: '12', x: 0.5, y: 0.5 })
    await deleteTableMarker(testDb, null, id)
    expect(await testDb.tableMarker.count()).toBe(0)
  })

  it('audits placement and deletion', async () => {
    const event = await seedEvent()
    const id = await upsertTableMarker(testDb, null, event.id, { tableNumber: '12', x: 0.5, y: 0.5 })
    await deleteTableMarker(testDb, null, id)
    const actions = (await testDb.auditLog.findMany()).map((l) => l.action)
    expect(actions).toEqual(expect.arrayContaining(['tableMarker.upsert', 'tableMarker.delete']))
  })
})
