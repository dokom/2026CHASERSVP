import Link from 'next/link'
import { hasRole, type Role } from '@/lib/auth/roles'

export const NAV_ITEMS: { href: string; label: string; minRole: Role }[] = [
  { href: '/admin', label: 'Dashboard', minRole: 'ADMIN' },
  { href: '/admin/invites', label: 'Invites', minRole: 'ADMIN' },
  { href: '/admin/guests', label: 'Guests', minRole: 'ADMIN' },
  { href: '/admin/event', label: 'Event', minRole: 'ADMIN' },
  { href: '/admin/checkin', label: 'Check-in', minRole: 'STAFF' },
  { href: '/admin/users', label: 'Admin users', minRole: 'OWNER' },
  { href: '/admin/audit', label: 'Audit log', minRole: 'OWNER' },
]

export function AdminNav({ role }: { role: Role }) {
  return (
    <nav aria-label="Admin navigation" className="flex flex-wrap gap-1">
      {NAV_ITEMS.filter((item) => hasRole(role, item.minRole)).map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="rounded px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
