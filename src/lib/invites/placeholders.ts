import type { PrismaClient } from '@prisma/client'
import { generateInviteToken, hashToken } from '@/lib/crypto/tokens'
import { seal } from '@/lib/crypto/secret-box'
import { getEnv } from '@/lib/env'
import { writeAudit } from '@/lib/audit'
import { allocateInviteNumbers } from './repository'
import { placeholderLabel } from './numbering'

/** One batch at a time — the same ceiling the CSV import enforces. */
export const MAX_PLACEHOLDER_BATCH = 2000

export type PlaceholderBatch = {
  count: number
  seatsAllotted: number
}

export type PlaceholderResult = {
  created: number
  firstNumber: number
  lastNumber: number
}

/**
 * Mints `count` numbered invites with no guests attached: each gets its own
 * permanent token, so the QR codes can go to the printer before anyone knows
 * who will hold card 001. The admin fills in the names later; the token —
 * and therefore the printed code — never changes.
 *
 * Numbers continue from the highest one already issued (see
 * `allocateInviteNumbers`), so a second batch never overlaps a printed run.
 */
export async function createPlaceholderInvites(
  db: PrismaClient,
  actorId: string | null,
  batch: PlaceholderBatch,
): Promise<PlaceholderResult> {
  if (!Number.isInteger(batch.count) || batch.count < 1 || batch.count > MAX_PLACEHOLDER_BATCH) {
    throw new Error(`Placeholder batches must be between 1 and ${MAX_PLACEHOLDER_BATCH} invites`)
  }

  const secret = getEnv().SESSION_SECRET

  return db.$transaction(
    async (tx) => {
      const numbers = await allocateInviteNumbers(tx, batch.count)
      const highest = numbers[numbers.length - 1]!

      for (const number of numbers) {
        const token = generateInviteToken()
        await tx.invite.create({
          data: {
            tokenHash: hashToken(token),
            tokenCipher: seal(token, secret),
            number,
            label: placeholderLabel(number, highest),
            seatsAllotted: batch.seatsAllotted,
          },
        })
      }

      await writeAudit(tx, {
        actorId,
        action: 'invite.createPlaceholders',
        entity: 'Invite',
        meta: { count: batch.count, seatsAllotted: batch.seatsAllotted, from: numbers[0], to: highest },
      })

      return { created: numbers.length, firstNumber: numbers[0]!, lastNumber: highest }
    },
    { timeout: 120_000 },
  )
}
