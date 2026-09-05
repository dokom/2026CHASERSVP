import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { createPlaceholderInvites } from '@/lib/invites/placeholders'
import { createInvite, listInvites, listInviteTokens } from '@/lib/invites/repository'
import { commitInviteImport } from '@/lib/invites/import'
import { resolveInviteByToken } from '@/lib/guest/resolve'

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

describe('createPlaceholderInvites', () => {
  it('mints numbered, guest-less invites labelled by their padded number', async () => {
    const result = await createPlaceholderInvites(testDb, null, { count: 3, seatsAllotted: 2 })
    expect(result).toEqual({ created: 3, firstNumber: 1, lastNumber: 3 })

    const { rows } = await listInvites(testDb, {})
    expect(rows.map((r) => [r.number, r.label, r.seatsAllotted, r.guestCount])).toEqual([
      [1, '001', 2, 0], [2, '002', 2, 0], [3, '003', 2, 0],
    ])
  })

  it('continues numbering after the highest number already issued', async () => {
    await createPlaceholderInvites(testDb, null, { count: 2, seatsAllotted: 1 })
    await createInvite(testDb, null, {
      label: 'Hand-made', seatsAllotted: 1, primaryGuest: { firstName: 'A', lastName: 'B' },
    })
    const second = await createPlaceholderInvites(testDb, null, { count: 2, seatsAllotted: 1 })
    expect(second).toMatchObject({ firstNumber: 4, lastNumber: 5 })
  })

  it('leaves a gap when a placeholder in the middle of a run is deleted', async () => {
    await createPlaceholderInvites(testDb, null, { count: 3, seatsAllotted: 1 })
    await testDb.invite.deleteMany({ where: { number: 2 } })
    const next = await createPlaceholderInvites(testDb, null, { count: 1, seatsAllotted: 1 })
    // Card 002 may already be printed; the next batch continues after 003.
    expect(next.firstNumber).toBe(4)
  })

  it('pads the label to the width of the batch', async () => {
    await createPlaceholderInvites(testDb, null, { count: 1000, seatsAllotted: 1 })
    const first = await testDb.invite.findFirstOrThrow({ where: { number: 1 } })
    expect(first.label).toBe('0001')
  }, 120_000)

  it('gives every placeholder its own resolvable token', async () => {
    await createPlaceholderInvites(testDb, null, { count: 2, seatsAllotted: 1 })
    const tokens = await listInviteTokens(testDb)
    expect(tokens.map((t) => t.number)).toEqual([1, 2])
    expect(new Set(tokens.map((t) => t.token)).size).toBe(2)
    const resolved = await resolveInviteByToken(testDb, tokens[0]!.token)
    expect(resolved?.label).toBe('001')
    expect(resolved?.guests).toEqual([])
  })

  it('records one audit row for the whole batch', async () => {
    await createPlaceholderInvites(testDb, null, { count: 5, seatsAllotted: 1 })
    const audit = await testDb.auditLog.findMany({ where: { action: 'invite.createPlaceholders' } })
    expect(audit).toHaveLength(1)
    expect(audit[0]?.meta).toMatchObject({ count: 5, from: 1, to: 5 })
  })

  it('rejects an empty or oversized batch', async () => {
    await expect(createPlaceholderInvites(testDb, null, { count: 0, seatsAllotted: 1 })).rejects.toThrow()
    await expect(createPlaceholderInvites(testDb, null, { count: 2001, seatsAllotted: 1 })).rejects.toThrow()
    expect(await testDb.invite.count()).toBe(0)
  })
})

describe('invite numbering across the other creation paths', () => {
  it('numbers a single hand-made invite', async () => {
    const { invite } = await createInvite(testDb, null, {
      label: 'Reyes Party', seatsAllotted: 2, primaryGuest: { firstName: 'Jordan', lastName: 'Reyes' },
    })
    expect(invite.number).toBe(1)
  })

  it('numbers an imported batch consecutively after existing invites', async () => {
    await createPlaceholderInvites(testDb, null, { count: 2, seatsAllotted: 1 })
    await commitInviteImport(testDb, null, [
      { label: 'A', seatsAllotted: 1, tableNumber: '', adminNotes: '', primaryGuest: { firstName: 'A', lastName: 'A', email: '', company: '', title: '' } },
      { label: 'B', seatsAllotted: 1, tableNumber: '', adminNotes: '', primaryGuest: { firstName: 'B', lastName: 'B', email: '', company: '', title: '' } },
    ])
    const numbers = (await testDb.invite.findMany({ orderBy: { number: 'asc' }, select: { number: true, label: true } }))
    expect(numbers).toEqual([
      { number: 1, label: '001' }, { number: 2, label: '002' }, { number: 3, label: 'A' }, { number: 4, label: 'B' },
    ])
  })

  it('finds an invite by its printed number, padded or not', async () => {
    await createPlaceholderInvites(testDb, null, { count: 12, seatsAllotted: 1 })
    expect((await listInvites(testDb, { search: '007' })).rows.map((r) => r.number)).toEqual([7])
    expect((await listInvites(testDb, { search: '7' })).rows.map((r) => r.number)).toEqual([7])
  })
})
