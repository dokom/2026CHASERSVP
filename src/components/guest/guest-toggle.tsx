const ROW =
  'flex min-h-14 w-full items-center justify-between gap-4 rounded-lg border px-4 py-3 text-left transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2'
const SELECTED = 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--on-accent)]'
const UNSELECTED = 'border-[var(--color-border)] text-[var(--color-text)]'
const NAME_INPUT =
  'w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]'

/**
 * One seat: a name, highlighted when that person is coming. Tap to toggle.
 *
 * The answer travels as a hidden `guests.<i>.attending` input, and a known
 * guest's id alongside it, so the form is plain FormData for the action to
 * reassemble without relying on DOM order. `index` namespaces both.
 *
 * A companion being added on this visit (`id === null`) also gets two
 * optional name inputs; left blank, the server names them "Guest of <host>".
 */
export function GuestToggle({ index, id, name, note, selected, onToggle }: {
  index: number
  /** The guest's record id; absent for a companion being added on this visit. */
  id: string | null
  name: string
  note?: string
  selected: boolean
  onToggle: () => void
}) {
  const field = (key: string) => `guests.${index}.${key}`
  return (
    <div data-testid={id ? undefined : 'companion-row'} className="space-y-2">
      {id ? <input type="hidden" name={field('id')} value={id} /> : null}
      <input type="hidden" name={field('attending')} value={selected ? 'yes' : 'no'} />
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        data-testid="guest-response"
        className={`${ROW} ${selected ? SELECTED : UNSELECTED}`}
      >
        <span className="font-serif text-xl">
          {name}
          {/* No opacity here: the row's own text colour is the verified one,
              and white at 70% on the red fill drops to 2.9:1. */}
          {note ? <span className="ml-2 font-sans text-sm">{note}</span> : null}
        </span>
        <span className="shrink-0 text-sm">{selected ? '✓ Coming' : 'Not coming'}</span>
      </button>
      {id ? null : (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="sr-only">First name (optional)</span>
            <input name={field('firstName')} placeholder="First name (optional)" maxLength={80} className={NAME_INPUT} />
          </label>
          <label className="block">
            <span className="sr-only">Last name (optional)</span>
            <input name={field('lastName')} placeholder="Last name (optional)" maxLength={80} className={NAME_INPUT} />
          </label>
        </div>
      )}
    </div>
  )
}
