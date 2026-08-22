import { requireRole } from '@/lib/auth/guard'

// Placeholder that proves the OWNER-only route exists and is gated. Real
// admin user management is built in a later task. See task-13-report.md for
// why this file exists outside the brief's literal file list: Next's App
// Router does not route unmatched nested paths through ancestor layouts, so
// `requireRole` needs a page to run in for `/admin/users` to redirect an
// anonymous visitor, matching the `checkin/page.tsx` placeholder pattern.
export default async function AdminUsersPage() {
  await requireRole('OWNER')
  return (
    <section>
      <h1 className="font-serif text-2xl">Admin users</h1>
      <p className="mt-2 text-[var(--color-text-muted)]">User management arrives in a later phase.</p>
    </section>
  )
}
