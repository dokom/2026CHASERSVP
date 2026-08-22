import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { buildInviteIcs } from '@/lib/guest/ics'
import { getEvent } from '@/lib/events/repository'

const STAMP = new Date('2026-08-22T12:00:00Z')

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function seedEvent(withAgenda: boolean) {
  return testDb.event.create({
    data: {
      name: 'Gala, 2026',
      startsAt: new Date('2026-11-14T18:00:00Z'),
      venueName: 'The Grand Hall',
      address: '1 Placeholder Avenue',
      rsvpDeadline: new Date('2026-10-24T23:59:00Z'),
      ...(withAgenda
        ? {
            agendaItems: {
              create: [
                { title: 'Cocktails', startsAt: new Date('2026-11-14T18:00:00Z'), sortOrder: 0 },
                { title: 'After-party', startsAt: new Date('2026-11-14T22:00:00Z'), sortOrder: 1 },
              ],
            },
          }
        : {}),
    },
  })
}

describe('buildInviteIcs', () => {
  it('ends one hour after the last agenda item', async () => {
    await seedEvent(true)
    const event = await getEvent(testDb)
    const ics = buildInviteIcs(event!, 'invite123', STAMP)
    expect(ics).toContain('DTSTART:20261114T180000Z')
    expect(ics).toContain('DTEND:20261114T230000Z')
  })

  it('falls back to five hours when there is no agenda', async () => {
    await seedEvent(false)
    const event = await getEvent(testDb)
    const ics = buildInviteIcs(event!, 'invite123', STAMP)
    expect(ics).toContain('DTEND:20261114T230000Z')
  })

  it('escapes the event name', async () => {
    await seedEvent(false)
    const event = await getEvent(testDb)
    expect(buildInviteIcs(event!, 'invite123', STAMP)).toContain('SUMMARY:Gala\\, 2026')
  })

  it('builds a uid stable for one invite', async () => {
    await seedEvent(false)
    const event = await getEvent(testDb)
    const first = buildInviteIcs(event!, 'invite123', STAMP)
    const second = buildInviteIcs(event!, 'invite123', new Date('2026-09-01T00:00:00Z'))
    const uid = (ics: string) => ics.split('\r\n').find((line) => line.startsWith('UID:'))
    expect(uid(first)).toBe(uid(second))
  })

  it('gives different invites different uids', async () => {
    await seedEvent(false)
    const event = await getEvent(testDb)
    const uid = (ics: string) => ics.split('\r\n').find((line) => line.startsWith('UID:'))
    expect(uid(buildInviteIcs(event!, 'a1', STAMP)))
      .not.toBe(uid(buildInviteIcs(event!, 'b2', STAMP)))
  })

  it('never puts the venue or name in the uid', async () => {
    await seedEvent(false)
    const event = await getEvent(testDb)
    const ics = buildInviteIcs(event!, 'invite123', STAMP)
    const uidLine = ics.split('\r\n').find((line) => line.startsWith('UID:')) ?? ''
    expect(uidLine).not.toContain('Grand Hall')
  })
})
