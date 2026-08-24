'use client'

import { useActionState, useState } from 'react'
import { GuestToggle } from '@/components/guest/guest-toggle'
import { Sealed } from '@/components/motion/sealed'
import type { GuestInvite } from '@/lib/guest/resolve'
import { submitRsvpAction, type RsvpFormState } from './actions'

const INITIAL: RsvpFormState = { status: 'idle' }

type Selection = Readonly<Record<number, boolean>>

/** Whoever already said yes comes back highlighted; everyone else starts off. */
function previousSelection(invite: GuestInvite): Selection {
  return Object.fromEntries(invite.guests.map((guest, index) => [index, guest.attending === true]))
}

function toggled(selection: Selection, index: number): Selection {
  return { ...selection, [index]: !selection[index] }
}

/**
 * Tap the names of everyone who is coming, then confirm. Nothing to type.
 * Contact details stay whatever the organiser imported; a spare seat can be
 * taken by an unnamed companion ("Guest of <host>") with one tap.
 */
export function RsvpForm({
  token, invite, csrf,
}: {
  token: string
  invite: GuestInvite
  csrf: string
}) {
  const [state, action, pending] = useActionState(submitRsvpAction, INITIAL)
  const [selection, setSelection] = useState<Selection>(() => previousSelection(invite))
  // Seats the guest is filling on this visit, beyond the party already known.
  const [companions, setCompanions] = useState(0)

  const known = invite.guests
  const host = known.find((guest) => guest.isPrimary) ?? known[0]
  const seatsRemaining = invite.seatsAllotted - known.length - companions

  if (state.status === 'done') {
    // Shared between the visible text and data-shimmer-text: the CSS
    // shimmer overlay clips a duplicated attr() copy of this exact string
    // over the real glyphs, so the two must always match.
    const confirmationMessage = state.attending
      ? 'Thank you — your response is recorded. We look forward to seeing you.'
      : 'Thank you for letting us know. You will be missed.'
    return (
      <Sealed>
        <p
          role="status"
          data-testid="rsvp-confirmed"
          data-shimmer-text={confirmationMessage}
          className="rounded border border-[var(--color-accent)] p-4"
        >
          {confirmationMessage}
        </p>
      </Sealed>
    )
  }

  const addCompanion = () => {
    setSelection((current) => ({ ...current, [known.length + companions]: true }))
    setCompanions((current) => current + 1)
  }

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="csrf" value={csrf} />
      <input type="hidden" name="token" value={token} />

      <p className="text-[var(--color-text-muted)]">
        {known.length + companions > 1 ? 'Tap everyone who is coming, then confirm.' : 'Tap your name if you are coming, then confirm.'}
      </p>

      <ul className="space-y-2">
        {known.map((guest, index) => (
          <li key={guest.id}>
            <GuestToggle
              index={index}
              id={guest.id}
              name={`${guest.firstName} ${guest.lastName}`.trim()}
              note={guest.isPrimary ? '(you)' : undefined}
              selected={selection[index] === true}
              onToggle={() => setSelection((current) => toggled(current, index))}
            />
          </li>
        ))}
        {Array.from({ length: companions }, (_, offset) => {
          const index = known.length + offset
          return (
            <li key={index}>
              <GuestToggle
                index={index}
                id={null}
                name={`Guest of ${host?.firstName ?? 'the host'}`}
                note={`(seat ${index + 1})`}
                selected={selection[index] === true}
                onToggle={() => setSelection((current) => toggled(current, index))}
              />
            </li>
          )
        })}
      </ul>

      {seatsRemaining > 0 ? (
        <button
          type="button"
          onClick={addCompanion}
          className="rounded border border-[var(--color-border)] px-4 py-2 text-sm"
        >
          Bring a guest ({seatsRemaining} seat{seatsRemaining === 1 ? '' : 's'} remaining)
        </button>
      ) : null}

      {state.status === 'error' ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">{state.message}</p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-[var(--color-accent)] px-6 py-3 font-medium text-[var(--on-accent)] disabled:opacity-60"
      >
        {pending ? 'Sending…' : 'Confirm response'}
      </button>
    </form>
  )
}
