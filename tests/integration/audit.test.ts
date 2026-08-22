import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { writeAudit } from '@/lib/audit'

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

describe('writeAudit', () => {
  it('writes a row', async () => {
    await writeAudit(testDb, {
      actorId: null, action: 'invite.create', entity: 'Invite', entityId: 'i1',
    })
    const row = await testDb.auditLog.findFirst()
    expect(row).toMatchObject({ action: 'invite.create', entity: 'Invite', entityId: 'i1' })
  })

  it('redacts sensitive keys from meta', async () => {
    await writeAudit(testDb, {
      actorId: null,
      action: 'invite.regenerateToken',
      entity: 'Invite',
      entityId: 'i1',
      meta: { token: 'super-secret', label: 'Reyes Party', passwordHash: 'x' },
    })
    const row = await testDb.auditLog.findFirst()
    const meta = row?.meta as Record<string, unknown>
    expect(meta.token).toBe('[redacted]')
    expect(meta.passwordHash).toBe('[redacted]')
    expect(meta.label).toBe('Reyes Party')
  })

  it('rolls back with its transaction', async () => {
    await expect(
      testDb.$transaction(async (tx) => {
        await writeAudit(tx, { actorId: null, action: 'invite.create', entity: 'Invite' })
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await testDb.auditLog.count()).toBe(0)
  })

  it('accepts a null entityId', async () => {
    await writeAudit(testDb, { actorId: null, action: 'csv.import', entity: 'Invite' })
    const row = await testDb.auditLog.findFirst()
    expect(row?.entityId).toBeNull()
  })
})
