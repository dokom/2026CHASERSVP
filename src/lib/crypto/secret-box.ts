import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

export class SealError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SealError'
  }
}

const VERSION = 'v1'
const IV_BYTES = 12
const KEY_BYTES = 32
/** Fixed salt: the secret is already high-entropy, and a per-value salt would
 *  force a scrypt derivation on every read. */
const SALT = 'gala-rsvp-token-vault'

const keyCache = new Map<string, Buffer>()

export function deriveKey(secret: string): Buffer {
  const cached = keyCache.get(secret)
  if (cached) return cached
  const key = scryptSync(secret, SALT, KEY_BYTES)
  keyCache.set(secret, key)
  return key
}

export function seal(plaintext: string, secret: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

export function open(sealed: string, secret: string): string {
  const parts = sealed.split('.')
  if (parts.length !== 4) throw new SealError('Malformed sealed value')

  const [version, ivPart, tagPart, dataPart] = parts as [string, string, string, string]
  if (version !== VERSION) throw new SealError(`Unsupported seal version: ${version}`)

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveKey(secret),
      Buffer.from(ivPart, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw new SealError('Could not open sealed value')
  }
}
