import { hash, verify, Algorithm } from '@node-rs/argon2'

export const MIN_PASSWORD_LENGTH = 12

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
  return hash(plain, OPTIONS)
}

/**
 * Returns false for a malformed stored hash rather than throwing, so a
 * corrupted row denies access instead of crashing the login route.
 */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain)
  } catch {
    return false
  }
}
