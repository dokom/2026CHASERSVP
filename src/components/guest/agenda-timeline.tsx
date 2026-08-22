import type { AgendaItemRow } from '@/lib/events/repository'

function formatTime(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: timezone,
  }).format(value)
}

/**
 * Semantic structure Plan 3 animates: an ordered list, one <li> per act, each
 * with a real <time datetime>. Do not add motion here.
 */
export function AgendaTimeline({
  items, timezone,
}: {
  items: AgendaItemRow[]
  timezone: string
}) {
  if (items.length === 0) return null

  return (
    <ol className="space-y-6 border-l border-[var(--color-border)] pl-6" data-agenda>
      {items.map((item) => (
        <li key={item.id} className="relative">
          <span
            aria-hidden="true"
            className="absolute -left-[1.6rem] top-2 h-2 w-2 rounded-full bg-[var(--color-brass)]"
          />
          <time
            dateTime={item.startsAt.toISOString()}
            className="block text-sm tracking-wide text-[var(--mist)]"
          >
            {formatTime(item.startsAt, timezone)}
          </time>
          <h3 className="mt-1 font-serif text-xl">{item.title}</h3>
          {item.description ? (
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{item.description}</p>
          ) : null}
        </li>
      ))}
    </ol>
  )
}
