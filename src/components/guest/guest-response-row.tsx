import type { GuestRow } from '@/lib/guest/resolve'
import type { MealOptionRow } from '@/lib/events/repository'

// The radio is a transparent layer over the whole chip, not hidden behind
// it: the entire pill is the hit target, and a pointer (or a test runner)
// lands on the input itself rather than on a label covering it.
const CHIP =
  'relative inline-flex min-h-11 cursor-pointer items-center rounded-full border border-[var(--color-border)] px-4 text-sm ' +
  'transition-colors has-[:checked]:border-[var(--color-brass)] has-[:checked]:bg-[var(--color-brass)] ' +
  'has-[:checked]:text-[var(--color-ink-deep)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-brass)] ' +
  'has-[:focus-visible]:ring-offset-2'
const CHIP_INPUT = 'absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0'

const INPUT = 'w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2'

function MealSelect({ name, defaultValue, mealOptions, forWhom }: {
  name: string
  defaultValue: string
  mealOptions: MealOptionRow[]
  forWhom: string
}) {
  if (mealOptions.length === 0) return null
  return (
    <label className="block sm:max-w-xs">
      <span className="mb-1 block text-sm text-[var(--color-text-muted)]">Meal for {forWhom}</span>
      <select name={name} defaultValue={defaultValue} className={INPUT}>
        <option value="">No preference</option>
        {mealOptions.map((meal) => (
          <option key={meal.id} value={meal.id}>{meal.label}</option>
        ))}
      </select>
    </label>
  )
}

/**
 * One seat's answer. Two chips (coming / not coming) and, when coming, a meal.
 *
 * `index` namespaces every input so the action can reassemble the party from
 * flat FormData without relying on DOM order. `answer` is owned by the form:
 * it needs to know when every seat has been answered to enable Confirm.
 */
export function KnownGuestRow({ index, guest, answer, onAnswer, mealOptions }: {
  index: number
  guest: GuestRow
  answer: boolean | undefined
  onAnswer: (attending: boolean) => void
  mealOptions: MealOptionRow[]
}) {
  const name = (field: string) => `guests.${index}.${field}`
  const fullName = `${guest.firstName} ${guest.lastName}`.trim()

  return (
    <fieldset className="space-y-3 rounded border border-[var(--color-border)] p-4" data-testid="guest-response">
      <legend className="px-2 font-serif text-xl">
        {fullName}
        {guest.isPrimary ? <span className="ml-2 text-sm text-[var(--color-text-muted)]">(you)</span> : null}
      </legend>
      <input type="hidden" name={name('id')} value={guest.id} />

      <div className="flex flex-wrap gap-2">
        <label className={CHIP}>
          <input
            type="radio"
            name={name('attending')}
            value="yes"
            checked={answer === true}
            onChange={() => onAnswer(true)}
            className={CHIP_INPUT}
          />
          Coming
        </label>
        <label className={CHIP}>
          <input
            type="radio"
            name={name('attending')}
            value="no"
            checked={answer === false}
            onChange={() => onAnswer(false)}
            className={CHIP_INPUT}
          />
          Can&rsquo;t make it
        </label>
      </div>

      {answer === true ? (
        <MealSelect name={name('mealOptionId')} defaultValue={guest.mealOptionId ?? ''} mealOptions={mealOptions} forWhom={guest.firstName} />
      ) : null}
    </fieldset>
  )
}

/**
 * A seat the guest is filling themselves. Always coming (there is no reason
 * to add someone who is not); the name is optional and defaults on the
 * server to "Guest of <host>".
 */
export function CompanionRow({ index, hostFirstName, mealOptions, onRemove }: {
  index: number
  hostFirstName: string
  mealOptions: MealOptionRow[]
  onRemove: (() => void) | null
}) {
  const name = (field: string) => `guests.${index}.${field}`
  const label = `Guest ${index + 1}`

  return (
    <fieldset className="space-y-3 rounded border border-[var(--color-brass)] p-4" data-testid="guest-response">
      <legend className="px-2 font-serif text-xl">{label}</legend>
      <input type="hidden" name={name('attending')} value="yes" />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm text-[var(--color-text-muted)]">First name (optional)</span>
          <input name={name('firstName')} placeholder={`Guest of ${hostFirstName}`} className={INPUT} autoComplete="off" />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-[var(--color-text-muted)]">Last name (optional)</span>
          <input name={name('lastName')} className={INPUT} autoComplete="off" />
        </label>
      </div>

      <MealSelect name={name('mealOptionId')} defaultValue="" mealOptions={mealOptions} forWhom={label} />

      {onRemove ? (
        <button type="button" onClick={onRemove} className="text-sm underline underline-offset-4">
          Remove {label}
        </button>
      ) : null}
    </fieldset>
  )
}
