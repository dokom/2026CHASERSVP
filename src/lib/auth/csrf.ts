/** Double-submit cookie for the authenticated `/admin` surface. Unchanged name and path. */
export const CSRF_COOKIE = 'gala_csrf'

/**
 * Double-submit cookie for the unauthenticated `/i` guest RSVP surface.
 *
 * Deliberately a *different* cookie, not a shared one: the guest page renders
 * its CSRF token into the page's HTML (it has to — there is no Server Action
 * boundary to hide it behind on an unauthenticated GET), and anything an
 * unauthenticated visitor's browser receives must never be the same secret
 * that double-submit-protects `/admin` mutations. See `src/proxy.ts` for
 * the non-overlapping cookie `path` that keeps the two off each other's routes.
 */
export const GUEST_CSRF_COOKIE = 'gala_guest_csrf'

/**
 * 32 bytes encodes to 43 base64url characters.
 *
 * Uses Web Crypto (`crypto.getRandomValues`) rather than `node:crypto`'s
 * `randomBytes` because this function is called from `src/proxy.ts`,
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
 * Constant-time equality over code units.
 *
 * Both inputs are base64url ASCII (see `issueCsrfToken`), so comparing
 * `charCodeAt` values is exact — no `Buffer` or `TextEncoder` needed, which
 * keeps this correct on both Node and the Edge runtime.
 *
 * Every code unit is compared, even after a difference is found: the XOR of
 * mismatched units is accumulated with `|=` and only tested once, at the
 * end, rather than returning as soon as a mismatch appears. An early return
 * on the first differing byte is exactly the timing side-channel this
 * function exists to close.
 *
 * A length mismatch *does* return early — that is safe here specifically
 * because the length isn't secret: CSRF tokens are a fixed, public 43
 * characters (see `issueCsrfToken`), so leaking "the lengths differ" tells
 * an attacker nothing they didn't already know. Do not reuse this early
 * return for comparisons where length itself is sensitive.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

/**
 * Double-submit verification: the cookie value must equal the value posted in
 * the form body. Compared in constant time.
 *
 * Runs only inside Server Actions on the Node.js runtime, but this module is
 * also imported by `src/proxy.ts`, which is bundled for the Edge
 * runtime. Using `constantTimeEqual` instead of `node:crypto`'s
 * `timingSafeEqual` means there is nothing Node-specific here, so this
 * function works unchanged on either runtime and needs no lazy `require`.
 */
export function verifyCsrfToken(cookieValue: string | undefined, formValue: unknown): boolean {
  if (!cookieValue || typeof formValue !== 'string' || formValue.length === 0) return false
  return constantTimeEqual(cookieValue, formValue)
}
