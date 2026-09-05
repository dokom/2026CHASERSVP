import type { PrismaClient, Prisma } from '@prisma/client'
import { generateInviteToken, hashToken } from '@/lib/crypto/tokens'
import { seal } from '@/lib/crypto/secret-box'
import { getEnv } from '@/lib/env'
import { writeAudit } from '@/lib/audit'
import { allocateInviteNumbers } from './repository'
import { planImport, type PlannedRow } from './import-plan'
import type { ImportRow } from './csv'

export const MAX_IMPORT_ROWS = 2000

export type ImportResult = {
  created: number
  updated: number
  skipped: { label: string; reason: string }[]
}

export async function existingEmails(db: PrismaClient, emails: string[]): Promise<Set<string>> {
  const wanted = emails.filter(Boolean).map((e) => e.toLowerCase())
  if (wanted.length === 0) return new Set()
  const found = await db.guest.findMany({ where: { email: { in: wanted } }, select: { email: true } })
  return new Set(found.map((g) => g.email!.toLowerCase()))
}

function inviteFields(row: ImportRow) {
  return {
    label: row.label,
    seatsAllotted: row.seatsAllotted,
    tableNumber: row.tableNumber || null,
    adminNotes: row.adminNotes || null,
  }
}

function guestFields(row: ImportRow) {
  return {
    firstName: row.primaryGuest.firstName,
    lastName: row.primaryGuest.lastName,
    email: row.primaryGuest.email || null,
    company: row.primaryGuest.company || null,
    title: row.primaryGuest.title || null,
  }
}

async function createFromRow(tx: Prisma.TransactionClient, row: ImportRow, number: number, secret: string): Promise<void> {
  const token = generateInviteToken()
  await tx.invite.create({
    data: {
      tokenHash: hashToken(token),
      tokenCipher: seal(token, secret),
      number,
      ...inviteFields(row),
      guests: { create: { ...guestFields(row), isPrimary: true } },
    },
  })
}

/**
 * Token, number, status, respondedAt and every other guest are untouched:
 * this is the organiser filling in who holds a printed card, not a reset.
 */
async function updateFromRow(
  tx: Prisma.TransactionClient, row: ImportRow, inviteId: string, primaryGuestId: string | null,
): Promise<void> {
  await tx.invite.update({ where: { id: inviteId }, data: inviteFields(row) })
  if (primaryGuestId) {
    await tx.guest.update({ where: { id: primaryGuestId }, data: guestFields(row) })
  } else {
    await tx.guest.create({ data: { inviteId, ...guestFields(row), isPrimary: true } })
  }
}

function summarise(planned: PlannedRow[]): ImportResult {
  return {
    created: planned.filter((p) => p.plan.action === 'create').length,
    updated: planned.filter((p) => p.plan.action === 'update').length,
    skipped: planned.flatMap((p) => (p.plan.action === 'skip' ? [{ label: p.row.label, reason: p.plan.reason }] : [])),
  }
}

/**
 * Commits an entire import in one transaction: creates and updates
 * together, planned inside the transaction so the label and number lookups
 * see the same snapshot the writes do. Skipped rows are reported, never
 * fatal: re-importing a corrected spreadsheet is a normal operation.
 */
export async function commitInviteImport(
  db: PrismaClient,
  actorId: string | null,
  rows: ImportRow[],
): Promise<ImportResult> {
  if (rows.length === 0) return { created: 0, updated: 0, skipped: [] }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Import accepts at most ${MAX_IMPORT_ROWS} rows per file`)
  }

  const secret = getEnv().SESSION_SECRET

  return db.$transaction(
    async (tx) => {
      const planned = await planImport(tx, rows)
      const creates = planned.filter((p) => p.plan.action === 'create')
      const numbers = await allocateInviteNumbers(tx, creates.length)

      let nextNumber = 0
      for (const { row, plan } of planned) {
        if (plan.action === 'create') await createFromRow(tx, row, numbers[nextNumber++]!, secret)
        else if (plan.action === 'update') await updateFromRow(tx, row, plan.inviteId, plan.primaryGuestId)
      }

      const result = summarise(planned)
      await writeAudit(tx, {
        actorId,
        action: 'invite.import',
        entity: 'Invite',
        meta: { created: result.created, updated: result.updated, skipped: result.skipped.length },
      })
      return result
    },
    { timeout: 120_000 },
  )
}
