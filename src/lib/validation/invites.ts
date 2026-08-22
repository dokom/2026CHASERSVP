import { z } from 'zod'

/**
 * Name of the one-shot, httpOnly cookie that carries a freshly regenerated
 * invite token from `regenerateTokenAction` to the next render of the
 * invite detail page. The token is a credential — anyone holding it can
 * view and edit that party's RSVP — so it must never ride in the redirect
 * URL: a query string lands in the `Location` response header, the browser
 * address bar/history, and every reverse-proxy/platform access log.
 *
 * Defined here (not in `actions.ts`) because a `'use server'` file may only
 * export async functions — Next's build rejects any other export from it.
 */
export const INVITE_REVEAL_COOKIE = 'gala_invite_reveal'

/**
 * Companion, non-secret marker cookie. It carries no credential (just the
 * literal "1") and is written client-side, synchronously, by an inline
 * script in `[id]/page.tsx` the instant the reveal renders. Its presence
 * tells the NEXT render of the same page to suppress the reveal block even
 * though `INVITE_REVEAL_COOKIE` is technically still valid for the rest of
 * its short lifetime — this is what makes the reveal "shown once" rather
 * than "shown until a timer expires".
 */
export const INVITE_REVEAL_SEEN_COOKIE = 'gala_invite_reveal_seen'

export const primaryGuestSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName: z.string().trim().min(1, 'Last name is required').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email').optional().or(z.literal('')),
  company: z.string().trim().max(160).optional().or(z.literal('')),
  title: z.string().trim().max(160).optional().or(z.literal('')),
})

export const createInviteSchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(160),
  seatsAllotted: z.coerce.number().int().min(1, 'At least one seat').max(20),
  tableNumber: z.string().trim().max(20).optional().or(z.literal('')),
  adminNotes: z.string().trim().max(2000).optional().or(z.literal('')),
  primaryGuest: primaryGuestSchema,
})

export const updateInviteSchema = z.object({
  label: z.string().trim().min(1).max(160).optional(),
  seatsAllotted: z.coerce.number().int().min(1).max(20).optional(),
  tableNumber: z.string().trim().max(20).optional(),
  adminNotes: z.string().trim().max(2000).optional(),
})

/**
 * Mirrors `ImportRow` from `src/lib/invites/csv.ts` exactly. The CSV preview
 * step validates each row and serializes the survivors into a hidden form
 * field; the commit step is a SEPARATE request, so nothing carries integrity
 * between the two. This schema re-validates the decoded payload at the
 * commit boundary instead of trusting a bare cast of client-supplied JSON.
 */
export const importRowSchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(160),
  seatsAllotted: z.coerce.number().int().min(1, 'At least one seat').max(20),
  tableNumber: z.string().trim().max(20),
  adminNotes: z.string().trim().max(2000),
  primaryGuest: z.object({
    firstName: z.string().trim().min(1, 'First name is required').max(80),
    lastName: z.string().trim().min(1, 'Last name is required').max(80),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .refine((value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), 'Enter a valid email'),
    company: z.string().trim().max(160),
    title: z.string().trim().max(160),
  }),
})

export const inviteQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['PENDING', 'ATTENDING', 'DECLINED', 'PARTIAL']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})
