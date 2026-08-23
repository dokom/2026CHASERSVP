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

  it('persists actorId and ip', async () => {
    const actor = await testDb.adminUser.create({
      data: { email: 'actor@example.com', name: 'Actor', passwordHash: 'x', role: 'ADMIN' },
    })
    await writeAudit(testDb, {
      actorId: actor.id, action: 'invite.create', entity: 'Invite', entityId: 'i1', ip: '10.0.0.5',
    })
    const row = await testDb.auditLog.findFirst()
    expect(row?.actorId).toBe(actor.id)
    expect(row?.ip).toBe('10.0.0.5')
  })

  it('redacts sensitive keys nested inside before/after diffs', async () => {
    await writeAudit(testDb, {
      actorId: null,
      action: 'invite.regenerateToken',
      entity: 'Invite',
      entityId: 'i1',
      meta: { before: { tokenHash: 'ab12' }, after: { token: 'PLAINTEXT_TOKEN', label: 'ok' } },
    })
    const row = await testDb.auditLog.findFirst()
    const meta = row?.meta as { before: { tokenHash: string }; after: { token: string; label: string } }
    expect(meta.before.tokenHash).toBe('[redacted]')
    expect(meta.after.token).toBe('[redacted]')
    expect(meta.after.label).toBe('ok')
  })

  it('redacts sensitive keys inside an array of objects', async () => {
    await writeAudit(testDb, {
      actorId: null,
      action: 'admin.bulkUpdate',
      entity: 'AdminUser',
      meta: { changes: [{ password: 'hunter2', email: 'a@example.com' }, { password: 'other' }] },
    })
    const row = await testDb.auditLog.findFirst()
    const meta = row?.meta as { changes: Array<{ password: string; email?: string }> }
    expect(meta.changes[0]?.password).toBe('[redacted]')
    expect(meta.changes[0]?.email).toBe('a@example.com')
    expect(meta.changes[1]?.password).toBe('[redacted]')
  })

  it('does not hang on a circular meta structure', async () => {
    const circular: Record<string, unknown> = { label: 'loop' }
    circular.self = circular
    await writeAudit(testDb, {
      actorId: null,
      action: 'test.circular',
      entity: 'Invite',
      meta: { nested: circular },
    })
    const row = await testDb.auditLog.findFirst()
    const meta = row?.meta as { nested: { label: string; self: string } }
    expect(meta.nested.label).toBe('loop')
    expect(meta.nested.self).toBe('[circular]')
  })

  it('truncates an oversized string value', async () => {
    const longValue = 'x'.repeat(5000)
    await writeAudit(testDb, {
      actorId: null, action: 'invite.create', entity: 'Invite', meta: { label: longValue },
    })
    const row = await testDb.auditLog.findFirst()
    const meta = row?.meta as { label: string }
    expect(meta.label.length).toBeLessThan(longValue.length)
    expect(meta.label).toMatch(/…\[truncated\]$/)
  })

  it('drops an oversized meta document entirely rather than throwing', async () => {
    const bigChanges = Array.from({ length: 50 }, (_, i) => ({
      key: `field${i}`, value: 'y'.repeat(3000),
    }))
    await writeAudit(testDb, {
      actorId: null, action: 'csv.import', entity: 'Invite', meta: { changes: bigChanges },
    })
    const row = await testDb.auditLog.findFirst()
    const meta = row?.meta as { _dropped: boolean }
    expect(meta._dropped).toBe(true)
  })

  it('writes a row when meta contains non-JSON-serializable values instead of throwing', async () => {
    const when = new Date('2026-01-15T12:00:00.000Z')
    await writeAudit(testDb, {
      actorId: null,
      action: 'test.nonSerializable',
      entity: 'Invite',
      meta: { count: 10n, when, fn: () => {}, sym: Symbol('x'), missing: undefined, label: 'ok' },
    })
    const row = await testDb.auditLog.findFirst()
    const meta = row?.meta as {
      count: string; when: string; fn: string; sym: string; missing: string; label: string
    }
    expect(meta.count).toBe('[bigint:10]')
    expect(meta.when).toBe(when.toISOString())
    expect(meta.fn).toBe('[function]')
    expect(meta.sym).toBe('[symbol]')
    expect(meta.missing).toBe('[undefined]')
    expect(meta.label).toBe('ok')
  })
})
