import type { PrismaClient } from '@prisma/client'

/** Maximum number of failed login attempts allowed within the window. */
export const MAX_ATTEMPTS = 5

/** Sliding window (ms) over which failed attempts are counted. */
export const WINDOW_MS = 1000 * 60 * 15

/** Normalizes an email for case-insensitive, whitespace-tolerant matching. */
function normalize(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Records a login attempt outcome. Only the email, outcome, and IP are
 * stored — never the password.
 */
export async function recordLoginAttempt(
  db: PrismaClient,
  input: { email: string; succeeded: boolean; ip?: string },
): Promise<void> {
  await db.loginAttempt.create({
    data: {
      email: normalize(input.email),
      succeeded: input.succeeded,
      ip: input.ip ?? null,
    },
  })
}

/**
 * Returns true when the given email has reached MAX_ATTEMPTS failed logins
 * within the trailing WINDOW_MS window. Successful attempts never count,
 * and attempts older than the window are ignored (lockout self-expires).
 */
export async function isLockedOut(db: PrismaClient, email: string): Promise<boolean> {
  const failures = await db.loginAttempt.count({
    where: {
      email: normalize(email),
      succeeded: false,
      createdAt: { gte: new Date(Date.now() - WINDOW_MS) },
    },
  })
  return failures >= MAX_ATTEMPTS
}

/** Clears all recorded attempts for an email (e.g. after a manual reset). */
export async function clearAttempts(db: PrismaClient, email: string): Promise<void> {
  await db.loginAttempt.deleteMany({ where: { email: normalize(email) } })
}
