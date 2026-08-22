export const CSRF_COOKIE = 'gala_csrf'

/**
 * 32 bytes encodes to 43 base64url characters.
 *
 * Uses Web Crypto (`crypto.getRandomValues`) rather than `node:crypto`'s
 * `randomBytes` because this function is called from `src/middleware.ts`,
 * which runs on the Edge runtime by default — `node:crypto` is not
 * available there. `crypto.getRandomValues` and `btoa` are both standard
 * Web APIs available in Node 22 and on Edge, so the same implementation
 * works in every runtime this project targets.
 */
export function issueCsrfToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toBase64Url(bytes)
}

/** `Buffer` is unavailable on Edge, so base64url-encode via Web APIs only. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Double-submit verification: the cookie value must equal the value posted in
 * the form body. Compared in constant time.
 *
 * Runs only inside Server Actions on the Node.js runtime, so it is free to
 * use `node:crypto`'s `timingSafeEqual` and `Buffer`. Both are imported
 * lazily, inside the function body, rather than as a top-level
 * `import … from 'node:crypto'`: this same module is also imported by
 * `src/middleware.ts` (for `issueCsrfToken`), which is bundled for the Edge
 * runtime. A top-level `node:crypto` import gets evaluated eagerly as soon
 * as the Edge bundle loads — even though the Edge code path never calls
 * this function — and `node:crypto` does not exist there, which crashes
 * every `/admin` request. Requiring it inside the function defers loading
 * until `verifyCsrfToken` actually runs, which only happens on Node.
 */
export function verifyCsrfToken(cookieValue: string | undefined, formValue: unknown): boolean {
  if (!cookieValue || typeof formValue !== 'string' || formValue.length === 0) return false
  const { timingSafeEqual } = require('node:crypto') as typeof import('node:crypto')
  const a = Buffer.from(cookieValue)
  const b = Buffer.from(formValue)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
