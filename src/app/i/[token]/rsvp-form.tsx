'use client'

import { useActionState, useState } from 'react'
import { GuestToggle } from '@/components/guest/guest-toggle'
import { Sealed } from '@/components/motion/sealed'
import { Seal } from '@/components/motion/seal'
import { submitRsvpAction, type RsvpFormState } from './actions'

const INITIAL: RsvpFormState = { status: 'idle' }

type Selection = Readonly<Record<number, boolean>>

/** The narrow, wire-safe slice of a party member the RSVP form needs. No
 * table, email, phone, dietary or accessibility data — that stays server-side
 * until the seat gate releases it. */
export type PartyMember = {
  id: string
  firstName: string
  lastName: string
  isPrimary: boolean
  attending: boolean | null
}

/** Whoever already said yes comes back highlighted; everyone else starts off. */
function previousSelection(guests: PartyMember[]): Selection {
  return Object.fromEntries(guests.map((guest, index) => [index, guest.attending === true]))
}

function toggled(selection: Selection, index: number): Selection {
  return { ...selection, [index]: !selection[index] }
}

function fullName(guest: PartyMember): string {
  return `${guest.firstName} ${guest.lastName}`.trim()
}

/**
 * The stamped ticket that replaces the form once the answer is in: who is
 * coming, in the guest's own words, under the wax seal.
 */
function Ticket({ attending, host, coming }: { attending: boolean; host: PartyMember | undefined; coming: string[] }) {
  const name = host?.firstName ?? 'there'
  const headline = attending ? `See you there, ${name}.` : `We’ll miss you, ${name}.`
  const detail = attending
    ? 'Your response is recorded. We look forward to seeing you.'
    : 'Your response is recorded. You will be missed.'
  return (
    <Sealed>
      <div
        role="status"
        data-testid="rsvp-confirmed"
        className="relative overflow-hidden rounded-2xl border border-[var(--color-accent)] bg-[color-mix(in_oklab,var(--accent)_6%,transparent)] p-6 pr-24 sm:p-8 sm:pr-32"
      >
        <div className="pointer-events-none absolute -right-5 -top-5 rotate-12" aria-hidden="true">
          <Seal size="md" initial={host?.firstName.charAt(0)} />
        </div>
        <p data-shimmer data-shimmer-text={headline} className="type-title font-serif">
          {headline}
        </p>
        <p className="mt-2 text-[var(--color-text-muted)]">{detail}</p>
        {attending && coming.length > 0 ? (
          <ul className="mt-5 flex flex-wrap gap-2">
            {coming.map((person) => (
              <li key={person} className="rounded-full border border-[var(--color-border)] px-3 py-1 text-sm">
                {person}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Sealed>
  )
}

/**
 * Tap the names of everyone who is coming, then confirm. Nothing to type.
 * Contact details stay whatever the organiser imported; any number of
 * companions can be added with one tap each, named or not.
 */
export function RsvpForm({
  token, guests, csrf,
}: {
  token: string
  guests: PartyMember[]
  csrf: string
}) {
  const [state, action, pending] = useActionState(submitRsvpAction, INITIAL)
  const [selection, setSelection] = useState<Selection>(() => previousSelection(guests))
  // Seats the guest is filling on this visit, beyond the party already known.
  const [companions, setCompanions] = useState(0)

  const known = guests
  const host = known.find((guest) => guest.isPrimary) ?? known[0]
  const companionName = `Guest of ${host?.firstName ?? 'the host'}`

  if (state.status === 'done') {
    const coming = [
      ...known.filter((_, index) => selection[index]).map(fullName),
      ...Array.from({ length: companions }, (_, offset) => known.length + offset)
        .filter((index) => selection[index])
        .map(() => companionName),
    ]
    return <Ticket attending={state.attending === true} host={host} coming={coming} />
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

      <ul className="space-y-3">
        {known.map((guest, index) => (
          <li key={guest.id}>
            <GuestToggle
              index={index}
              id={guest.id}
              name={fullName(guest)}
              note={guest.isPrimary ? '(you)' : undefined}
              selected={selection[index] === true}
              answered={guest.attending !== null}
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
                name={companionName}
                note={`(guest ${offset + 1})`}
                selected={selection[index] === true}
                answered
                onToggle={() => setSelection((current) => toggled(current, index))}
              />
            </li>
          )
        })}
      </ul>

      {state.status === 'error' ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">{state.message}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-[var(--color-accent)] px-7 py-3.5 font-medium text-[var(--on-accent)] transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {pending ? 'Sending…' : 'Confirm response'}
        </button>
        <button
          type="button"
          onClick={addCompanion}
          className="rounded-full border border-[var(--color-border)] px-5 py-3.5 text-sm transition-colors hover:border-[var(--color-accent)]"
        >
          Bring a guest
        </button>
      </div>
    </form>
  )
}
