import type { PrismaClient } from '@prisma/client'
import { verifyPassword } from '@/lib/crypto/password'
import { writeAudit } from '@/lib/audit'
import { createSession, type SessionMeta, type SessionUser } from './session'
import { isLockedOut, recordLoginAttempt, clearAttempts } from './rate-limit'
import type { Role } from './roles'

export type LoginInput = { email: string; password: string }

export type LoginResult =
  | { ok: true; user: SessionUser; token: string; expiresAt: Date }
  | { ok: false; reason: 'INVALID' | 'LOCKED_OUT' | 'INACTIVE' }

// A syntactically valid argon2id hash with no known matching password, used
// so a missing user still pays the full verify() cost — this keeps failure
// timing indistinguishable from a wrong-password failure and prevents an
// attacker from probing account existence.
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$aaaaaaaaaaaaaaaa$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

export async function attemptLogin(
  db: PrismaClient,
  input: LoginInput,
  meta: SessionMeta,
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase()

  if (await isLockedOut(db, email)) {
    await recordLoginAttempt(db, { email, succeeded: false, ip: meta.ip })
    return { ok: false, reason: 'LOCKED_OUT' }
  }

  const user = await db.adminUser.findUnique({ where: { email } })

  // Hash-compare even when the user is missing so timing does not reveal
  // whether an account exists.
  const passwordOk = user
    ? await verifyPassword(user.passwordHash, input.password)
    : await verifyPassword(DUMMY_HASH, input.password)

  if (!user || !passwordOk) {
    await recordLoginAttempt(db, { email, succeeded: false, ip: meta.ip })
    return { ok: false, reason: 'INVALID' }
  }

  if (!user.isActive) {
    await recordLoginAttempt(db, { email, succeeded: false, ip: meta.ip })
    return { ok: false, reason: 'INACTIVE' }
  }

  await clearAttempts(db, email)
  await recordLoginAttempt(db, { email, succeeded: true, ip: meta.ip })
  await db.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  await writeAudit(db, {
    actorId: user.id,
    action: 'auth.login',
    entity: 'AdminUser',
    entityId: user.id,
    ip: meta.ip ?? null,
  })

  const { token, expiresAt } = await createSession(db, user.id, meta)
  return {
    ok: true,
    token,
    expiresAt,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
      mustChangePassword: user.mustChangePassword,
    },
  }
}
