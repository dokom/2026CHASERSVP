import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'

beforeEach(resetDb)
// resetDb again after the suite so the last test's data doesn't linger in the
// test database once the run ends (global constraint: tests must leave the
// test database clean, not just clean-before-next-run).
afterAll(async () => {
  await resetDb()
  await testDb.$disconnect()
})

describe('schema', () => {
  it('cascades guest deletion when its invite is deleted', async () => {
    const invite = await testDb.invite.create({
      data: {
        tokenHash: 'hash-1',
        tokenCipher: 'cipher-1',
        number: 1,
        label: 'Reyes Party',
        seatsAllotted: 2,
        guests: { create: { firstName: 'Jordan', lastName: 'Reyes', isPrimary: true } },
      },
    })
    await testDb.invite.delete({ where: { id: invite.id } })
    expect(await testDb.guest.count()).toBe(0)
  })

  it('rejects a duplicate invite token hash', async () => {
    await testDb.invite.create({ data: { tokenHash: 'dupe', tokenCipher: 'c1', number: 1, label: 'A' } })
    await expect(
      testDb.invite.create({ data: { tokenHash: 'dupe', tokenCipher: 'c2', number: 2, label: 'B' } }),
    ).rejects.toThrow()
  })

  it('preserves audit rows when the actor is deleted', async () => {
    const user = await testDb.adminUser.create({
      data: { email: 'a@example.com', name: 'A', passwordHash: 'x', role: 'ADMIN' },
    })
    await testDb.auditLog.create({
      data: { actorId: user.id, action: 'invite.create', entity: 'Invite', entityId: 'i1' },
    })
    await testDb.adminUser.delete({ where: { id: user.id } })
    const log = await testDb.auditLog.findFirst()
    expect(log?.actorId).toBeNull()
    expect(log?.action).toBe('invite.create')
  })

  it('defaults an invite to PENDING with no extra seats', async () => {
    const invite = await testDb.invite.create({
      data: { tokenHash: 'h2', tokenCipher: 'c3', number: 3, label: 'C' },
    })
    expect(invite.status).toBe('PENDING')
    expect(invite.extraSeatsStatus).toBe('NONE')
    expect(invite.seatsAllotted).toBe(1)
  })
})
