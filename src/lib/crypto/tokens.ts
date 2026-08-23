import { randomBytes, createHash } from 'node:crypto'

/** 24 bytes = 192 bits of entropy, encoding to exactly 32 base64url characters. */
export const TOKEN_BYTE_LENGTH = 24

/**
 * Generates an opaque invite token. The plaintext is shown to an operator
 * exactly once (when a QR code is rendered) and is never persisted.
 */
export function generateInviteToken(): string {
  return randomBytes(TOKEN_BYTE_LENGTH).toString('base64url')
}

/**
 * Hashes a token for storage and lookup. Only the hash is persisted, so a
 * database leak does not yield working invite links.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}
