import { PrismaClient } from '@prisma/client'
import { createAdminUser } from '../src/lib/admin-users/repository'
import { createInvite } from '../src/lib/invites/repository'
import { getEnv } from '../src/lib/env'

export type SeedEnv = { ADMIN_SEED_EMAIL: string; ADMIN_SEED_PASSWORD: string }
export type SeedSummary = { ownerCreated: boolean; eventCreated: boolean; invitesCreated: number }

/** Placeholder event content. Replace via the admin Event screen, not by editing this file. */
const EVENT = {
  name: 'The 2026 Annual Gala',
  tagline: 'An evening of recognition',
  startsAt: new Date('2026-11-14T18:00:00Z'),
  timezone: 'America/New_York',
  venueName: 'The Grand Hall',
  address: '1 Placeholder Avenue, New York, NY',
  dressCode: 'Black tie',
  rsvpDeadline: new Date('2026-10-24T23:59:00Z'),
}

const AGENDA = [
  { title: 'Cocktail reception', startsAt: new Date('2026-11-14T18:00:00Z'), description: 'Champagne and canapés in the atrium.' },
  { title: 'Dinner service', startsAt: new Date('2026-11-14T19:00:00Z'), description: 'Seated dinner in the Grand Hall.' },
  { title: 'Awards programme', startsAt: new Date('2026-11-14T20:30:00Z'), description: 'Recognition of the year.' },
  { title: 'After-party', startsAt: new Date('2026-11-14T22:00:00Z'), description: 'Live music in the mezzanine bar.' },
]

const MEALS = [
  { label: 'Beef', description: 'Braised short rib with root vegetables' },
  { label: 'Fish', description: 'Pan-seared halibut with fennel' },
  { label: 'Vegetarian', description: 'Wild mushroom risotto' },
  { label: 'Vegan', description: 'Charred aubergine with tahini and grains' },
]

const SAMPLE_INVITES = [
  { label: 'Reyes Party', seatsAllotted: 2, tableNumber: '4', primaryGuest: { firstName: 'Jordan', lastName: 'Reyes', email: 'jordan.reyes@example.com', company: 'Northwind', title: 'VP Operations' } },
  { label: 'Okafor Party', seatsAllotted: 4, tableNumber: '7', primaryGuest: { firstName: 'Ada', lastName: 'Okafor', email: 'ada.okafor@example.com', company: 'Acme Corp', title: 'Chief Counsel' } },
  { label: 'Lindqvist Party', seatsAllotted: 1, tableNumber: '2', primaryGuest: { firstName: 'Mira', lastName: 'Lindqvist', email: 'mira.lindqvist@example.com', company: 'Helios', title: 'Director of Research' } },
]

export async function seed(db: PrismaClient, env: SeedEnv): Promise<SeedSummary> {
  const email = env.ADMIN_SEED_EMAIL.trim().toLowerCase()

  let ownerCreated = false
  if (!(await db.adminUser.findUnique({ where: { email }, select: { id: true } }))) {
    const owner = await createAdminUser(db, null, {
      email,
      name: 'Event Owner',
      role: 'OWNER',
      password: env.ADMIN_SEED_PASSWORD,
    })
    await db.adminUser.update({ where: { id: owner.id }, data: { mustChangePassword: true } })
    ownerCreated = true
  }

  let eventCreated = false
  if ((await db.event.count()) === 0) {
    await db.event.create({
      data: {
        ...EVENT,
        agendaItems: { create: AGENDA.map((item, index) => ({ ...item, sortOrder: index })) },
        mealOptions: { create: MEALS.map((meal, index) => ({ ...meal, sortOrder: index })) },
      },
    })
    eventCreated = true
  }

  let invitesCreated = 0
  if ((await db.invite.count()) === 0) {
    for (const invite of SAMPLE_INVITES) {
      await createInvite(db, null, invite)
      invitesCreated++
    }
  }

  return { ownerCreated, eventCreated, invitesCreated }
}

if (process.argv[1]?.includes('seed')) {
  const prisma = new PrismaClient()
  seed(prisma, getEnv())
    .then((summary) => {
      console.log('Seed complete:', summary)
    })
    .catch((error: unknown) => {
      console.error('Seed failed:', error)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
