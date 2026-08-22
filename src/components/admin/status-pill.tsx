import type { InviteStatus } from '@/lib/invites/status'

const STYLES: Record<InviteStatus, string> = {
  PENDING: 'border-[var(--color-border)] text-[var(--color-text-muted)]',
  ATTENDING: 'border-[var(--color-success)] text-[var(--color-success)]',
  DECLINED: 'border-[var(--color-danger)] text-[var(--color-danger)]',
  PARTIAL: 'border-[var(--color-brass)] text-[var(--brass-ink)]',
}

export function StatusPill({ status }: { status: InviteStatus }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${STYLES[status]}`}>
      {status.toLowerCase()}
    </span>
  )
}
