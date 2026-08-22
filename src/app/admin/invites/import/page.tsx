import { cookies } from 'next/headers'
import { requireRole } from '@/lib/auth/guard'
import { CSRF_COOKIE } from '@/lib/auth/csrf'
import { CSV_COLUMNS, csvTemplate } from '@/lib/invites/csv'
import { ImportForm } from './import-form'

export default async function ImportPage() {
  await requireRole('ADMIN')

  // src/middleware.ts guarantees the CSRF cookie exists for every /admin
  // request before this Server Component renders, so this is a plain read.
  // Next.js forbids cookies().set() during render — writing here would 500
  // the page in production while every unit/integration test stays green.
  const store = await cookies()
  const csrf = store.get(CSRF_COOKIE)?.value
  if (!csrf) {
    throw new Error('CSRF cookie missing — check that src/middleware.ts matches this route')
  }

  return (
    <section className="space-y-8">
      <h1 className="font-serif text-2xl">Import invites</h1>

      <div className="rounded border border-[var(--color-border)] p-4 text-sm">
        <p className="mb-2 text-[var(--color-text-muted)]">
          Required columns: <code>label</code>, <code>primaryFirstName</code>,{' '}
          <code>primaryLastName</code>. Optional: {CSV_COLUMNS.filter(
            (c) => !['label', 'primaryFirstName', 'primaryLastName'].includes(c),
          ).map((c) => <code key={c} className="mr-1">{c}</code>)}
        </p>
        <pre className="overflow-x-auto rounded bg-[var(--color-surface)] p-3 text-xs">
          {csvTemplate()}
        </pre>
      </div>

      <ImportForm csrf={csrf} />
    </section>
  )
}
