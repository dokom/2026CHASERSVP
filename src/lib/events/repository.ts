import type { PrismaClient, Prisma } from '@prisma/client'
import { writeAudit } from '@/lib/audit'

export class EventNotConfiguredError extends Error {
  constructor() {
    super('No event has been configured yet')
    this.name = 'EventNotConfiguredError'
  }
}

export type AgendaItemRow = {
  id: string; startsAt: Date; title: string
  description: string | null; icon: string | null; sortOrder: number
}
export type MealOptionRow = {
  id: string; label: string; description: string | null; sortOrder: number; isActive: boolean
}
export type TableMarkerRow = { id: string; tableNumber: string; x: number; y: number }

export type EventDetail = {
  id: string; name: string; tagline: string | null
  startsAt: Date; timezone: string; venueName: string; address: string
  dressCode: string | null; rsvpDeadline: Date; floorplanAssetId: string | null
  agendaItems: AgendaItemRow[]
  mealOptions: MealOptionRow[]
  tableMarkers: TableMarkerRow[]
}

const SELECT = {
  id: true, name: true, tagline: true, startsAt: true, timezone: true,
  venueName: true, address: true, dressCode: true, rsvpDeadline: true, floorplanAssetId: true,
  agendaItems: {
    select: { id: true, startsAt: true, title: true, description: true, icon: true, sortOrder: true },
    orderBy: [{ sortOrder: 'asc' }, { startsAt: 'asc' }],
  },
  mealOptions: {
    select: { id: true, label: true, description: true, sortOrder: true, isActive: true },
    orderBy: { sortOrder: 'asc' },
  },
  tableMarkers: {
    select: { id: true, tableNumber: true, x: true, y: true },
    orderBy: { tableNumber: 'asc' },
  },
} satisfies Prisma.EventSelect

/**
 * This deployment serves one event. `findFirst` ordered oldest-first rather
 * than `findUnique` on a known id: the id is not knowable at build time, and
 * ordering means a stray second row can never shadow the real one.
 */
export async function getEvent(db: PrismaClient): Promise<EventDetail | null> {
  const event = await db.event.findFirst({ select: SELECT, orderBy: { createdAt: 'asc' } })
  return event as EventDetail | null
}

export type EventDetailsPatch = Partial<{
  name: string; tagline: string; startsAt: Date; timezone: string
  venueName: string; address: string; dressCode: string; rsvpDeadline: Date
}>

export async function updateEventDetails(
  db: PrismaClient, actorId: string | null, id: string, patch: EventDetailsPatch,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.event.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.tagline !== undefined ? { tagline: patch.tagline || null } : {}),
        ...(patch.startsAt !== undefined ? { startsAt: patch.startsAt } : {}),
        ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
        ...(patch.venueName !== undefined ? { venueName: patch.venueName } : {}),
        ...(patch.address !== undefined ? { address: patch.address } : {}),
        ...(patch.dressCode !== undefined ? { dressCode: patch.dressCode || null } : {}),
        ...(patch.rsvpDeadline !== undefined ? { rsvpDeadline: patch.rsvpDeadline } : {}),
      },
    })
    await writeAudit(tx, {
      actorId, action: 'event.update', entity: 'Event', entityId: id, meta: { ...patch },
    })
  })
}

export type AgendaItemInput = {
  id?: string; title: string; description?: string; icon?: string
  startsAt: Date; sortOrder: number
}

export async function upsertAgendaItem(
  db: PrismaClient, actorId: string | null, eventId: string, input: AgendaItemInput,
): Promise<string> {
  return db.$transaction(async (tx) => {
    const data = {
      title: input.title,
      description: input.description || null,
      icon: input.icon || null,
      startsAt: input.startsAt,
      sortOrder: input.sortOrder,
    }
    const item = input.id
      ? await tx.agendaItem.update({ where: { id: input.id }, data })
      : await tx.agendaItem.create({ data: { ...data, eventId } })

    await writeAudit(tx, {
      actorId, action: 'agendaItem.upsert', entity: 'AgendaItem', entityId: item.id,
      meta: { title: input.title, created: !input.id },
    })
    return item.id
  })
}

export async function deleteAgendaItem(
  db: PrismaClient, actorId: string | null, id: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.agendaItem.delete({ where: { id } })
    await writeAudit(tx, { actorId, action: 'agendaItem.delete', entity: 'AgendaItem', entityId: id })
  })
}

export type MealOptionInput = { id?: string; label: string; description?: string; sortOrder: number }

export async function upsertMealOption(
  db: PrismaClient, actorId: string | null, eventId: string, input: MealOptionInput,
): Promise<string> {
  return db.$transaction(async (tx) => {
    const data = {
      label: input.label,
      description: input.description || null,
      sortOrder: input.sortOrder,
    }
    const meal = input.id
      ? await tx.mealOption.update({ where: { id: input.id }, data })
      : await tx.mealOption.create({ data: { ...data, eventId } })

    await writeAudit(tx, {
      actorId, action: 'mealOption.upsert', entity: 'MealOption', entityId: meal.id,
      meta: { label: input.label, created: !input.id },
    })
    return meal.id
  })
}

/**
 * Meal options are deactivated, never deleted. A `Guest.mealOptionId` may
 * already point at one, and MongoDB has no foreign key to stop a delete from
 * stranding that reference — the guest's dinner choice would silently vanish.
 */
export async function setMealOptionActive(
  db: PrismaClient, actorId: string | null, id: string, isActive: boolean,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.mealOption.update({ where: { id }, data: { isActive } })
    await writeAudit(tx, {
      actorId, action: 'mealOption.setActive', entity: 'MealOption', entityId: id,
      meta: { isActive },
    })
  })
}
