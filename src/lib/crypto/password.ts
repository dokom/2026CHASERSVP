import { hash, verify, Algorithm } from '@node-rs/argon2'

export const MIN_PASSWORD_LENGTH = 12
export const MAX_PASSWORD_LENGTH = 128

const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  if (plain.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`)
  }
  return hash(plain, OPTIONS)
}

/**
 * Returns false rather than throwing on a malformed stored hash, an
 * over-length input, or an argon2 failure, so bad input denies access
 * instead of crashing the login route (fail-closed).
 *
 * Over-length input is rejected BEFORE argon2 runs: the login route calls
 * verify (not hash) on untrusted input, so this is the path that matters for
 * preventing a cheap unauthenticated memory-cost DoS.
 *
 * On an unexpected argon2 failure, only the error's class/name is logged —
 * never the password, the stored hash, or the full error message — so
 * operators get a signal without leaking sensitive data.
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  if (plain.length > MAX_PASSWORD_LENGTH) return false
  try {
    return await verify(storedHash, plain)
  } catch (error) {
    const errorClass = error instanceof Error ? error.name : typeof error
    console.error(`verifyPassword failed: ${errorClass}`)
    return false
  }
}
