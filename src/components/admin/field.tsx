export function Field(props: {
  label: string
  name: string
  type?: string
  defaultValue?: string
  required?: boolean
  autoComplete?: string
  error?: string
}) {
  const { label, name, type = 'text', defaultValue, required, autoComplete, error } = props
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-[var(--color-text-muted)]">{label}</span>
      <input
        className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        autoComplete={autoComplete}
      />
      {error ? <span className="mt-1 block text-sm text-[var(--color-danger)]">{error}</span> : null}
    </label>
  )
}
