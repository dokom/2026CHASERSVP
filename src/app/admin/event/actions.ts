'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireCsrf, requireRole } from '@/lib/auth/guard'
import {
  getEvent, updateEventDetails, upsertAgendaItem, deleteAgendaItem,
  upsertMealOption, setMealOptionActive, setSeatsReleased,
} from '@/lib/events/repository'
import { eventDetailsSchema, agendaItemSchema, mealOptionSchema } from '@/lib/validation/event'

const objectIdPattern = /^[0-9a-f]{24}$/

function fail(message: string): never {
  redirect(`/admin/event?error=${encodeURIComponent(message)}`)
}

function requireId(formData: FormData, field = 'id'): string {
  const value = String(formData.get(field) ?? '')
  if (!objectIdPattern.test(value)) fail('That record could not be found.')
  return value
}

export async function saveEventAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const parsed = eventDetailsSchema.safeParse({
    name: formData.get('name'),
    tagline: formData.get('tagline') ?? '',
    startsAt: formData.get('startsAt'),
    timezone: formData.get('timezone') || 'UTC',
    venueName: formData.get('venueName'),
    address: formData.get('address'),
    dressCode: formData.get('dressCode') ?? '',
    rsvpDeadline: formData.get('rsvpDeadline'),
  })
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? 'Check the event details.')

  const existing = await getEvent(prisma)
  if (existing) {
    await updateEventDetails(prisma, actor.id, existing.id, parsed.data)
  } else {
    await prisma.event.create({ data: parsed.data })
  }
  revalidatePath('/admin/event')
}

/**
 * Releases (or hides again) every guest's table. Guests only ever see a
 * table once they have confirmed, so releasing early is safe — an
 * unconfirmed guest keeps seeing the countdown.
 */
export async function setSeatsReleasedAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const event = await getEvent(prisma)
  if (!event) fail('Create the event before releasing seating.')

  const released = formData.get('released') === 'true'
  await setSeatsReleased(prisma, actor.id, event.id, released)
  revalidatePath('/admin/event')
}

export async function saveAgendaItemAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const event = await getEvent(prisma)
  if (!event) fail('Create the event before adding agenda items.')

  const rawId = String(formData.get('id') ?? '')
  const parsed = agendaItemSchema.safeParse({
    id: rawId || undefined,
    title: formData.get('title'),
    description: formData.get('description') ?? '',
    icon: formData.get('icon') ?? '',
    startsAt: formData.get('startsAt'),
    sortOrder: formData.get('sortOrder') ?? 0,
  })
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? 'Check the agenda item.')

  await upsertAgendaItem(prisma, actor.id, event.id, parsed.data)
  revalidatePath('/admin/event')
}

export async function deleteAgendaItemAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)
  await deleteAgendaItem(prisma, actor.id, requireId(formData))
  revalidatePath('/admin/event')
}

export async function saveMealOptionAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const event = await getEvent(prisma)
  if (!event) fail('Create the event before adding meal options.')

  const rawId = String(formData.get('id') ?? '')
  const parsed = mealOptionSchema.safeParse({
    id: rawId || undefined,
    label: formData.get('label'),
    description: formData.get('description') ?? '',
    sortOrder: formData.get('sortOrder') ?? 0,
  })
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? 'Check the meal option.')

  await upsertMealOption(prisma, actor.id, event.id, parsed.data)
  revalidatePath('/admin/event')
}

export async function toggleMealOptionAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)
  const isActive = formData.get('isActive') === 'true'
  await setMealOptionActive(prisma, actor.id, requireId(formData), isActive)
  revalidatePath('/admin/event')
}
