import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { attemptLogin } from '@/lib/auth/login'
import { hashPassword } from '@/lib/crypto/password'
import { resolveSession } from '@/lib/auth/session'
import { MAX_ATTEMPTS } from '@/lib/auth/rate-limit'

const PASSWORD = 'correct horse battery'

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function seedUser(overrides: Record<string, unknown> = {}) {
  return testDb.adminUser.create({
    data: {
      email: 'ada@example.com',
      name: 'Ada',
      passwordHash: await hashPassword(PASSWORD),
      role: 'ADMIN',
      ...overrides,
    },
  })
}

describe('attemptLogin', () => {
  it('succeeds with correct credentials and returns a usable session', async () => {
    const user = await seedUser()
    const result = await attemptLogin(testDb, { email: 'ada@example.com', password: PASSWORD }, {})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.user.id).toBe(user.id)
    expect(await resolveSession(testDb, result.token)).toMatchObject({ id: user.id })
  })

  it('matches email case-insensitively', async () => {
    await seedUser()
    const result = await attemptLogin(testDb, { email: 'ADA@Example.com', password: PASSWORD }, {})
    expect(result.ok).toBe(true)
  })

  it('rejects a wrong password', async () => {
    await seedUser()
    const result = await attemptLogin(testDb, { email: 'ada@example.com', password: 'nope-nope-nope' }, {})
    expect(result).toEqual({ ok: false, reason: 'INVALID' })
  })

  it('reports INVALID — not a distinct reason — for an unknown email', async () => {
    const result = await attemptLogin(testDb, { email: 'ghost@example.com', password: PASSWORD }, {})
    expect(result).toEqual({ ok: false, reason: 'INVALID' })
  })

  it('rejects a deactivated user', async () => {
    await seedUser({ isActive: false })
    const result = await attemptLogin(testDb, { email: 'ada@example.com', password: PASSWORD }, {})
    expect(result).toEqual({ ok: false, reason: 'INACTIVE' })
  })

  it('locks out after too many failures', async () => {
    await seedUser()
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await attemptLogin(testDb, { email: 'ada@example.com', password: 'wrong-wrong-wrong' }, {})
    }
    const result = await attemptLogin(testDb, { email: 'ada@example.com', password: PASSWORD }, {})
    expect(result).toEqual({ ok: false, reason: 'LOCKED_OUT' })
  })

  it('clears the failure counter on success', async () => {
    await seedUser()
    await attemptLogin(testDb, { email: 'ada@example.com', password: 'wrong-wrong-wrong' }, {})
    await attemptLogin(testDb, { email: 'ada@example.com', password: PASSWORD }, {})
    const failures = await testDb.loginAttempt.count({ where: { succeeded: false } })
    expect(failures).toBe(0)
  })

  it('stamps lastLoginAt and audits the login', async () => {
    const user = await seedUser()
    await attemptLogin(testDb, { email: 'ada@example.com', password: PASSWORD }, { ip: '9.9.9.9' })
    const fresh = await testDb.adminUser.findUniqueOrThrow({ where: { id: user.id } })
    expect(fresh.lastLoginAt).not.toBeNull()
    const log = await testDb.auditLog.findFirst({ where: { action: 'auth.login' } })
    expect(log?.actorId).toBe(user.id)
  })

  it('never writes the password into the audit meta', async () => {
    await seedUser()
    await attemptLogin(testDb, { email: 'ada@example.com', password: PASSWORD }, {})
    const logs = await testDb.auditLog.findMany()
    expect(JSON.stringify(logs)).not.toContain(PASSWORD)
  })
})
