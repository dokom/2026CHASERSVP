import { z } from 'zod'

export const resolveSchema = z.object({ token: z.string().min(1).max(64) })
export const checkInSchema = z.object({ at: z.coerce.date() })
export const guestIdSchema = z.string().regex(/^[0-9a-f]{24}$/)

/**
 * A QR code encodes https://<host>/i/<token>. Accept only that shape, on our
 * own host, so a scanned code for some other site cannot be posted as a token.
 */
export function extractToken(scanned: string, appUrl: string): string | null {
  let url: URL
  try { url = new URL(scanned.trim()) } catch { return null }
  const app = new URL(appUrl)
  if (url.origin !== app.origin) return null
  const match = /^\/i\/([A-Za-z0-9_-]{32})\/?$/.exec(url.pathname)
  return match?.[1] ?? null
}
