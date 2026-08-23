export function StatTile({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--surface)] p-4">
      <p className="type-eyebrow">{label}</p>
      <p className="mt-1 font-serif text-4xl" data-stat={label}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--text-muted)]">{hint}</p> : null}
    </div>
  )
}
