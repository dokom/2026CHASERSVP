'use client'

import { useActionState } from 'react'
import { validateCsvAction, commitCsvAction, type PreviewState } from './actions'

export function ImportForm({ csrf }: { csrf: string }) {
  const [state, validate, pending] = useActionState<PreviewState, FormData>(validateCsvAction, null)
  const readyCount = state?.rows.filter((r) => r.data).length ?? 0
  const errorRows = state?.rows.filter((r) => r.errors.length) ?? []
  const count = (action: 'create' | 'update' | 'skip') =>
    Object.values(state?.actions ?? {}).filter((a) => a === action).length
  const skipCount = count('skip')
  const importCount = readyCount - skipCount
  const skipRows = Object.entries(state?.skipReasons ?? {})

  return (
    <div className="space-y-8">
      <form action={validate} className="flex flex-wrap items-end gap-4">
        <input type="hidden" name="csrf" value={csrf} />
        <label className="block">
          <span className="mb-1 block text-sm text-[var(--color-text-muted)]">CSV file</span>
          <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded border border-[var(--color-border)] px-4 py-2 disabled:opacity-60"
        >
          {pending ? 'Validating…' : 'Validate file'}
        </button>
      </form>

      {state?.headerErrors.length ? (
        <p role="alert" className="rounded border border-[var(--color-danger)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {state.headerErrors.join('. ')}
        </p>
      ) : null}

      {state && !state.headerErrors.length ? (
        <>
          <p className="text-sm">
            {importCount} row{importCount === 1 ? '' : 's'} ready to import:{' '}
            {count('update')} will update an existing invite, {count('create')} will create a new one
            {skipCount ? `, ${skipCount} will be skipped` : ''}
            {errorRows.length ? `. ${errorRows.length} with errors (they will be skipped)` : ''}
          </p>
          {skipRows.length ? (
            <ul className="space-y-1 text-sm text-[var(--color-text-muted)]">
              {skipRows.map(([rowNumber, reason]) => (
                <li key={rowNumber}>Row {rowNumber}: will be skipped, {reason}</li>
              ))}
            </ul>
          ) : null}

          {errorRows.length ? (
            <ul className="space-y-1 text-sm text-[var(--color-danger)]">
              {errorRows.map((row) => (
                <li key={row.rowNumber}>Row {row.rowNumber}: {row.errors.join('; ')}</li>
              ))}
            </ul>
          ) : null}

          {importCount > 0 ? (
            <form action={commitCsvAction}>
              <input type="hidden" name="csrf" value={csrf} />
              <input type="hidden" name="payload" value={state.payload} />
              <button
                type="submit"
                className="rounded bg-[var(--color-accent)] px-4 py-2 font-medium text-[var(--on-accent)]"
              >
                Import {importCount} invite{importCount === 1 ? '' : 's'}
              </button>
            </form>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
