import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import {
  createSession, resolveSession, destroySession,
  purgeExpiredSessions, SESSION_COOKIE, SESSION_TTL_MS,
} from '@/lib/auth/session'
import { hashToken } from '@/lib/crypto/tokens'

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function makeUser() {
  return testDb.adminUser.create({
    data: { email: 'a@example.com', name: 'Ada', passwordHash: 'x', role: 'ADMIN' },
  })
}

describe('sessions', () => {
  it('names the cookie', () => {
    expect(SESSION_COOKIE).toBe('gala_admin_session')
  })

  it('creates a session resolvable by its token', async () => {
    const user = await makeUser()
    const { token } = await createSession(testDb, user.id, { ip: '1.1.1.1', userAgent: 'jest' })
    const resolved = await resolveSession(testDb, token)
    expect(resolved).toMatchObject({ id: user.id, email: 'a@example.com', role: 'ADMIN' })
  })

  it('stores only the hash of the session token', async () => {
    const user = await makeUser()
    const { token } = await createSession(testDb, user.id, {})
    const row = await testDb.adminSession.findFirst()
    expect(row?.tokenHash).toBe(hashToken(token))
    expect(row?.tokenHash).not.toBe(token)
  })

  it('sets expiry to the configured TTL', async () => {
    const user = await makeUser()
    const before = Date.now()
    const { expiresAt } = await createSession(testDb, user.id, {})
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + SESSION_TTL_MS - 1000)
  })

  it('returns null for an unknown token', async () => {
    expect(await resolveSession(testDb, 'nope')).toBeNull()
  })

  it('returns null for an expired session and deletes it', async () => {
    const user = await makeUser()
    const { token } = await createSession(testDb, user.id, {})
    await testDb.adminSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })
    expect(await resolveSession(testDb, token)).toBeNull()
    expect(await testDb.adminSession.count()).toBe(0)
  })

  it('returns null for a deactivated user', async () => {
    const user = await makeUser()
    const { token } = await createSession(testDb, user.id, {})
    await testDb.adminUser.update({ where: { id: user.id }, data: { isActive: false } })
    expect(await resolveSession(testDb, token)).toBeNull()
  })

  it('destroys a session', async () => {
    const user = await makeUser()
    const { token } = await createSession(testDb, user.id, {})
    await destroySession(testDb, token)
    expect(await resolveSession(testDb, token)).toBeNull()
  })

  it('purges only expired sessions', async () => {
    const user = await makeUser()
    await createSession(testDb, user.id, {})
    await testDb.adminSession.create({
      data: { tokenHash: 'old', userId: user.id, expiresAt: new Date(Date.now() - 1000) },
    })
    expect(await purgeExpiredSessions(testDb)).toBe(1)
    expect(await testDb.adminSession.count()).toBe(1)
  })
})
