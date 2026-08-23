import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { listAudit, distinctEntities } from '@/lib/audit-log/query'

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

const day1 = new Date('2026-08-18T10:00:00.000Z')
const day2 = new Date('2026-08-19T10:00:00.000Z')
const day3 = new Date('2026-08-20T10:00:00.000Z')
const day4 = new Date('2026-08-21T10:00:00.000Z')

async function seed() {
  const userA = await testDb.adminUser.create({
    data: { email: 'a@example.com', name: 'Alice Owner', passwordHash: 'x', role: 'OWNER' },
  })
  const userB = await testDb.adminUser.create({
    data: { email: 'b@example.com', name: 'Bea Admin', passwordHash: 'x', role: 'ADMIN' },
  })
  const userC = await testDb.adminUser.create({
    data: { email: 'c@example.com', name: 'Cy Staff', passwordHash: 'x', role: 'STAFF' },
  })

  const rows = await Promise.all([
    testDb.auditLog.create({
      data: {
        actorId: userA.id, action: 'invite.create', entity: 'Invite', entityId: 'i1',
        meta: { label: 'Reyes' }, createdAt: day1,
      },
    }),
    testDb.auditLog.create({
      data: {
        actorId: userA.id, action: 'invite.update', entity: 'Invite', entityId: 'i1',
        meta: { label: 'Reyes Party' }, createdAt: day2,
      },
    }),
    testDb.auditLog.create({
      data: {
        actorId: userB.id, action: 'adminUser.create', entity: 'AdminUser', entityId: 'u1',
        createdAt: day2,
      },
    }),
    testDb.auditLog.create({
      data: {
        actorId: null, action: 'guest.checkin', entity: 'Guest', entityId: 'g1',
        createdAt: day3,
      },
    }),
    testDb.auditLog.create({
      data: {
        actorId: userB.id, action: 'guest.checkin', entity: 'Guest', entityId: 'g2',
        createdAt: day3,
      },
    }),
    testDb.auditLog.create({
      data: {
        actorId: userA.id, action: 'invite.delete', entity: 'Invite', entityId: 'i2',
        createdAt: day4,
      },
    }),
    testDb.auditLog.create({
      data: {
        actorId: null, action: 'adminUser.setActive', entity: 'AdminUser', entityId: 'u2',
        createdAt: day4,
      },
    }),
    testDb.auditLog.create({
      data: {
        actorId: userC.id, action: 'invite.create', entity: 'Invite', entityId: 'i3',
        createdAt: day4,
      },
    }),
  ])

  await testDb.adminUser.delete({ where: { id: userC.id } })

  return { userA, userB, userC, rows }
}

describe('audit query', () => {
  it('orders rows newest first', async () => {
    await seed()
    const { rows } = await listAudit(testDb, { page: 1, pageSize: 50 })
    expect(rows).toHaveLength(8)
    const times = rows.map((r) => r.createdAt.getTime())
    expect(times).toEqual([...times].sort((a, b) => b - a))
  })

  it('filters by actorId', async () => {
    const { userA } = await seed()
    const { rows, total } = await listAudit(testDb, { actorId: userA.id, page: 1, pageSize: 50 })
    expect(total).toBe(3)
    expect(rows.every((r) => r.actor?.email === 'a@example.com')).toBe(true)
  })

  it('filters by entity', async () => {
    await seed()
    const { total } = await listAudit(testDb, { entity: 'Guest', page: 1, pageSize: 50 })
    expect(total).toBe(2)
  })

  it('filters by action prefix', async () => {
    await seed()
    const { rows, total } = await listAudit(testDb, { action: 'invite.', page: 1, pageSize: 50 })
    expect(total).toBe(4)
    expect(rows.every((r) => r.action.startsWith('invite.'))).toBe(true)
  })

  it('filters from/to inclusive of the day', async () => {
    await seed()
    const { total } = await listAudit(testDb, { from: day2, to: day3, page: 1, pageSize: 50 })
    // day2 (2 rows) + day3 (2 rows) = 4; excludes day1 and day4.
    expect(total).toBe(4)
  })

  it('keeps total stable across pages', async () => {
    await seed()
    const page1 = await listAudit(testDb, { page: 1, pageSize: 3 })
    const page2 = await listAudit(testDb, { page: 2, pageSize: 3 })
    expect(page1.total).toBe(8)
    expect(page2.total).toBe(8)
    expect(page1.rows).toHaveLength(3)
    expect(page2.rows).toHaveLength(3)
  })

  it('renders a deleted actor as null', async () => {
    await seed()
    const { rows } = await listAudit(testDb, { entity: 'Invite', page: 1, pageSize: 50 })
    const deletedActorRow = rows.find((r) => r.entityId === 'i3')
    expect(deletedActorRow?.actor).toBeNull()
  })

  it('sorts distinct entities', async () => {
    await seed()
    expect(await distinctEntities(testDb)).toEqual(['AdminUser', 'Guest', 'Invite'])
  })
})
