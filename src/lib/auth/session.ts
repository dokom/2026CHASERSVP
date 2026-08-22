import type { PrismaClient } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import { hashToken } from '@/lib/crypto/tokens'
import type { Role } from './roles'

export const SESSION_COOKIE = 'gala_admin_session'
export const SESSION_TTL_MS = 1000 * 60 * 60 * 12

export type SessionUser = {
  id: string
  email: string
  name: string
  role: Role
  mustChangePassword: boolean
}

export type SessionMeta = { ip?: string; userAgent?: string }

/**
 * Creates a DB-backed admin session and returns the plaintext token to hand
 * to the caller (for the session cookie). Only sha256(token) is persisted —
 * the plaintext never touches the database or logs.
 */
export async function createSession(
  db: PrismaClient,
  userId: string,
  meta: SessionMeta,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.adminSession.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    },
  })
  return { token, expiresAt }
}

/**
 * Resolves a session token to its user. Returns null (rather than throwing)
 * for an unknown token, an expired session (which is also deleted as a
 * side effect), or a session belonging to a deactivated user.
 */
export async function resolveSession(
  db: PrismaClient,
  token: string,
): Promise<SessionUser | null> {
  if (!token) return null
  const session = await db.adminSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  })
  if (!session) return null

  if (session.expiresAt.getTime() <= Date.now()) {
    await db.adminSession.delete({ where: { id: session.id } }).catch(() => undefined)
    return null
  }
  if (!session.user.isActive) return null

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role as Role,
    mustChangePassword: session.user.mustChangePassword,
  }
}

/** Deletes the session matching this token, if any. Never throws. */
export async function destroySession(db: PrismaClient, token: string): Promise<void> {
  if (!token) return
  await db.adminSession
    .deleteMany({ where: { tokenHash: hashToken(token) } })
    .catch(() => undefined)
}

/** Deletes all sessions past their expiry. Returns the count removed. */
export async function purgeExpiredSessions(db: PrismaClient): Promise<number> {
  const { count } = await db.adminSession.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  })
  return count
}
