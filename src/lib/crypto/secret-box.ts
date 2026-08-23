import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'

export class SealError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SealError'
  }
}

const VERSION = 'v1'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32
/** Fixed salt: this vault uses a single high-entropy application secret with
 *  no multi-tenant key separation requirement, so a shared salt is safe. */
const SALT = 'gala-rsvp-token-vault'

const keyCache = new Map<string, Buffer>()

function cacheKeyFor(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

export function deriveKey(secret: string): Buffer {
  const cacheKey = cacheKeyFor(secret)
  const cached = keyCache.get(cacheKey)
  if (cached) return cached
  const key = scryptSync(secret, SALT, KEY_BYTES)
  keyCache.set(cacheKey, key)
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
  if (version !== VERSION) throw new SealError('Unsupported seal version')

  const iv = Buffer.from(ivPart, 'base64url')
  const authTag = Buffer.from(tagPart, 'base64url')
  // Reject non-standard-length envelopes before decrypting. Node's
  // setAuthTag() accepts 4/8/12-16 byte GCM tags by default, which would
  // otherwise let a truncated tag reduce forgery to trivial work.
  if (iv.length !== IV_BYTES) throw new SealError('Invalid IV length')
  if (authTag.length !== TAG_BYTES) throw new SealError('Invalid auth tag length')

  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), iv, {
      authTagLength: TAG_BYTES,
    })
    decipher.setAuthTag(authTag)
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw new SealError('Could not open sealed value')
  }
}
