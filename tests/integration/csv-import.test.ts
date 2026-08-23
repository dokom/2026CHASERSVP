import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { commitInviteImport, existingEmails, MAX_IMPORT_ROWS } from '@/lib/invites/import'
import { listInviteTokens } from '@/lib/invites/repository'
import { parseInviteCsv } from '@/lib/invites/csv'

const HEADER = 'label,seatsAllotted,tableNumber,primaryFirstName,primaryLastName,primaryEmail,primaryCompany,primaryTitle,adminNotes'

function rowsFrom(csv: string) {
  return parseInviteCsv(csv).rows.map((r) => r.data!).filter(Boolean)
}

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

describe('commitInviteImport', () => {
  it('creates one invite and one primary guest per row', async () => {
    const rows = rowsFrom(`${HEADER}\nA Party,2,,Ada,Okafor,ada@example.com,,,\nB Party,1,,Sam,Reyes,,,,`)
    const result = await commitInviteImport(testDb, null, rows)
    expect(result.created).toBe(2)
    expect(await testDb.invite.count()).toBe(2)
    expect(await testDb.guest.count()).toBe(2)
    expect(await testDb.guest.count({ where: { isPrimary: true } })).toBe(2)
  })

  it('gives every invite a distinct token hash', async () => {
    const rows = rowsFrom(`${HEADER}\nA,1,,Ada,Okafor,,,,\nB,1,,Sam,Reyes,,,,`)
    await commitInviteImport(testDb, null, rows)
    const invites = await testDb.invite.findMany({ select: { tokenHash: true } })
    expect(new Set(invites.map((i) => i.tokenHash)).size).toBe(2)
  })

  it('stores a recoverable token cipher for every imported invite', async () => {
    const rows = rowsFrom(`${HEADER}
A,1,,Ada,Okafor,,,,
B,1,,Sam,Reyes,,,,`)
    await commitInviteImport(testDb, null, rows)
    const tokens = await listInviteTokens(testDb)
    expect(tokens).toHaveLength(2)
    expect(tokens.every((t) => /^[A-Za-z0-9_-]{32}$/.test(t.token))).toBe(true)
  })

  it('skips rows whose email already exists in the database', async () => {
    await commitInviteImport(testDb, null, rowsFrom(`${HEADER}\nA,1,,Ada,Okafor,ada@example.com,,,`))
    const result = await commitInviteImport(
      testDb, null,
      rowsFrom(`${HEADER}\nDuplicate,1,,Ada,Okafor,ada@example.com,,,\nNew,1,,Sam,Reyes,sam@example.com,,,`),
    )
    expect(result.created).toBe(1)
    expect(result.skippedExistingEmails).toEqual(['ada@example.com'])
    expect(await testDb.invite.count()).toBe(2)
  })

  it('rolls back entirely when any insert fails', async () => {
    const rows = rowsFrom(`${HEADER}\nA,1,,Ada,Okafor,,,,`)
    // MongoDB has no column length limit, so an oversized string would NOT fail here.
    // A wrongly-typed seat count makes Prisma reject the second insert mid-transaction,
    // which is what this test needs in order to prove the first insert is rolled back.
    const bad = [...rows, { ...rows[0]!, seatsAllotted: 'not-a-number' as unknown as number }]
    await expect(commitInviteImport(testDb, null, bad)).rejects.toThrow()
    expect(await testDb.invite.count()).toBe(0)
  })

  it('writes a single audit row summarizing the import', async () => {
    await commitInviteImport(testDb, null, rowsFrom(`${HEADER}\nA,1,,Ada,Okafor,,,,\nB,1,,Sam,Reyes,,,,`))
    const logs = await testDb.auditLog.findMany({ where: { action: 'invite.import' } })
    expect(logs).toHaveLength(1)
    expect((logs[0]?.meta as Record<string, unknown>).created).toBe(2)
  })

  it('accepts an empty row list without writing anything', async () => {
    const result = await commitInviteImport(testDb, null, [])
    expect(result.created).toBe(0)
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
})
