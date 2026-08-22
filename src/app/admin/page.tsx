import { requireRole } from '@/lib/auth/guard'

export default async function AdminDashboard() {
  const user = await requireRole('ADMIN')
  return (
    <section>
      <h1 className="font-serif text-2xl">Dashboard</h1>
      <p className="mt-2 text-[var(--color-text-muted)]">
        Signed in as {user.email}. Live counts arrive in a later phase.
      </p>
    </section>
  )
}
