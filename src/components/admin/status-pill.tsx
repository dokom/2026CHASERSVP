import type { InviteStatus } from '@/lib/invites/status'

// Borders use the literal fill colour (non-text UI only needs 3:1); labels
// use the darker "-ink" variant (text needs the 4.5:1 WCAG AA floor, which
// --color-danger/--color-success fail against the light-theme ground — see
// globals.css's --danger-ink/--success-ink for the verified ratios).
const STYLES: Record<InviteStatus, string> = {
  PENDING: 'border-[var(--color-border)] text-[var(--color-text-muted)]',
  ATTENDING: 'border-[var(--color-success)] text-[var(--success-ink)]',
  DECLINED: 'border-[var(--color-danger)] text-[var(--danger-ink)]',
  PARTIAL: 'border-[var(--color-accent)] text-[var(--accent-ink)]',
}

export function StatusPill({ status }: { status: InviteStatus }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${STYLES[status]}`}>
      {status.toLowerCase()}
    </span>
  )
}
