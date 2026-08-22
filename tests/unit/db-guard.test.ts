import { describe, it, expect } from 'vitest'
import { assertDistinctDatabases } from '../helpers/db'

describe('assertDistinctDatabases', () => {
  it('rejects identical URLs, naming both environment variables', () => {
    const url = 'mongodb://127.0.0.1:27018/gala?replicaSet=rs0'
    expect(() => assertDistinctDatabases(url, url))
      .toThrow(/DATABASE_URL_TEST.*DATABASE_URL|DATABASE_URL.*DATABASE_URL_TEST/)
  })

  it('rejects the same host and database name with differing query strings', () => {
    const appUrl = 'mongodb://127.0.0.1:27018/gala'
    const testUrl = 'mongodb://127.0.0.1:27018/gala?replicaSet=rs0'
    expect(() => assertDistinctDatabases(appUrl, testUrl)).toThrow()
  })

  it('accepts genuinely different database names on the same host', () => {
    const appUrl = 'mongodb://127.0.0.1:27018/gala'
    const testUrl = 'mongodb://127.0.0.1:27018/gala_test'
    expect(() => assertDistinctDatabases(appUrl, testUrl)).not.toThrow()
  })
})
