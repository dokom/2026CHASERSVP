import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import {
  listAdminUsers, createAdminUser, updateAdminRole, setAdminActive,
  resetAdminPassword, LastOwnerError, DuplicateEmailError,
} from '@/lib/admin-users/repository'
import { verifyPassword } from '@/lib/crypto/password'

const PASSWORD = 'correct horse battery'

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function seedOwner() {
  return createAdminUser(testDb, null, {
    email: 'owner@example.com', name: 'Owner', role: 'OWNER', password: PASSWORD,
  })
}

describe('admin user repository', () => {
  it('creates a user and normalizes the email', async () => {
    const user = await createAdminUser(testDb, null, {
      email: 'Ada@Example.COM', name: 'Ada', role: 'ADMIN', password: PASSWORD,
    })
    expect(user.email).toBe('ada@example.com')
  })

  it('never returns the password hash', async () => {
    const user = await createAdminUser(testDb, null, {
      email: 'ada@example.com', name: 'Ada', role: 'ADMIN', password: PASSWORD,
    })
    expect(user).not.toHaveProperty('passwordHash')
  })

  it('stores a verifiable hash', async () => {
    await createAdminUser(testDb, null, {
      email: 'ada@example.com', name: 'Ada', role: 'ADMIN', password: PASSWORD,
    })
    const row = await testDb.adminUser.findUniqueOrThrow({ where: { email: 'ada@example.com' } })
    expect(await verifyPassword(row.passwordHash, PASSWORD)).toBe(true)
  })

  it('rejects a duplicate email', async () => {
    await createAdminUser(testDb, null, {
      email: 'ada@example.com', name: 'Ada', role: 'ADMIN', password: PASSWORD,
    })
    await expect(
      createAdminUser(testDb, null, {
        email: 'ADA@example.com', name: 'Other', role: 'STAFF', password: PASSWORD,
      }),
    ).rejects.toBeInstanceOf(DuplicateEmailError)
  })

  it('lists users newest first', async () => {
    await seedOwner()
    await createAdminUser(testDb, null, {
      email: 'ada@example.com', name: 'Ada', role: 'ADMIN', password: PASSWORD,
    })
    const list = await listAdminUsers(testDb)
    expect(list.map((u) => u.email)).toEqual(['ada@example.com', 'owner@example.com'])
  })

  it('refuses to demote the last owner', async () => {
    const owner = await seedOwner()
    await expect(updateAdminRole(testDb, owner.id, owner.id, 'ADMIN'))
      .rejects.toBeInstanceOf(LastOwnerError)
  })

  it('refuses to deactivate the last owner', async () => {
    const owner = await seedOwner()
    await expect(setAdminActive(testDb, owner.id, owner.id, false))
      .rejects.toBeInstanceOf(LastOwnerError)
  })

  it('allows demoting an owner when another active owner exists', async () => {
    const first = await seedOwner()
    const second = await createAdminUser(testDb, first.id, {
      email: 'two@example.com', name: 'Two', role: 'OWNER', password: PASSWORD,
    })
    await updateAdminRole(testDb, first.id, second.id, 'ADMIN')
    const row = await testDb.adminUser.findUniqueOrThrow({ where: { id: second.id } })
    expect(row.role).toBe('ADMIN')
  })

  it('does not count an inactive owner as a remaining owner', async () => {
    const first = await seedOwner()
    const second = await createAdminUser(testDb, first.id, {
      email: 'two@example.com', name: 'Two', role: 'OWNER', password: PASSWORD,
    })
    await setAdminActive(testDb, first.id, second.id, false)
    await expect(updateAdminRole(testDb, first.id, first.id, 'ADMIN'))
      .rejects.toBeInstanceOf(LastOwnerError)
  })

  it('revokes sessions when a user is deactivated', async () => {
    const owner = await seedOwner()
    const ada = await createAdminUser(testDb, owner.id, {
      email: 'ada@example.com', name: 'Ada', role: 'ADMIN', password: PASSWORD,
    })
    await testDb.adminSession.create({
      data: { tokenHash: 'h', userId: ada.id, expiresAt: new Date(Date.now() + 60_000) },
    })
    await setAdminActive(testDb, owner.id, ada.id, false)
    expect(await testDb.adminSession.count({ where: { userId: ada.id } })).toBe(0)
  })

  it('resets a password, forces a change, and revokes sessions', async () => {
    const owner = await seedOwner()
    const ada = await createAdminUser(testDb, owner.id, {
      email: 'ada@example.com', name: 'Ada', role: 'ADMIN', password: PASSWORD,
    })
    await testDb.adminSession.create({
      data: { tokenHash: 'h2', userId: ada.id, expiresAt: new Date(Date.now() + 60_000) },
    })
    await resetAdminPassword(testDb, owner.id, ada.id, 'brand new password')
    const row = await testDb.adminUser.findUniqueOrThrow({ where: { id: ada.id } })
    expect(await verifyPassword(row.passwordHash, 'brand new password')).toBe(true)
    expect(row.mustChangePassword).toBe(true)
    expect(await testDb.adminSession.count({ where: { userId: ada.id } })).toBe(0)
  })

  it('audits every mutation', async () => {
    const owner = await seedOwner()
    const ada = await createAdminUser(testDb, owner.id, {
      email: 'ada@example.com', name: 'Ada', role: 'ADMIN', password: PASSWORD,
    })
    await updateAdminRole(testDb, owner.id, ada.id, 'STAFF')
    await setAdminActive(testDb, owner.id, ada.id, false)
    const actions = (await testDb.auditLog.findMany({ orderBy: { createdAt: 'asc' } }))
      .map((l) => l.action)
    expect(actions).toContain('adminUser.create')
    expect(actions).toContain('adminUser.updateRole')
    expect(actions).toContain('adminUser.setActive')
  })

  it('never writes a password into audit meta', async () => {
    const owner = await seedOwner()
    await createAdminUser(testDb, owner.id, {
      email: 'ada@example.com', name: 'Ada', role: 'ADMIN', password: PASSWORD,
    })
    const logs = await testDb.auditLog.findMany()
    expect(JSON.stringify(logs)).not.toContain(PASSWORD)
  })

  // C1: activeOwnersExcluding used to be a plain read inside the
  // transaction. MongoDB's snapshot isolation only detects write conflicts
  // on documents BOTH transactions write, so two concurrent demotions of
  // two *different* owners could each read "one other active owner still
  // exists", both proceed, and both commit — leaving zero active owners
  // with no recovery path. This test fires both demotions genuinely
  // concurrently (Promise.allSettled, no await between the two calls) and
  // asserts at least one active OWNER survives. It fails against the
  // read-only guard and must pass once the guard is a write that MongoDB's
  // conflict detector can see.
  it('never lets two concurrent demotions strand the account with zero active owners', async () => {
    const first = await seedOwner()
    const second = await createAdminUser(testDb, first.id, {
      email: 'two@example.com', name: 'Two', role: 'OWNER', password: PASSWORD,
    })

    const results = await Promise.allSettled([
      updateAdminRole(testDb, first.id, first.id, 'ADMIN'),
      updateAdminRole(testDb, first.id, second.id, 'ADMIN'),
    ])

    // At least one side must have been rejected (either with LastOwnerError
    // or a write-conflict error) — both are acceptable outcomes as long as
    // the invariant below holds. What must never happen is both succeeding.
    void results
    const remainingOwners = await testDb.adminUser.count({ where: { role: 'OWNER', isActive: true } })
    expect(remainingOwners).toBeGreaterThanOrEqual(1)
  })
})
