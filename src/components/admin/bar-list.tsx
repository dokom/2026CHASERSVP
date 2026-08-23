export function BarList({ title, rows }: { title: string; rows: { label: string; count: number; muted?: boolean }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <section aria-labelledby={`bars-${title}`} className="space-y-3">
      <h2 id={`bars-${title}`} className="font-serif text-xl">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-[var(--text-muted)]">Nothing yet.</p> : null}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.label} className="grid grid-cols-[8rem_1fr_3rem] items-center gap-3 text-sm">
            <span className={row.muted ? 'text-[var(--text-muted)]' : ''}>{row.label}</span>
            <span className="h-2 rounded bg-[var(--color-border)]" role="img" aria-label={`${row.label}: ${row.count}`}>
              <span className="block h-full rounded bg-[var(--brass)]" style={{ width: `${(row.count / max) * 100}%` }} />
            </span>
            <span className="text-right tabular-nums">{row.count}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
