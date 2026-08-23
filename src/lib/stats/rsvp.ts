import type { PrismaClient } from '@prisma/client'
import { checkInProgress } from '@/lib/checkin/repository'

export type Dashboard = {
  invites: { total: number; responded: number; attending: number; declined: number; partial: number; pending: number }
  guests: { attending: number; checkedIn: number }
  meals: { label: string; count: number; isActive: boolean }[]
  responsesByDay: { date: string; count: number }[]
  pendingExtraSeats: number
}

const day = (d: Date) => d.toISOString().slice(0, 10)

export async function dashboard(db: PrismaClient): Promise<Dashboard> {
  const [byStatus, guests, meals, mealCounts, responded, pendingExtraSeats] = await Promise.all([
    db.invite.groupBy({ by: ['status'], _count: { _all: true } }),
    checkInProgress(db),
    db.mealOption.findMany({ select: { id: true, label: true, isActive: true }, orderBy: { sortOrder: 'asc' } }),
    // Only people who are coming eat. Retired options still count: the choice was made.
    db.guest.groupBy({ by: ['mealOptionId'], where: { attending: true, mealOptionId: { not: null } }, _count: { _all: true } }),
    db.invite.findMany({ where: { respondedAt: { not: null } }, select: { respondedAt: true }, orderBy: { respondedAt: 'asc' } }),
    db.invite.count({ where: { extraSeatsStatus: 'PENDING' } }),
  ])

  const count = (status: string) => byStatus.find((s) => s.status === status)?._count._all ?? 0
  const attending = count('ATTENDING'), declined = count('DECLINED'), partial = count('PARTIAL'), pending = count('PENDING')

  const countsByMeal = new Map(mealCounts.map((m) => [m.mealOptionId, m._count._all]))
  const byDay = new Map<string, number>()
  for (const r of responded) {
    const key = day(r.respondedAt!)
    byDay.set(key, (byDay.get(key) ?? 0) + 1)
  }

  return {
    invites: { total: attending + declined + partial + pending, responded: attending + declined + partial, attending, declined, partial, pending },
    guests,
    meals: meals.map((m) => ({ label: m.label, count: countsByMeal.get(m.id) ?? 0, isActive: m.isActive })),
    responsesByDay: [...byDay.entries()].map(([date, c]) => ({ date, count: c })),
    pendingExtraSeats,
  }
}
