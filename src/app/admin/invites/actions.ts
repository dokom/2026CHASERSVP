'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { requireCsrf, requireRole } from '@/lib/auth/guard'
import {
  createInvite, updateInvite, deleteInvite, regenerateInviteToken,
  resolveExtraSeats, SeatLimitError,
} from '@/lib/invites/repository'
import { createInviteSchema, updateInviteSchema } from '@/lib/validation/invites'
import { inviteUrl } from '@/lib/invites/qr'

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
  await deleteInvite(prisma, actor.id, String(formData.get('id') ?? ''))
  redirect('/admin/invites')
}

/**
 * Regenerates the token and redirects with the plaintext in the query string so
 * the operator can copy it once. It is never persisted and never re-displayed.
 */
export async function regenerateTokenAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const id = String(formData.get('id') ?? '')
  const token = await regenerateInviteToken(prisma, actor.id, id)
  const url = inviteUrl(token, getEnv().APP_URL)
  redirect(`/admin/invites/${id}?inviteUrl=${encodeURIComponent(url)}`)
}

export async function resolveExtraSeatsAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const id = String(formData.get('id') ?? '')
  const decision = formData.get('decision') === 'APPROVED' ? 'APPROVED' : 'DENIED'
  await resolveExtraSeats(prisma, actor.id, id, decision)
  revalidatePath(`/admin/invites/${id}`)
}
