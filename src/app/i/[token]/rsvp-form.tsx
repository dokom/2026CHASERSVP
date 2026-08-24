'use client'

import { useActionState, useState } from 'react'
import { CompanionRow, KnownGuestRow } from '@/components/guest/guest-response-row'
import { Sealed } from '@/components/motion/sealed'
import type { GuestInvite } from '@/lib/guest/resolve'
import type { MealOptionRow } from '@/lib/events/repository'
import { submitRsvpAction, type RsvpFormState } from './actions'

const INITIAL: RsvpFormState = { status: 'idle' }

type Answers = Readonly<Record<number, boolean>>

/** A guest who already answered sees their previous answer selected. */
function previousAnswers(invite: GuestInvite): Answers {
  return Object.fromEntries(
    invite.guests.flatMap((guest, index) => (guest.attending === null ? [] : [[index, guest.attending]])),
  )
}

/**
 * Select and confirm: one chip per person, a meal if they're coming, done.
 * Nothing to type. Contact details stay whatever the organiser imported.
 */
export function RsvpForm({
  token, invite, mealOptions, csrf,
}: {
  token: string
  invite: GuestInvite
  mealOptions: MealOptionRow[]
  csrf: string
}) {
  const [state, action, pending] = useActionState(submitRsvpAction, INITIAL)
  const [answers, setAnswers] = useState<Answers>(() => previousAnswers(invite))
  // Seats the guest is filling on this visit, beyond the party already known.
  const [companions, setCompanions] = useState(0)

  const known = invite.guests
  const host = known.find((guest) => guest.isPrimary) ?? known[0]
  const seatsRemaining = invite.seatsAllotted - known.length - companions
  const everyoneAnswered = known.every((_, index) => answers[index] !== undefined)

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
          className="rounded border border-[var(--color-brass)] p-4"
        >
          {confirmationMessage}
        </p>
      </Sealed>
    )
  }

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="csrf" value={csrf} />
      <input type="hidden" name="token" value={token} />

      <p className="text-[var(--color-text-muted)]">
        {known.length > 1 ? 'Let us know who from your party will be joining us.' : 'Let us know if you will be joining us.'}
      </p>

      <ul className="space-y-3">
        {known.map((guest, index) => (
          <li key={guest.id}>
            <KnownGuestRow
              index={index}
              guest={guest}
              answer={answers[index]}
              onAnswer={(attending) => setAnswers((current) => ({ ...current, [index]: attending }))}
              mealOptions={mealOptions}
            />
          </li>
        ))}
        {Array.from({ length: companions }, (_, offset) => {
          const index = known.length + offset
          const isLast = offset === companions - 1
          return (
            <li key={index}>
              <CompanionRow
                index={index}
                hostFirstName={host?.firstName ?? 'the host'}
                mealOptions={mealOptions}
                onRemove={isLast ? () => setCompanions((current) => current - 1) : null}
              />
            </li>
          )
        })}
      </ul>

      {seatsRemaining > 0 ? (
        <button
          type="button"
          onClick={() => setCompanions((current) => current + 1)}
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
        disabled={pending || !everyoneAnswered}
        className="rounded bg-[var(--color-brass)] px-6 py-3 font-medium text-[var(--color-ink-deep)] disabled:opacity-60"
      >
        {pending ? 'Sending…' : 'Confirm response'}
      </button>
    </form>
  )
}
