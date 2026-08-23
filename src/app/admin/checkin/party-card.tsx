'use client'

import type { Party, PartyGuest } from '@/lib/checkin/repository'

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

export function PartyCard({
  party, pending, onCheckIn, onUndo,
}: {
  party: Party
  /** guest ids queued but not yet confirmed by the server */
  pending: Set<string>
  onCheckIn: (guest: PartyGuest) => void
  onUndo: (guest: PartyGuest) => void
}) {
  return (
    <section aria-labelledby="party-heading" className="space-y-3">
      <h2 id="party-heading" className="font-serif text-2xl">
        {party.label}
        {party.tableNumber ? <span className="ml-3 text-[var(--brass-ink)]">Table {party.tableNumber}</span> : null}
      </h2>
      <ul className="space-y-2">
        {party.guests.map((guest) => {
          const arrived = guest.checkedInAt !== null
          const queued = pending.has(guest.id)
          return (
            <li key={guest.id}>
              <button
                type="button"
                onClick={() => (arrived ? onUndo(guest) : onCheckIn(guest))}
                aria-pressed={arrived}
                className={`flex min-h-14 w-full items-center justify-between rounded-lg border px-4 py-3 text-left ${
                  arrived ? 'border-[var(--brass)] bg-[var(--surface)]' : 'border-[var(--color-border)]'
                }`}
              >
                <span>
                  <span className="block text-lg">{guest.badgeName || `${guest.firstName} ${guest.lastName}`}</span>
                  {guest.company ? <span className="block text-sm text-[var(--text-muted)]">{guest.company}</span> : null}
                  {guest.attending === false ? (
                    <span className="block text-xs text-[var(--danger)]">Declined on RSVP</span>
                  ) : null}
                </span>
                <span className="text-right text-sm">
                  {arrived ? (
                    <>
                      <span className="block text-[var(--brass-ink)]">✓ {formatTime(guest.checkedInAt!.toString())}</span>
                      <span className="block text-xs text-[var(--text-muted)]">{queued ? 'will sync' : 'tap to undo'}</span>
                    </>
                  ) : (
                    <span className="text-[var(--text-muted)]">Tap to check in</span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
