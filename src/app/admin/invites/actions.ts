'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { requireCsrf, requireRole } from '@/lib/auth/guard'
import { createInvite, updateInvite, deleteInvite, regenerateInviteToken } from '@/lib/invites/repository'
import {
  createInviteSchema, updateInviteSchema, createPlaceholdersSchema, inviteGuestSchema,
  INVITE_REVEAL_COOKIE, INVITE_REVEAL_SEEN_COOKIE,
} from '@/lib/validation/invites'
import { inviteUrl } from '@/lib/invites/qr'
import { createPlaceholderInvites } from '@/lib/invites/placeholders'
import {
  addGuest, updateGuest, removeGuest, GuestCheckedInError, GuestNotOnInviteError,
} from '@/lib/invites/guests'

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

/**
 * Two admins creating invites in the same instant race for the same invite
 * number; the unique index rejects the loser (Prisma P2002) and MongoDB may
 * also abort the second transaction with a write conflict. Either way the
 * loser's transaction rolled back cleanly — they just need to submit again.
 */
function isConcurrentWriteError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as { code?: unknown }).code
  return code === 'P2002' || code === 'P2034' || /write conflict/i.test(error.message)
}

function describe(error: unknown): string {
  if (error instanceof GuestCheckedInError) return error.message
  if (error instanceof GuestNotOnInviteError) return error.message
  if (isConcurrentWriteError(error)) return 'Someone else changed this at the same moment. Try again.'
  return 'Something went wrong. Try again.'
}

function guestDetails(formData: FormData) {
  return {
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    email: formData.get('email') ?? '',
    company: formData.get('company') ?? '',
    title: formData.get('title') ?? '',
    tableNumber: formData.get('tableNumber') ?? '',
  }
}

export async function createPlaceholdersAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const parsed = createPlaceholdersSchema.safeParse({
    count: formData.get('count'),
    seatsAllotted: formData.get('seatsAllotted'),
  })
  if (!parsed.success) {
    failTo('/admin/invites', parsed.error.issues[0]?.message ?? 'Invalid placeholder batch')
  }

  try {
    await createPlaceholderInvites(prisma, actor.id, parsed.data)
  } catch (error) {
    failTo('/admin/invites', describe(error))
  }
  revalidatePath('/admin/invites')
}

export async function addGuestAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const id = String(formData.get('id') ?? '')
  if (!isValidId(id)) failTo('/admin/invites', 'Invalid invite id')

  const parsed = inviteGuestSchema.safeParse(guestDetails(formData))
  if (!parsed.success) {
    failTo(`/admin/invites/${id}`, parsed.error.issues[0]?.message ?? 'Check the guest details')
  }

  try {
    await addGuest(prisma, actor.id, id, parsed.data)
  } catch (error) {
    failTo(`/admin/invites/${id}`, describe(error))
  }
  revalidatePath(`/admin/invites/${id}`)
}

export async function updateGuestAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const id = String(formData.get('id') ?? '')
  const guestId = String(formData.get('guestId') ?? '')
  if (!isValidId(id) || !isValidId(guestId)) failTo('/admin/invites', 'Invalid guest id')

  const parsed = inviteGuestSchema.safeParse(guestDetails(formData))
  if (!parsed.success) {
    failTo(`/admin/invites/${id}`, parsed.error.issues[0]?.message ?? 'Check the guest details')
  }

  try {
    await updateGuest(prisma, actor.id, id, guestId, parsed.data)
  } catch (error) {
    failTo(`/admin/invites/${id}`, describe(error))
  }
  revalidatePath(`/admin/invites/${id}`)
}

export async function removeGuestAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const id = String(formData.get('id') ?? '')
  const guestId = String(formData.get('guestId') ?? '')
  if (!isValidId(id) || !isValidId(guestId)) failTo('/admin/invites', 'Invalid guest id')

  try {
    await removeGuest(prisma, actor.id, id, guestId)
  } catch (error) {
    failTo(`/admin/invites/${id}`, describe(error))
  }
  revalidatePath(`/admin/invites/${id}`)
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

  try {
    await createInvite(prisma, actor.id, parsed.data)
  } catch (error) {
    failTo('/admin/invites', describe(error))
  }
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
