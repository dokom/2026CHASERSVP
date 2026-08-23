import type { PrismaClient } from '@prisma/client'
import { Prisma } from '@prisma/client'
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

/** Prisma's MongoDB write-conflict error code — see `withWriteConflictRetry`. */
const WRITE_CONFLICT_CODE = 'P2034'

/**
 * Runs `fn` inside a MongoDB transaction. If the transaction aborts with a
 * write conflict (Prisma error P2034), retries exactly once.
 *
 * Why retry rather than let it propagate: `assertSurvivingOwner` below
 * deliberately turns the last-owner check into a WRITE against every other
 * active owner's row, specifically so two transactions that would each
 * leave zero owners are forced to contend on the same document and MongoDB
 * aborts one of them. With exactly two owners that conflict always means a
 * genuine last-owner race. With three or more owners it can also fire when
 * two *unrelated* demotions (of two different, non-last owners) happen to
 * both touch a third owner's row — a false-positive conflict, not an actual
 * last-owner violation. Retrying once re-runs the transaction against
 * fresh post-commit state: the retried attempt then either succeeds
 * cleanly or correctly throws `LastOwnerError`, instead of surfacing a raw
 * "write conflict" error to the caller for what may be a perfectly legal
 * request. A second failure is allowed to propagate rather than retrying
 * again — Prisma's own transaction options apply bounded retries by
 * default, and retrying indefinitely here would risk masking sustained
 * contention as success. The error is never swallowed: on a non-conflict
 * error, or a conflict on the second attempt, it is rethrown as-is.
 */
async function withWriteConflictRetry<T>(
  db: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await db.$transaction(fn)
  } catch (error) {
    const isWriteConflict =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === WRITE_CONFLICT_CODE
    if (!isWriteConflict) throw error
    return db.$transaction(fn)
  }
}

/**
 * Asserts that removing `userId`'s active ownership still leaves at least
 * one other active owner — and, unlike a plain read, does so as a WRITE so
 * MongoDB's transaction conflict detector actually covers it.
 *
 * MongoDB provides snapshot isolation and only detects write conflicts on
 * documents that BOTH transactions write; concurrent reads are invisible to
 * it. A `count()` read here would let two concurrent demotions each read
 * "one other active owner exists" and both commit, stranding the account
 * with zero owners — see the concurrency test in
 * tests/integration/admin-users.test.ts, which fails against a read-only
 * version of this guard. By instead updating every other active owner's
 * row, two transactions that would each leave zero owners are forced onto
 * the same document(s), and one aborts with a write conflict that
 * `withWriteConflictRetry` handles.
 */
async function assertSurvivingOwner(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const { count } = await tx.adminUser.updateMany({
    where: { role: 'OWNER', isActive: true, id: { not: userId } },
    data: { updatedAt: new Date() },
  })
  if (count === 0) throw new LastOwnerError()
}

export async function updateAdminRole(
  db: PrismaClient,
  actorId: string | null,
  userId: string,
  role: Role,
): Promise<void> {
  await withWriteConflictRetry(db, async (tx) => {
    const user = await tx.adminUser.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true, isActive: true },
    })
    const losingOwner = user.role === 'OWNER' && user.isActive && role !== 'OWNER'
    if (losingOwner) await assertSurvivingOwner(tx, userId)

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
  await withWriteConflictRetry(db, async (tx) => {
    const user = await tx.adminUser.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true, isActive: true },
    })
    const losingOwner = user.role === 'OWNER' && user.isActive && !isActive
    if (losingOwner) await assertSurvivingOwner(tx, userId)

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
