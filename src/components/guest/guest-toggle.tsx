const ROW =
  'flex min-h-16 w-full items-center justify-between gap-4 rounded-xl border px-5 py-4 text-left transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2'
const SELECTED = 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--on-accent)]'
const UNSELECTED = 'border-[var(--color-border)] text-[var(--color-text)]'
const NAME_INPUT =
  'w-full rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)]'

/** What the right-hand side of the row says when the person is NOT highlighted. */
function restingLabel(answered: boolean): string {
  return answered ? 'Not coming' : 'Tap if coming'
}

/**
 * One seat: a name, highlighted when that person is coming. Tap to toggle.
 *
 * The answer travels as a hidden `guests.<i>.attending` input, and a known
 * guest's id alongside it, so the form is plain FormData for the action to
 * reassemble without relying on DOM order. `index` namespaces both.
 *
 * A guest who has never answered reads "Tap if coming" rather than "Not
 * coming": the page must not put a decline in their mouth. Once they have
 * answered (or for a companion they added themselves), an unhighlighted row
 * means exactly that.
 *
 * A companion being added on this visit (`id === null`) also gets two
 * optional name inputs inside the same card; left blank, the server names
 * them "Guest of <host>".
 */
export function GuestToggle({ index, id, name, note, selected, answered, onToggle }: {
  index: number
  /** The guest's record id; absent for a companion being added on this visit. */
  id: string | null
  name: string
  note?: string
  selected: boolean
  /** Whether this person has an answer on record (or is a companion being added). */
  answered: boolean
  onToggle: () => void
}) {
  const field = (key: string) => `guests.${index}.${key}`
  const button = (
    <>
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
        <span className="shrink-0 text-sm">{selected ? '✓ Coming' : restingLabel(answered)}</span>
      </button>
    </>
  )

  if (id) return button

  return (
    <div
      data-testid="companion-row"
      className={`rounded-2xl border p-2 ${selected ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'}`}
    >
      {button}
      <div className="grid gap-2 p-2 sm:grid-cols-2">
        <label className="block">
          <span className="sr-only">First name (optional)</span>
          <input name={field('firstName')} placeholder="First name (optional)" maxLength={80} className={NAME_INPUT} />
        </label>
        <label className="block">
          <span className="sr-only">Last name (optional)</span>
          <input name={field('lastName')} placeholder="Last name (optional)" maxLength={80} className={NAME_INPUT} />
        </label>
      </div>
    </div>
  )
}
