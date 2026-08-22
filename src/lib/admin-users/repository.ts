import type { PrismaClient, Prisma } from '@prisma/client'
import { hashPassword } from '@/lib/crypto/password'
import { writeAudit } from '@/lib/audit'
import type { Role } from '@/lib/auth/roles'

export class LastOwnerError extends Error {
  constructor() {
    super('The last active owner cannot be removed, demoted, or deactivated')
    this.name = 'LastOwnerError'
  }
}

export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`An admin with the email ${email} already exists`)
    this.name = 'DuplicateEmailError'
  }
}

export type AdminUserRow = {
  id: string
  email: string
  name: string
  role: Role
  isActive: boolean
  lastLoginAt: Date | null
  createdAt: Date
}

const SELECT = {
  id: true, email: true, name: true, role: true,
  isActive: true, lastLoginAt: true, createdAt: true,
} satisfies Prisma.AdminUserSelect

export type CreateAdminInput = {
  email: string
  name: string
  role: Role
  password: string
}

export async function listAdminUsers(db: PrismaClient): Promise<AdminUserRow[]> {
  const rows = await db.adminUser.findMany({ select: SELECT, orderBy: { createdAt: 'desc' } })
  return rows as AdminUserRow[]
}

export async function createAdminUser(
  db: PrismaClient,
  actorId: string | null,
  input: CreateAdminInput,
): Promise<AdminUserRow> {
  const email = input.email.trim().toLowerCase()
  const existing = await db.adminUser.findUnique({ where: { email }, select: { id: true } })
  if (existing) throw new DuplicateEmailError(email)

  const passwordHash = await hashPassword(input.password)

  return db.$transaction(async (tx) => {
    const user = await tx.adminUser.create({
      data: { email, name: input.name.trim(), role: input.role, passwordHash },
      select: SELECT,
    })
    await writeAudit(tx, {
      actorId,
      action: 'adminUser.create',
      entity: 'AdminUser',
      entityId: user.id,
      meta: { email, role: input.role },
    })
    return user as AdminUserRow
  })
}

/** Counts active owners excluding one user, to test whether a change strands the account. */
async function activeOwnersExcluding(tx: Prisma.TransactionClient, userId: string): Promise<number> {
  return tx.adminUser.count({
    where: { role: 'OWNER', isActive: true, id: { not: userId } },
  })
}

export async function updateAdminRole(
  db: PrismaClient,
  actorId: string | null,
  userId: string,
  role: Role,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const user = await tx.adminUser.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true, isActive: true },
    })
    const losingOwner = user.role === 'OWNER' && user.isActive && role !== 'OWNER'
    if (losingOwner && (await activeOwnersExcluding(tx, userId)) === 0) throw new LastOwnerError()

    await tx.adminUser.update({ where: { id: userId }, data: { role } })
    await writeAudit(tx, {
      actorId,
      action: 'adminUser.updateRole',
      entity: 'AdminUser',
      entityId: userId,
      meta: { from: user.role, to: role },
    })
  })
}

export async function setAdminActive(
  db: PrismaClient,
  actorId: string | null,
  userId: string,
  isActive: boolean,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const user = await tx.adminUser.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true, isActive: true },
    })
    const losingOwner = user.role === 'OWNER' && user.isActive && !isActive
    if (losingOwner && (await activeOwnersExcluding(tx, userId)) === 0) throw new LastOwnerError()

    await tx.adminUser.update({ where: { id: userId }, data: { isActive } })
    if (!isActive) await tx.adminSession.deleteMany({ where: { userId } })
    await writeAudit(tx, {
      actorId,
      action: 'adminUser.setActive',
      entity: 'AdminUser',
      entityId: userId,
      meta: { isActive },
    })
  })
}

export async function resetAdminPassword(
  db: PrismaClient,
  actorId: string | null,
  userId: string,
  password: string,
): Promise<void> {
  const passwordHash = await hashPassword(password)
  await db.$transaction(async (tx) => {
    await tx.adminUser.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: true },
    })
    await tx.adminSession.deleteMany({ where: { userId } })
    await writeAudit(tx, {
      actorId,
      action: 'adminUser.resetPassword',
      entity: 'AdminUser',
      entityId: userId,
    })
  })
}
