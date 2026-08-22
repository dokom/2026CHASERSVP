import { requireRole } from '@/lib/auth/guard'

export default async function CheckinPage() {
  await requireRole('STAFF')
  return (
    <section>
      <h1 className="font-serif text-2xl">Check-in</h1>
      <p className="mt-2 text-[var(--color-text-muted)]">Scanner arrives in a later phase.</p>
    </section>
  )
}
