import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { createPlaceholderInvites } from '@/lib/invites/placeholders'
import { createInvite, getInvite, listInviteTokens } from '@/lib/invites/repository'
import {
  addGuest, updateGuest, removeGuest, GuestCheckedInError, GuestNotOnInviteError,
} from '@/lib/invites/guests'
import { resolveInviteByToken } from '@/lib/guest/resolve'

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function placeholder(seats = 2): Promise<{ id: string; token: string }> {
  await createPlaceholderInvites(testDb, null, { count: 1, seatsAllotted: seats })
  const [row] = await listInviteTokens(testDb)
  return { id: row!.id, token: row!.token }
}

describe('addGuest', () => {
  it('attaches a person to a placeholder and makes them primary, without touching the token', async () => {
    const { id, token } = await placeholder()
    await addGuest(testDb, null, id, { firstName: 'Jordan', lastName: 'Reyes', email: 'j@example.com' })

    const invite = await getInvite(testDb, id)
    expect(invite?.guests).toHaveLength(1)
    expect(invite?.guests[0]).toMatchObject({ firstName: 'Jordan', isPrimary: true, email: 'j@example.com' })

    // The printed QR code still opens the same invite.
    const resolved = await resolveInviteByToken(testDb, token)
    expect(resolved?.id).toBe(id)
    expect(resolved?.guests[0]?.firstName).toBe('Jordan')
  })

  it('only the first guest becomes primary', async () => {
    const { id } = await placeholder(3)
    await addGuest(testDb, null, id, { firstName: 'A', lastName: 'One' })
    await addGuest(testDb, null, id, { firstName: 'B', lastName: 'Two' })
    const invite = await getInvite(testDb, id)
    expect(invite?.guests.map((g) => [g.firstName, g.isPrimary])).toEqual([['A', true], ['B', false]])
  })

  it('adds guests past the seat allotment: seats are a planning number only', async () => {
    const { id } = await placeholder(1)
    await addGuest(testDb, null, id, { firstName: 'A', lastName: 'One' })
    await addGuest(testDb, null, id, { firstName: 'B', lastName: 'Two' })
    expect((await getInvite(testDb, id))?.guests).toHaveLength(2)
  })

  it('stores a table on the new guest when given one', async () => {
    const { id } = await placeholder(1)
    await addGuest(testDb, null, id, { firstName: 'A', lastName: 'One', tableNumber: '14' })
    expect((await getInvite(testDb, id))?.guests[0]?.tableNumber).toBe('14')
  })

  it('writes an audit row', async () => {
    const { id } = await placeholder()
    await addGuest(testDb, null, id, { firstName: 'A', lastName: 'One' })
    expect(await testDb.auditLog.count({ where: { action: 'guest.add' } })).toBe(1)
  })
})

describe('updateGuest', () => {
  it('changes the name and contact details', async () => {
    const { invite } = await createInvite(testDb, null, {
      label: 'P', seatsAllotted: 1, primaryGuest: { firstName: 'Jordan', lastName: 'Reyes' },
    })
    const guest = (await getInvite(testDb, invite.id))!.guests[0]!
    await updateGuest(testDb, null, invite.id, guest.id, { firstName: 'Jordyn', lastName: 'Reyes', company: 'Acme', email: '' })
    const after = (await getInvite(testDb, invite.id))!.guests[0]
    expect(after).toMatchObject({ firstName: 'Jordyn', company: 'Acme', email: null, isPrimary: true })
  })

  it('sets and clears the guest table independently of the invite', async () => {
    const { invite } = await createInvite(testDb, null, {
      label: 'P', seatsAllotted: 1, tableNumber: '3', primaryGuest: { firstName: 'Jordan', lastName: 'Reyes' },
    })
    const guest = (await getInvite(testDb, invite.id))!.guests[0]!
    await updateGuest(testDb, null, invite.id, guest.id, { firstName: 'Jordan', lastName: 'Reyes', tableNumber: '9' })
    expect((await getInvite(testDb, invite.id))!.guests[0]?.tableNumber).toBe('9')

    await updateGuest(testDb, null, invite.id, guest.id, { firstName: 'Jordan', lastName: 'Reyes', tableNumber: '' })
    expect((await getInvite(testDb, invite.id))!.guests[0]?.tableNumber).toBeNull()
    expect((await getInvite(testDb, invite.id))!.tableNumber).toBe('3')
  })
})

describe('guest/invite agreement', () => {
  it("refuses to edit or remove a guest under a different invite's id", async () => {
    const { id: a } = await placeholder()
    await addGuest(testDb, null, a, { firstName: 'A', lastName: 'One' })
    const other = await createInvite(testDb, null, {
      label: 'Other', seatsAllotted: 1, primaryGuest: { firstName: 'B', lastName: 'Two' },
    })
    const guestA = (await getInvite(testDb, a))!.guests[0]!

    await expect(updateGuest(testDb, null, other.invite.id, guestA.id, { firstName: 'X', lastName: 'Y' }))
      .rejects.toBeInstanceOf(GuestNotOnInviteError)
    await expect(removeGuest(testDb, null, other.invite.id, guestA.id))
      .rejects.toBeInstanceOf(GuestNotOnInviteError)
    expect((await getInvite(testDb, a))?.guests[0]?.firstName).toBe('A')
  })
})

describe('removeGuest', () => {
  it('removes a guest and promotes the next one to primary', async () => {
    const { id } = await placeholder(3)
    await addGuest(testDb, null, id, { firstName: 'A', lastName: 'One' })
    await addGuest(testDb, null, id, { firstName: 'B', lastName: 'Two' })
    const first = (await getInvite(testDb, id))!.guests[0]!

    await removeGuest(testDb, null, id, first.id)

    const invite = await getInvite(testDb, id)
    expect(invite?.guests.map((g) => [g.firstName, g.isPrimary])).toEqual([['B', true]])
  })

  it('recomputes the invite status once the answering guest is gone', async () => {
    const { id } = await placeholder(2)
    await addGuest(testDb, null, id, { firstName: 'A', lastName: 'One' })
    const guest = (await getInvite(testDb, id))!.guests[0]!
    await testDb.guest.update({ where: { id: guest.id }, data: { attending: true } })
    await testDb.invite.update({ where: { id }, data: { status: 'ATTENDING' } })

    await removeGuest(testDb, null, id, guest.id)
    expect((await getInvite(testDb, id))?.status).toBe('PENDING')
  })

  it('never removes a guest who has already checked in', async () => {
    const { id } = await placeholder()
    await addGuest(testDb, null, id, { firstName: 'A', lastName: 'One' })
    const guest = (await getInvite(testDb, id))!.guests[0]!
    await testDb.guest.update({ where: { id: guest.id }, data: { checkedInAt: new Date() } })
    await expect(removeGuest(testDb, null, id, guest.id)).rejects.toBeInstanceOf(GuestCheckedInError)
    expect(await testDb.guest.count()).toBe(1)
  })
})
