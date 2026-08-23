import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import {
  recordLoginAttempt, isLockedOut, clearAttempts, MAX_ATTEMPTS, WINDOW_MS,
} from '@/lib/auth/rate-limit'

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

async function fail(times: number, email = 'a@example.com') {
  for (let i = 0; i < times; i++) {
    await recordLoginAttempt(testDb, { email, succeeded: false, ip: '1.1.1.1' })
  }
}

describe('login rate limiting', () => {
  it('allows a fresh email', async () => {
    expect(await isLockedOut(testDb, 'a@example.com')).toBe(false)
  })

  it('allows up to the limit minus one', async () => {
    await fail(MAX_ATTEMPTS - 1)
    expect(await isLockedOut(testDb, 'a@example.com')).toBe(false)
  })

  it('locks out at the limit', async () => {
    await fail(MAX_ATTEMPTS)
    expect(await isLockedOut(testDb, 'a@example.com')).toBe(true)
  })

  it('scopes lockout to one email', async () => {
    await fail(MAX_ATTEMPTS)
    expect(await isLockedOut(testDb, 'b@example.com')).toBe(false)
  })

  it('is case-insensitive on email', async () => {
    await fail(MAX_ATTEMPTS, 'a@example.com')
    expect(await isLockedOut(testDb, 'A@Example.COM')).toBe(true)
  })

  it('ignores attempts older than the window', async () => {
    await fail(MAX_ATTEMPTS)
    await testDb.loginAttempt.updateMany({
      data: { createdAt: new Date(Date.now() - WINDOW_MS - 1000) },
    })
    expect(await isLockedOut(testDb, 'a@example.com')).toBe(false)
  })

  it('does not count successful attempts toward lockout', async () => {
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
      await recordLoginAttempt(testDb, { email: 'a@example.com', succeeded: true })
    }
    expect(await isLockedOut(testDb, 'a@example.com')).toBe(false)
  })

  it('clears attempts on demand', async () => {
    await fail(MAX_ATTEMPTS)
    await clearAttempts(testDb, 'a@example.com')
    expect(await isLockedOut(testDb, 'a@example.com')).toBe(false)
  })
})
