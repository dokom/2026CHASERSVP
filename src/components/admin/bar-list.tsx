/** Lowercases and replaces every run of non-alphanumeric characters with a single hyphen, so `title` is always a valid element id. */
function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function BarList({ title, rows }: { title: string; rows: { label: string; count: number; muted?: boolean }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  const headingId = `bars-${slugify(title)}`
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="font-serif text-xl">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-[var(--text-muted)]">Nothing yet.</p> : null}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.label} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-3 text-sm">
            <span className={row.muted ? 'text-[var(--text-muted)]' : ''}>{row.label}</span>
            <span className="h-2 rounded bg-[var(--color-border)]" role="img" aria-label={`${row.label}: ${row.count}`}>
              <span className="block h-full rounded bg-[var(--accent)]" style={{ width: `${(row.count / max) * 100}%` }} />
            </span>
            <span className="text-right tabular-nums">{row.count}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
