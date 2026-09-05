import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth/guard'
import { dashboard } from '@/lib/stats/rsvp'
import { StatTile } from '@/components/admin/stat-tile'
import { BarList } from '@/components/admin/bar-list'

export const dynamic = 'force-dynamic'

export default async function AdminDashboard() {
  await requireRole('ADMIN')
  const d = await dashboard(prisma)
  const rate = d.invites.total ? Math.round((d.invites.responded / d.invites.total) * 100) : 0

  return (
    <section className="space-y-10">
      <h1 className="font-serif text-2xl">Dashboard</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Invited" value={d.invites.total} hint="parties" />
        <StatTile label="Responded" value={`${rate}%`} hint={`${d.invites.responded} of ${d.invites.total}`} />
        <StatTile label="Coming" value={d.guests.attending} hint="people" />
        <StatTile label="Arrived" value={d.guests.checkedIn} hint={`of ${d.guests.attending}`} />
      </div>

      <div className="grid gap-10 lg:grid-cols-2">
        <BarList title="Responses" rows={[
          { label: 'Attending', count: d.invites.attending },
          { label: 'Partial', count: d.invites.partial },
          { label: 'Declined', count: d.invites.declined },
          { label: 'No reply', count: d.invites.pending, muted: true },
        ]} />
        <BarList title="Meals" rows={d.meals.map((m) => ({ label: m.isActive ? m.label : `${m.label} (retired)`, count: m.count, muted: !m.isActive }))} />
      </div>

      <BarList title="Responses by day" rows={d.responsesByDay.map((r) => ({ label: r.date, count: r.count }))} />
    </section>
  )
}
