import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { commitInviteImport, existingEmails, MAX_IMPORT_ROWS } from '@/lib/invites/import'
import { listInviteTokens } from '@/lib/invites/repository'
import { parseInviteCsv } from '@/lib/invites/csv'
import { createPlaceholderInvites } from '@/lib/invites/placeholders'
import { planImport } from '@/lib/invites/import-plan'
import { createInvite } from '@/lib/invites/repository'

const HEADER = 'label,seatsAllotted,tableNumber,primaryFirstName,primaryLastName,primaryEmail,primaryCompany,primaryTitle,adminNotes'

function rowsFrom(csv: string) {
  return parseInviteCsv(csv).rows.map((r) => r.data!).filter(Boolean)
}

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

describe('planImport', () => {
  it('creates when nothing matches', async () => {
    const [plan] = await planImport(testDb, rowsFrom(`${HEADER}\nNew Party,1,,Ada,Okafor,,,,`))
    expect(plan?.plan).toEqual({ action: 'create' })
  })

  it('updates the single invite whose label matches', async () => {
    const { invite } = await createInvite(testDb, null, {
      label: 'Reyes Party', seatsAllotted: 1, primaryGuest: { firstName: 'J', lastName: 'R' },
    })
    const primary = await testDb.guest.findFirstOrThrow({ where: { inviteId: invite.id } })
    const [plan] = await planImport(testDb, rowsFrom(`${HEADER}\nReyes Party,2,,Jordan,Reyes,,,,`))
    expect(plan?.plan).toEqual({ action: 'update', inviteId: invite.id, primaryGuestId: primary.id })
  })

  it('falls back to the printed number when the label is a bare integer', async () => {
    await createPlaceholderInvites(testDb, null, { count: 3, seatsAllotted: 1 })
    await testDb.invite.update({ where: { number: 2 }, data: { label: 'Already Renamed' } })
    const [plan] = await planImport(testDb, rowsFrom(`${HEADER}\n2,1,,Ada,Okafor,,,,`))
    const two = await testDb.invite.findUniqueOrThrow({ where: { number: 2 } })
    expect(plan?.plan).toEqual({ action: 'update', inviteId: two.id, primaryGuestId: null })
  })

  it('prefers an exact label match over the number fallback', async () => {
    await createPlaceholderInvites(testDb, null, { count: 3, seatsAllotted: 1 })
    // Card 2 has been renamed, and card 3 was (confusingly) labelled "002":
    // the label wins over the printed number.
    await testDb.invite.update({ where: { number: 2 }, data: { label: 'Renamed Party' } })
    await testDb.invite.update({ where: { number: 3 }, data: { label: '002' } })
    const [plan] = await planImport(testDb, rowsFrom(`${HEADER}\n002,1,,Ada,Okafor,,,,`))
    const three = await testDb.invite.findUniqueOrThrow({ where: { number: 3 } })
    expect(plan?.plan).toMatchObject({ action: 'update', inviteId: three.id })
  })

  it('skips a label shared by several invites', async () => {
    for (let i = 0; i < 2; i++) {
      await createInvite(testDb, null, { label: 'Twins', seatsAllotted: 1, primaryGuest: { firstName: 'A', lastName: String(i) } })
    }
    const [plan] = await planImport(testDb, rowsFrom(`${HEADER}\nTwins,1,,Ada,Okafor,,,,`))
    expect(plan?.plan).toEqual({ action: 'skip', reason: 'label matches several invites' })
  })

  it('skips a create whose email already exists, but not an update carrying its own email', async () => {
    await createInvite(testDb, null, {
      label: 'Reyes Party', seatsAllotted: 1,
      primaryGuest: { firstName: 'J', lastName: 'R', email: 'jordan@example.com' },
    })
    const rows = [
      ...rowsFrom(`${HEADER}\nReyes Party,1,,Jordan,Reyes,jordan@example.com,,,`),
      ...rowsFrom(`${HEADER}\nOther,1,,Dup,Licate,jordan@example.com,,,`),
    ]
    const plans = await planImport(testDb, rows)
    expect(plans[0]?.plan).toMatchObject({ action: 'update' })
    expect(plans[1]?.plan).toEqual({ action: 'skip', reason: 'email already exists' })
  })

  it('lets only the first of two rows that resolve to the same invite update it', async () => {
    await createPlaceholderInvites(testDb, null, { count: 2, seatsAllotted: 1 })
    const plans = await planImport(testDb, [
      ...rowsFrom(`${HEADER}\n2,1,,Ada,Okafor,,,,`),
      ...rowsFrom(`${HEADER}\n002,1,,Sam,Reyes,,,,`),
    ])
    expect(plans[0]?.plan).toMatchObject({ action: 'update' })
    expect(plans[1]?.plan).toEqual({ action: 'skip', reason: 'same invite as an earlier row' })
  })
})

describe('commitInviteImport', () => {
  it('creates one invite and one primary guest per unmatched row', async () => {
    const rows = rowsFrom(`${HEADER}\nA Party,2,,Ada,Okafor,ada@example.com,,,\nB Party,1,,Sam,Reyes,,,,`)
    const result = await commitInviteImport(testDb, null, rows)
    expect(result).toEqual({ created: 2, updated: 0, skipped: [] })
    expect(await testDb.invite.count()).toBe(2)
    expect(await testDb.guest.count()).toBe(2)
    expect(await testDb.guest.count({ where: { isPrimary: true } })).toBe(2)
  })

  it('fills in a placeholder run by label, keeping every token and number', async () => {
    await createPlaceholderInvites(testDb, null, { count: 3, seatsAllotted: 1 })
    const before = await listInviteTokens(testDb)

    const result = await commitInviteImport(testDb, null, rowsFrom(
      `${HEADER}\n001,2,12,Ada,Okafor,ada@example.com,Acme,CEO,VIP\n003,1,,Sam,Reyes,,,,`,
    ))

    expect(result).toEqual({ created: 0, updated: 2, skipped: [] })
    expect(await testDb.invite.count()).toBe(3)
    const after = await listInviteTokens(testDb)
    expect(after.map((r) => r.token)).toEqual(before.map((r) => r.token))
    expect(after.map((r) => r.number)).toEqual([1, 2, 3])

    const one = await testDb.invite.findUniqueOrThrow({ where: { number: 1 }, include: { guests: true } })
    expect(one).toMatchObject({ label: '001', seatsAllotted: 2, tableNumber: '12', adminNotes: 'VIP' })
    expect(one.guests).toHaveLength(1)
    expect(one.guests[0]).toMatchObject({ firstName: 'Ada', lastName: 'Okafor', email: 'ada@example.com', company: 'Acme', title: 'CEO', isPrimary: true })
    const two = await testDb.invite.findUniqueOrThrow({ where: { number: 2 }, include: { guests: true } })
    expect(two.guests).toHaveLength(0)
  })

  it('updates an existing primary guest in place and leaves the rest of the party alone', async () => {
    const { invite } = await createInvite(testDb, null, {
      label: 'Reyes Party', seatsAllotted: 2, tableNumber: '4',
      primaryGuest: { firstName: 'J', lastName: 'R', email: 'old@example.com' },
    })
    const sam = await testDb.guest.create({ data: { inviteId: invite.id, firstName: 'Sam', lastName: 'Reyes', attending: true, checkedInAt: new Date() } })
    await testDb.guest.updateMany({ where: { inviteId: invite.id, isPrimary: true }, data: { attending: true } })
    await testDb.invite.update({ where: { id: invite.id }, data: { status: 'ATTENDING', respondedAt: new Date('2026-09-01T00:00:00Z') } })

    await commitInviteImport(testDb, null, rowsFrom(`${HEADER}\nReyes Party,3,,Jordan,Reyes,new@example.com,Northwind,,`))

    const fresh = await testDb.invite.findUniqueOrThrow({ where: { id: invite.id }, include: { guests: { orderBy: { isPrimary: 'desc' } } } })
    expect(fresh).toMatchObject({ seatsAllotted: 3, tableNumber: null, status: 'ATTENDING' })
    expect(fresh.respondedAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(fresh.guests).toHaveLength(2)
    expect(fresh.guests[0]).toMatchObject({ firstName: 'Jordan', email: 'new@example.com', company: 'Northwind', attending: true, isPrimary: true })
    expect(fresh.guests[1]?.id).toBe(sam.id)
    expect(fresh.guests[1]?.checkedInAt).not.toBeNull()
  })

  it('renames an invite matched by number', async () => {
    await createPlaceholderInvites(testDb, null, { count: 1, seatsAllotted: 1 })
    await testDb.invite.update({ where: { number: 1 }, data: { label: 'Old Name' } })
    await commitInviteImport(testDb, null, rowsFrom(`${HEADER}\n1,1,,Ada,Okafor,,,,`))
    expect((await testDb.invite.findUniqueOrThrow({ where: { number: 1 } })).label).toBe('1')
  })

  it('reports skipped rows with their reason and still commits the rest', async () => {
    await createInvite(testDb, null, { label: 'A', seatsAllotted: 1, primaryGuest: { firstName: 'A', lastName: 'A', email: 'a@example.com' } })
    const result = await commitInviteImport(testDb, null, rowsFrom(
      `${HEADER}\nDuplicate,1,,Ada,Okafor,a@example.com,,,\nNew,1,,Sam,Reyes,sam@example.com,,,`,
    ))
    expect(result).toEqual({ created: 1, updated: 0, skipped: [{ label: 'Duplicate', reason: 'email already exists' }] })
    expect(await testDb.invite.count()).toBe(2)
  })

  it('gives every created invite a distinct, recoverable token', async () => {
    await commitInviteImport(testDb, null, rowsFrom(`${HEADER}\nA,1,,Ada,Okafor,,,,\nB,1,,Sam,Reyes,,,,`))
    const tokens = await listInviteTokens(testDb)
    expect(new Set(tokens.map((t) => t.token)).size).toBe(2)
    expect(tokens.every((t) => /^[A-Za-z0-9_-]{32}$/.test(t.token))).toBe(true)
  })

  it('rolls back entirely when any write fails', async () => {
    const rows = rowsFrom(`${HEADER}\nA,1,,Ada,Okafor,,,,`)
    const bad = [...rows, { ...rows[0]!, label: 'B', seatsAllotted: 'not-a-number' as unknown as number }]
    await expect(commitInviteImport(testDb, null, bad)).rejects.toThrow()
    expect(await testDb.invite.count()).toBe(0)
  })

  it('writes a single audit row with all three counts', async () => {
    await createPlaceholderInvites(testDb, null, { count: 1, seatsAllotted: 1 })
    await commitInviteImport(testDb, null, rowsFrom(`${HEADER}\n001,1,,Ada,Okafor,,,,\nB,1,,Sam,Reyes,,,,`))
    const logs = await testDb.auditLog.findMany({ where: { action: 'invite.import' } })
    expect(logs).toHaveLength(1)
    expect(logs[0]?.meta).toMatchObject({ created: 1, updated: 1, skipped: 0 })
  })

  it('accepts an empty row list without writing anything', async () => {
    expect(await commitInviteImport(testDb, null, [])).toEqual({ created: 0, updated: 0, skipped: [] })
    expect(await testDb.auditLog.count()).toBe(0)
  })

  it('rejects more rows than the cap', async () => {
    const one = rowsFrom(`${HEADER}\nA,1,,Ada,Okafor,,,,`)[0]!
    const tooMany = Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => one)
    await expect(commitInviteImport(testDb, null, tooMany)).rejects.toThrow(/at most/i)
  })

  it('reports which emails already exist', async () => {
    await commitInviteImport(testDb, null, rowsFrom(`${HEADER}\nA,1,,Ada,Okafor,ada@example.com,,,`))
    const found = await existingEmails(testDb, ['ada@example.com', 'nobody@example.com'])
    expect([...found]).toEqual(['ada@example.com'])
  })

  it('never gives one invite two primary guests when two rows alias it', async () => {
    await createPlaceholderInvites(testDb, null, { count: 2, seatsAllotted: 1 })
    const result = await commitInviteImport(testDb, null, [
      ...rowsFrom(`${HEADER}\n2,1,,Ada,Okafor,,,,`),
      ...rowsFrom(`${HEADER}\n002,1,,Sam,Reyes,,,,`),
    ])
    expect(result).toEqual({ created: 0, updated: 1, skipped: [{ label: '002', reason: 'same invite as an earlier row' }] })
    const two = await testDb.invite.findUniqueOrThrow({ where: { number: 2 }, include: { guests: true } })
    expect(two.guests).toHaveLength(1)
    expect(two.guests[0]).toMatchObject({ firstName: 'Ada', isPrimary: true })
  })
})
