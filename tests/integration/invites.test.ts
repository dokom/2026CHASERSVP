import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import {
  createInvite, listInvites, getInvite, updateInvite,
  regenerateInviteToken, deleteInvite,
  recomputeInviteStatus, listInviteTokens, getInviteToken,
} from '@/lib/invites/repository'
import { hashToken } from '@/lib/crypto/tokens'

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

const base = {
  label: 'Reyes Party',
  seatsAllotted: 2,
  primaryGuest: { firstName: 'Jordan', lastName: 'Reyes', email: 'jordan@example.com' },
}

describe('invite repository', () => {
  it('creates an invite with a primary guest', async () => {
    const { invite } = await createInvite(testDb, null, base)
    expect(invite.label).toBe('Reyes Party')
    const guests = await testDb.guest.findMany({ where: { inviteId: invite.id } })
    expect(guests).toHaveLength(1)
    expect(guests[0]).toMatchObject({ firstName: 'Jordan', isPrimary: true })
  })

  it('returns a plaintext token that is stored only as a hash', async () => {
    const { invite, token } = await createInvite(testDb, null, base)
    const row = await testDb.invite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(row.tokenHash).toBe(hashToken(token))
  })

  it('never returns the token hash in the invite row', async () => {
    const { invite } = await createInvite(testDb, null, base)
    expect(invite).not.toHaveProperty('tokenHash')
  })

  it('starts every invite PENDING', async () => {
    const { invite } = await createInvite(testDb, null, base)
    expect(invite.status).toBe('PENDING')
  })

  it('searches by label case-insensitively', async () => {
    await createInvite(testDb, null, base)
    await createInvite(testDb, null, {
      ...base,
      label: 'Okafor Party',
      primaryGuest: { firstName: 'Amara', lastName: 'Okafor' },
    })
    const { rows, total } = await listInvites(testDb, { search: 'reyes' })
    expect(total).toBe(1)
    expect(rows[0]?.label).toBe('Reyes Party')
  })

  it('searches by primary guest name', async () => {
    await createInvite(testDb, null, base)
    const { total } = await listInvites(testDb, { search: 'jordan' })
    expect(total).toBe(1)
  })

  it('filters by status', async () => {
    const { invite } = await createInvite(testDb, null, base)
    await testDb.invite.update({ where: { id: invite.id }, data: { status: 'ATTENDING' } })
    await createInvite(testDb, null, { ...base, label: 'Second' })
    expect((await listInvites(testDb, { status: 'ATTENDING' })).total).toBe(1)
    expect((await listInvites(testDb, { status: 'PENDING' })).total).toBe(1)
  })

  it('paginates', async () => {
    for (let i = 0; i < 5; i++) {
      await createInvite(testDb, null, { ...base, label: `Party ${i}` })
    }
    const page = await listInvites(testDb, { page: 2, pageSize: 2 })
    expect(page.rows).toHaveLength(2)
    expect(page.total).toBe(5)
  })

  it('loads detail including guests', async () => {
    const { invite } = await createInvite(testDb, null, base)
    const detail = await getInvite(testDb, invite.id)
    expect(detail?.guests).toHaveLength(1)
  })

  it('returns null for an unknown invite', async () => {
    expect(await getInvite(testDb, 'missing')).toBeNull()
  })

  it('updates editable fields', async () => {
    const { invite } = await createInvite(testDb, null, base)
    await updateInvite(testDb, null, invite.id, { label: 'Renamed', tableNumber: '12' })
    const row = await testDb.invite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(row.label).toBe('Renamed')
    expect(row.tableNumber).toBe('12')
  })

  it('lets seats shrink below the guest count: the allowance is a planning number only', async () => {
    const { invite } = await createInvite(testDb, null, base)
    await testDb.guest.create({ data: { inviteId: invite.id, firstName: 'Sam', lastName: 'Reyes' } })
    await updateInvite(testDb, null, invite.id, { seatsAllotted: 1 })
    expect((await testDb.invite.findUniqueOrThrow({ where: { id: invite.id } })).seatsAllotted).toBe(1)
  })

  it('regenerates the token and invalidates the old one', async () => {
    const { invite, token } = await createInvite(testDb, null, base)
    const next = await regenerateInviteToken(testDb, null, invite.id)
    expect(next).not.toBe(token)
    const row = await testDb.invite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(row.tokenHash).toBe(hashToken(next))
    expect(row.tokenHash).not.toBe(hashToken(token))
  })

  it('deletes an invite and its guests', async () => {
    const { invite } = await createInvite(testDb, null, base)
    await deleteInvite(testDb, null, invite.id)
    expect(await testDb.invite.count()).toBe(0)
    expect(await testDb.guest.count()).toBe(0)
  })

  it('recomputes status from guest attendance', async () => {
    const { invite } = await createInvite(testDb, null, base)
    await testDb.guest.updateMany({ where: { inviteId: invite.id }, data: { attending: true } })
    await recomputeInviteStatus(testDb, invite.id)
    const row = await testDb.invite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(row.status).toBe('ATTENDING')
  })

  it('audits creation, update, regeneration, and deletion', async () => {
    const { invite } = await createInvite(testDb, null, base)
    await updateInvite(testDb, null, invite.id, { label: 'Renamed' })
    await regenerateInviteToken(testDb, null, invite.id)
    await deleteInvite(testDb, null, invite.id)
    const actions = (await testDb.auditLog.findMany()).map((l) => l.action)
    expect(actions).toEqual(
      expect.arrayContaining([
        'invite.create', 'invite.update', 'invite.regenerateToken', 'invite.delete',
      ]),
    )
  })

  it('recovers the plaintext token for QR export', async () => {
    const { invite, token } = await createInvite(testDb, null, base)
    expect(await getInviteToken(testDb, invite.id)).toBe(token)
    const all = await listInviteTokens(testDb)
    expect(all).toEqual([{ id: invite.id, number: 1, label: 'Reyes Party', token }])
  })

  it('recovers the new token after regeneration', async () => {
    const { invite } = await createInvite(testDb, null, base)
    const next = await regenerateInviteToken(testDb, null, invite.id)
    expect(await getInviteToken(testDb, invite.id)).toBe(next)
  })

  it('returns null when recovering an unknown invite', async () => {
    expect(await getInviteToken(testDb, 'missing')).toBeNull()
  })

  it('omits invites whose cipher cannot be opened rather than throwing', async () => {
    const { invite } = await createInvite(testDb, null, base)
    await testDb.invite.update({
      where: { id: invite.id },
      data: { tokenCipher: 'v1.aaaa.bbbb.cccc' },
    })
    await expect(listInviteTokens(testDb)).resolves.toEqual([])
  })

  it('stores the cipher, not the plaintext token', async () => {
    const { invite, token } = await createInvite(testDb, null, base)
    const row = await testDb.invite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(row.tokenCipher).not.toContain(token)
    expect(row.tokenCipher.startsWith('v1.')).toBe(true)
  })

  it('never writes a plaintext token into audit meta', async () => {
    const { invite, token } = await createInvite(testDb, null, base)
    await regenerateInviteToken(testDb, null, invite.id)
    const logs = await testDb.auditLog.findMany()
    expect(JSON.stringify(logs)).not.toContain(token)
  })
})
