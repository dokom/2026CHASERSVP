import type { PrismaClient, Prisma } from '@prisma/client'
import { hashToken } from '@/lib/crypto/tokens'
import type { InviteStatus } from '@/lib/invites/status'

export type GuestRow = {
  id: string
  firstName: string
  lastName: string
  badgeName: string | null
  company: string | null
  title: string | null
  email: string | null
  phone: string | null
  isPrimary: boolean
  attending: boolean | null
  mealOptionId: string | null
  dietary: string[]
  accessibilityNeeds: string | null
  tableNumber: string | null
}

export type GuestInvite = {
  id: string
  number: number
  label: string
  status: InviteStatus
  tableNumber: string | null
  respondedAt: Date | null
  guests: GuestRow[]
}

/**
 * Selects exactly what the guest page needs. `tokenHash` and `tokenCipher` are
 * deliberately absent: nothing the guest sees should carry credential material,
 * and an explicit select is the only way to keep that true as the schema grows.
 */
const SELECT = {
  id: true,
  number: true,
  label: true,
  status: true,
  tableNumber: true,
  respondedAt: true,
  guests: {
    select: {
      id: true, firstName: true, lastName: true, badgeName: true, company: true,
      title: true, email: true, phone: true, isPrimary: true, attending: true,
      mealOptionId: true, dietary: true, accessibilityNeeds: true, tableNumber: true,
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.InviteSelect

/**
 * Resolves an invite from the plaintext token a QR code carries.
 *
 * Lookup is by `tokenHash`, never by id — so a malformed or hostile value is a
 * plain miss rather than a thrown `Malformed ObjectID`. The token itself is
 * never logged and never returned.
 */
export async function resolveInviteByToken(
  db: PrismaClient,
  token: string,
): Promise<GuestInvite | null> {
  if (!token) return null
  const invite = await db.invite.findUnique({
    where: { tokenHash: hashToken(token) },
    select: SELECT,
  })
  return invite as GuestInvite | null
}
