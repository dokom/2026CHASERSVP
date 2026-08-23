import type { PrismaClient } from '@prisma/client'
import { generateInviteToken, hashToken } from '@/lib/crypto/tokens'
import { seal } from '@/lib/crypto/secret-box'
import { getEnv } from '@/lib/env'
import { writeAudit } from '@/lib/audit'
import type { ImportRow } from './csv'

export const MAX_IMPORT_ROWS = 2000

export type ImportResult = {
  created: number
  skippedExistingEmails: string[]
}

export async function existingEmails(
  db: PrismaClient,
  emails: string[],
): Promise<Set<string>> {
  const wanted = emails.filter(Boolean).map((e) => e.toLowerCase())
  if (wanted.length === 0) return new Set()
  const found = await db.guest.findMany({
    where: { email: { in: wanted } },
    select: { email: true },
  })
  return new Set(found.map((g) => g.email!.toLowerCase()))
}

/**
 * Commits an entire import in one transaction. Rows whose primary email already
 * exists are skipped rather than failing the batch — re-importing a corrected
 * spreadsheet is a normal operation, not an error.
 */
export async function commitInviteImport(
  db: PrismaClient,
  actorId: string | null,
  rows: ImportRow[],
): Promise<ImportResult> {
  if (rows.length === 0) return { created: 0, skippedExistingEmails: [] }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Import accepts at most ${MAX_IMPORT_ROWS} rows per file`)
  }

  const taken = await existingEmails(db, rows.map((r) => r.primaryGuest.email))
  const skippedExistingEmails: string[] = []
  const toCreate = rows.filter((row) => {
    const email = row.primaryGuest.email.toLowerCase()
    if (email && taken.has(email)) {
      skippedExistingEmails.push(email)
      return false
    }
    return true
  })

  const secret = getEnv().SESSION_SECRET

  await db.$transaction(
    async (tx) => {
      for (const row of toCreate) {
        const token = generateInviteToken()
        await tx.invite.create({
          data: {
            tokenHash: hashToken(token),
            tokenCipher: seal(token, secret),
            label: row.label,
            seatsAllotted: row.seatsAllotted,
            tableNumber: row.tableNumber || null,
            adminNotes: row.adminNotes || null,
            guests: {
              create: {
                firstName: row.primaryGuest.firstName,
                lastName: row.primaryGuest.lastName,
                email: row.primaryGuest.email || null,
                company: row.primaryGuest.company || null,
                title: row.primaryGuest.title || null,
                isPrimary: true,
              },
            },
          },
        })
      }
      await writeAudit(tx, {
        actorId,
        action: 'invite.import',
        entity: 'Invite',
        meta: { created: toCreate.length, skipped: skippedExistingEmails.length },
      })
    },
    { timeout: 120_000 },
  )

  return { created: toCreate.length, skippedExistingEmails }
}
