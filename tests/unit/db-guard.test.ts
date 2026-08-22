import { describe, it, expect } from 'vitest'
import { assertDistinctDatabases } from '@/lib/db-identity'

describe('assertDistinctDatabases', () => {
  it('rejects identical URLs, naming both environment variables', () => {
    const url = 'mongodb://db.example.com:27018/gala?replicaSet=rs0'
    expect(() => assertDistinctDatabases(url, url))
      .toThrow(/DATABASE_URL_TEST.*DATABASE_URL|DATABASE_URL.*DATABASE_URL_TEST/)
  })

  it('rejects the same host and database name with differing query strings', () => {
    const appUrl = 'mongodb://db.example.com:27018/gala'
    const testUrl = 'mongodb://db.example.com:27018/gala?replicaSet=rs0'
    expect(() => assertDistinctDatabases(appUrl, testUrl)).toThrow()
  })

  it('accepts genuinely different database names on the same host', () => {
    const appUrl = 'mongodb://db.example.com:27018/gala'
    const testUrl = 'mongodb://db.example.com:27018/gala_test'
    expect(() => assertDistinctDatabases(appUrl, testUrl)).not.toThrow()
  })

  it('parses and compares multi-host replica-set URLs instead of throwing', () => {
    const appUrl = 'mongodb://h1.example.com:27017,h2.example.com:27017/gala?replicaSet=rs0'
    const testUrl = 'mongodb://h1.example.com:27017,h2.example.com:27017/gala_test?replicaSet=rs0'
    expect(() => assertDistinctDatabases(appUrl, testUrl)).not.toThrow()

    const sameUrl = 'mongodb://h1.example.com:27017,h2.example.com:27017/gala?replicaSet=rs0'
    expect(() => assertDistinctDatabases(sameUrl, sameUrl)).toThrow()
  })

  it('parses mongodb+srv:// URLs', () => {
    const appUrl = 'mongodb+srv://cluster.example.mongodb.net/gala'
    const testUrl = 'mongodb+srv://cluster.example.mongodb.net/gala_test'
    expect(() => assertDistinctDatabases(appUrl, testUrl)).not.toThrow()
    expect(() => assertDistinctDatabases(appUrl, appUrl)).toThrow()
  })

  it('compares by host and database, ignoring embedded credentials', () => {
    const appUrl = 'mongodb://appuser:apppass@db.example.com:27017/gala'
    const testUrl = 'mongodb://testuser:testpass@db.example.com:27017/gala'
    expect(() => assertDistinctDatabases(appUrl, testUrl)).toThrow()
  })

  it('treats the default port and an explicit :27017 as the same database', () => {
    const appUrl = 'mongodb://db.example.com/gala'
    const testUrl = 'mongodb://db.example.com:27017/gala'
    expect(() => assertDistinctDatabases(appUrl, testUrl)).toThrow()
  })

  it('treats a trailing slash and no trailing slash as the same database', () => {
    const appUrl = 'mongodb://db.example.com/gala'
    const testUrl = 'mongodb://db.example.com/gala/'
    expect(() => assertDistinctDatabases(appUrl, testUrl)).toThrow()
  })

  it('treats differing host case as the same database', () => {
    const appUrl = 'mongodb://DB.EXAMPLE.COM/gala'
    const testUrl = 'mongodb://db.example.com/gala'
    expect(() => assertDistinctDatabases(appUrl, testUrl)).toThrow()
  })

  it('throws a clear error naming the environment variable on an unparseable connection string', () => {
    expect(() => assertDistinctDatabases('not-a-mongo-url', 'mongodb://db.example.com/gala_test'))
      .toThrow(/DATABASE_URL\b/)
  })
})
