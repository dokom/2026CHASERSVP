import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { resolveInviteByToken } from '@/lib/guest/resolve'
import { createInvite } from '@/lib/invites/repository'

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

const base = {
  label: 'Reyes Party',
  seatsAllotted: 2,
  tableNumber: '12',
  primaryGuest: { firstName: 'Jordan', lastName: 'Reyes', email: 'jordan@example.com' },
}

describe('resolveInviteByToken', () => {
  it('resolves an invite from its plaintext token', async () => {
    const { token } = await createInvite(testDb, null, base)
    const invite = await resolveInviteByToken(testDb, token)
    expect(invite).toMatchObject({ label: 'Reyes Party', seatsAllotted: 2, tableNumber: '12' })
  })

  it('includes the party, primary guest first', async () => {
    const { invite, token } = await createInvite(testDb, null, base)
    await testDb.guest.create({
      data: { inviteId: invite.id, firstName: 'Sam', lastName: 'Reyes' },
    })
    const resolved = await resolveInviteByToken(testDb, token)
    expect(resolved?.guests).toHaveLength(2)
    expect(resolved?.guests[0]?.isPrimary).toBe(true)
  })

  it('returns null for an unknown token', async () => {
    expect(await resolveInviteByToken(testDb, 'not-a-real-token')).toBeNull()
  })

  it('returns null for an empty token', async () => {
    expect(await resolveInviteByToken(testDb, '')).toBeNull()
  })

  it('returns null for a token that looks like an ObjectId', async () => {
    // Guards the MongoDB trap: lookup must be by tokenHash, never by id.
    await expect(resolveInviteByToken(testDb, 'a'.repeat(24))).resolves.toBeNull()
  })

  it('never exposes the token hash or cipher', async () => {
    const { token } = await createInvite(testDb, null, base)
    const invite = await resolveInviteByToken(testDb, token)
    expect(invite).not.toHaveProperty('tokenHash')
    expect(invite).not.toHaveProperty('tokenCipher')
    expect(JSON.stringify(invite)).not.toContain(token)
  })

  it('stops resolving once the token is regenerated', async () => {
    const { invite, token } = await createInvite(testDb, null, base)
    const { regenerateInviteToken } = await import('@/lib/invites/repository')
    const next = await regenerateInviteToken(testDb, null, invite.id)
    expect(await resolveInviteByToken(testDb, token)).toBeNull()
    expect(await resolveInviteByToken(testDb, next)).not.toBeNull()
  })
})
