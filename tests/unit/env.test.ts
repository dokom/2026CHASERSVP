import { describe, it, expect } from 'vitest'
import { parseEnv } from '@/lib/env'

const valid = {
  DATABASE_URL: 'mongodb://127.0.0.1:27018/gala?replicaSet=rs0',
  DATABASE_URL_TEST: 'mongodb://127.0.0.1:27018/gala_test?replicaSet=rs0',
  APP_URL: 'https://gala.example.com',
  SESSION_SECRET: 'a'.repeat(32),
  ADMIN_SEED_EMAIL: 'owner@example.com',
  ADMIN_SEED_PASSWORD: 'hunter2hunter2',
}

describe('parseEnv', () => {
  it('returns a typed config for valid input', () => {
    expect(parseEnv(valid).APP_URL).toBe('https://gala.example.com')
  })

  it('throws naming the missing variable', () => {
    const { SESSION_SECRET, ...rest } = valid
    expect(() => parseEnv(rest)).toThrow(/SESSION_SECRET/)
  })

  it('rejects a session secret under 32 characters', () => {
    expect(() => parseEnv({ ...valid, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/)
  })

  it('rejects a non-URL APP_URL', () => {
    expect(() => parseEnv({ ...valid, APP_URL: 'not-a-url' })).toThrow(/APP_URL/)
  })

  it('strips a trailing slash from APP_URL', () => {
    expect(parseEnv({ ...valid, APP_URL: 'https://gala.example.com/' }).APP_URL)
      .toBe('https://gala.example.com')
  })

  it('rejects a test database identical to the app database', () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL_TEST: valid.DATABASE_URL }))
      .toThrow(/must differ/i)
  })
})
