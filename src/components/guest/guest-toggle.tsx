const ROW =
  'flex min-h-14 w-full items-center justify-between gap-4 rounded-lg border px-4 py-3 text-left transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2'
const SELECTED = 'border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--on-accent)]'
const UNSELECTED = 'border-[var(--color-border)] text-[var(--color-text)]'

/**
 * One seat: a name, highlighted when that person is coming. Tap to toggle.
 *
 * The answer travels as a hidden `guests.<i>.attending` input, and a known
 * guest's id alongside it, so the form is plain FormData for the action to
 * reassemble without relying on DOM order. `index` namespaces both.
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
        <span className="shrink-0 text-sm">{selected ? '✓ Coming' : 'Not coming'}</span>
      </button>
    </>
  )
}
