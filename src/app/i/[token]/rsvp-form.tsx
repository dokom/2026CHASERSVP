'use client'

import { useActionState, useState } from 'react'
import { GuestCard } from '@/components/guest/guest-card'
import { Field } from '@/components/admin/field'
import { RsvpSteps } from '@/components/motion/rsvp-steps'
import { Sealed } from '@/components/motion/sealed'
import type { GuestInvite } from '@/lib/guest/resolve'
import type { MealOptionRow } from '@/lib/events/repository'
import { submitRsvpAction, type RsvpFormState } from './actions'

const INITIAL: RsvpFormState = { status: 'idle' }

/** Declining skips 2-4: there is nothing to ask someone who is not coming. */
const STEP_COUNT = 5

export function RsvpForm({
  token, invite, mealOptions, csrf,
}: {
  token: string
  invite: GuestInvite
  mealOptions: MealOptionRow[]
  csrf: string
}) {
  const [state, action, pending] = useActionState(submitRsvpAction, INITIAL)
  const [attending, setAttending] = useState<boolean | null>(
    invite.respondedAt ? invite.status !== 'DECLINED' : null,
  )
  const [seats, setSeats] = useState(Math.max(1, invite.guests.length))
  const [step, setStep] = useState(1)

  const seatsRemaining = invite.seatsAllotted - seats
  // Every step stays mounted; inactive ones are `hidden`. Unmounting would drop
  // the guest's input AND remove the fields from the single FormData submit.
  const stepProps = (n: number) => ({ hidden: step !== n, 'aria-hidden': step !== n })
  const next = () => setStep((current) => (attending === false && current === 1 ? 5 : current + 1))
  const back = () => setStep((current) => (attending === false && current === 5 ? 1 : current - 1))

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

      <div
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={STEP_COUNT}
        aria-valuenow={step}
        aria-label={`Step ${step} of ${STEP_COUNT}`}
        className="h-1 w-full rounded bg-[var(--color-surface)]"
      >
        <div
          className="h-full rounded bg-[var(--color-brass)]"
          style={{ width: `${(step / STEP_COUNT) * 100}%` }}
        />
      </div>

      <RsvpSteps step={step}>
        <fieldset className="space-y-3" {...stepProps(1)}>
          <legend className="font-serif text-xl">Will you join us?</legend>
          {(['yes', 'no'] as const).map((value) => (
            <label key={value} className="flex items-center gap-3">
              <input
                type="radio"
                name="attending"
                value={value}
                checked={attending === (value === 'yes')}
                onChange={() => setAttending(value === 'yes')}
                required
              />
              <span>{value === 'yes' ? 'Joyfully accepts' : 'Regretfully declines'}</span>
            </label>
          ))}
        </fieldset>

        {attending ? (
          <>
            <div className="space-y-4" {...stepProps(2)}>
              {Array.from({ length: seats }, (_, index) => (
                <GuestCard
                  key={index}
                  index={index}
                  guest={invite.guests[index]}
                  mealOptions={mealOptions}
                />
              ))}
            </div>

            {seatsRemaining > 0 ? (
              <button
                type="button"
                onClick={() => setSeats((current) => current + 1)}
                className="rounded border border-[var(--color-border)] px-4 py-2 text-sm"
                {...stepProps(2)}
              >
                Add another guest ({seatsRemaining} seat{seatsRemaining === 1 ? '' : 's'} remaining)
              </button>
            ) : (
              <div className="rounded border border-[var(--color-border)] p-4" {...stepProps(3)}>
                <p className="text-sm">Need an extra seat?</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label="How many extra seats?" name="extraSeatsRequested" type="number" defaultValue="0" />
                  <Field label="Reason" name="extraSeatsReason" />
                </div>
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                  Extra seats are subject to the organiser&rsquo;s approval.
                </p>
              </div>
            )}

            {/* Step 4: read-only review. Build it from the same state the fields
                hold, so it can never disagree with what will actually be sent. */}
            <section {...stepProps(4)} aria-label="Review your response" className="space-y-2">
              <h3 className="font-serif text-xl">Please check your answers</h3>
              <p className="text-sm text-[var(--color-text-muted)]">
                {seats} guest{seats === 1 ? '' : 's'} attending. Use Back to change anything.
              </p>
            </section>
          </>
        ) : null}
      </RsvpSteps>

      {state.status === 'error' ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">{state.message}</p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={back}
          disabled={step === 1}
          className="rounded border border-[var(--color-border)] px-4 py-2 disabled:opacity-40"
        >
          Back
        </button>

        {step < STEP_COUNT ? (
          <button
            type="button"
            onClick={next}
            disabled={attending === null}
            className="rounded bg-[var(--color-brass)] px-6 py-2 font-medium text-[var(--color-ink-deep)] disabled:opacity-60"
          >
            Continue
          </button>
        ) : (
          <button
            type="submit"
            disabled={pending || attending === null}
            className="rounded bg-[var(--color-brass)] px-6 py-3 font-medium text-[var(--color-ink-deep)] disabled:opacity-60"
          >
            {pending ? 'Sending…' : 'Send response'}
          </button>
        )}
      </div>
    </form>
  )
}
