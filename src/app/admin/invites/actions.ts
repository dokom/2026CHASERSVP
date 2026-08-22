'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { requireCsrf, requireRole } from '@/lib/auth/guard'
import {
  createInvite, updateInvite, deleteInvite, regenerateInviteToken,
  resolveExtraSeats, SeatLimitError,
} from '@/lib/invites/repository'
import {
  createInviteSchema, updateInviteSchema, INVITE_REVEAL_COOKIE, INVITE_REVEAL_SEEN_COOKIE,
} from '@/lib/validation/invites'
import { inviteUrl } from '@/lib/invites/qr'

/** MongoDB ObjectId — 24 lowercase hex characters. */
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/

function isValidId(id: string): boolean {
  return OBJECT_ID_PATTERN.test(id)
}

/** Seconds the one-shot reveal cookie (and its "seen" marker) stay valid. */
const REVEAL_MAX_AGE_SECONDS = 60

function revealCookiePath(id: string): string {
  return `/admin/invites/${id}`
}

function failTo(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`)
}

function describe(error: unknown): string {
  if (error instanceof SeatLimitError) return error.message
  return 'Something went wrong. Try again.'
}

export async function createInviteAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const parsed = createInviteSchema.safeParse({
    label: formData.get('label'),
    seatsAllotted: formData.get('seatsAllotted'),
    tableNumber: formData.get('tableNumber') ?? '',
    adminNotes: '',
    primaryGuest: {
      firstName: formData.get('firstName'),
      lastName: formData.get('lastName'),
      email: formData.get('email') ?? '',
      company: formData.get('company') ?? '',
      title: formData.get('title') ?? '',
    },
  })
  if (!parsed.success) {
    failTo('/admin/invites', parsed.error.issues[0]?.message ?? 'Invalid invite')
  }

  await createInvite(prisma, actor.id, parsed.data)
  revalidatePath('/admin/invites')
}

export async function updateInviteAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const id = String(formData.get('id') ?? '')
  if (!isValidId(id)) failTo('/admin/invites', 'Invalid invite id')

  const parsed = updateInviteSchema.safeParse({
    label: formData.get('label'),
    seatsAllotted: formData.get('seatsAllotted'),
    tableNumber: formData.get('tableNumber') ?? '',
    adminNotes: formData.get('adminNotes') ?? '',
  })
  if (!parsed.success) {
    failTo(`/admin/invites/${id}`, parsed.error.issues[0]?.message ?? 'Invalid change')
  }

  try {
    await updateInvite(prisma, actor.id, id, parsed.data)
  } catch (error) {
    failTo(`/admin/invites/${id}`, describe(error))
  }
  revalidatePath(`/admin/invites/${id}`)
}

export async function deleteInviteAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const id = String(formData.get('id') ?? '')
  if (!isValidId(id)) failTo('/admin/invites', 'Invalid invite id')

  try {
    await deleteInvite(prisma, actor.id, id)
  } catch (error) {
    failTo(`/admin/invites/${id}`, describe(error))
  }
  redirect('/admin/invites')
}

/**
 * Regenerates the token and hands the plaintext to the next render through a
 * one-shot, httpOnly cookie instead of the URL — see `INVITE_REVEAL_COOKIE`.
 * The redirect target is the BARE detail path with no query string, so the
 * credential never touches the `Location` header, browser history, or any
 * proxy/platform access log. It is never persisted server-side.
 */
export async function regenerateTokenAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const id = String(formData.get('id') ?? '')
  if (!isValidId(id)) failTo('/admin/invites', 'Invalid invite id')

  const token = await regenerateInviteToken(prisma, actor.id, id)
  const url = inviteUrl(token, getEnv().APP_URL)

  const store = await cookies()
  store.set({
    name: INVITE_REVEAL_COOKIE,
    value: url,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: revealCookiePath(id),
    maxAge: REVEAL_MAX_AGE_SECONDS,
  })
  // A brand new token deserves its own full one-shot window — clear any
  // "seen" marker left over from a previous reveal on this same invite.
  store.delete({ name: INVITE_REVEAL_SEEN_COOKIE, path: revealCookiePath(id) })

  redirect(revealCookiePath(id))
}

export async function resolveExtraSeatsAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const id = String(formData.get('id') ?? '')
  if (!isValidId(id)) failTo('/admin/invites', 'Invalid invite id')

  const decision = formData.get('decision') === 'APPROVED' ? 'APPROVED' : 'DENIED'
  try {
    await resolveExtraSeats(prisma, actor.id, id, decision)
  } catch (error) {
    failTo(`/admin/invites/${id}`, describe(error))
  }
  revalidatePath(`/admin/invites/${id}`)
}
