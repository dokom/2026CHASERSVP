import Link from 'next/link'
import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth/guard'
import { listInvites } from '@/lib/invites/repository'
import { inviteQuerySchema } from '@/lib/validation/invites'
import { CsrfInput } from '@/components/admin/csrf-input'
import { Field } from '@/components/admin/field'
import { Table, Td } from '@/components/admin/table'
import { StatusPill } from '@/components/admin/status-pill'
import { Pagination } from '@/components/admin/pagination'
import { createInviteAction } from './actions'

const STATUSES = ['PENDING', 'ATTENDING', 'DECLINED', 'PARTIAL'] as const

const DEFAULT_QUERY = { search: undefined, status: undefined, page: 1, pageSize: 50 } as const

export default async function InvitesPage({
  searchParams,
}: {
  // A repeated param (`?search=a&search=b`) arrives as a string[], not a
  // string — the previous `Record<string, string | undefined>` type lied
  // about that possibility.
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireRole('ADMIN')
  const params = await searchParams
  // `.parse()` throws on a duplicated param, 500-ing the page. `.safeParse()`
  // treats any malformed query as "no filters" instead of a hard failure.
  const parsedQuery = inviteQuerySchema.safeParse({
    search: params.search || undefined,
    status: params.status || undefined,
    page: params.page ?? 1,
    pageSize: 50,
  })
  const query = parsedQuery.success ? parsedQuery.data : DEFAULT_QUERY
  const { rows, total } = await listInvites(prisma, query)

  const buildHref = (page: number) => {
    const next = new URLSearchParams()
    if (query.search) next.set('search', query.search)
    if (query.status) next.set('status', query.status)
    next.set('page', String(page))
    return `/admin/invites?${next.toString()}`
  }

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-serif text-2xl">Invites</h1>
        <div className="flex gap-4 text-sm">
          <Link href="/admin/invites/import" className="underline underline-offset-4">Import CSV</Link>
          <Link href="/api/admin/qr?format=pdf" className="underline underline-offset-4">Download QR sheet</Link>
          <Link href="/api/admin/qr?format=zip" className="underline underline-offset-4">Download QR images</Link>
        </div>
      </div>

      {params.error ? (
        <p role="alert" className="rounded border border-[var(--color-danger)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {params.error}
        </p>
      ) : null}

      <form className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-sm text-[var(--color-text-muted)]">Search</span>
          <input
            name="search"
            defaultValue={query.search ?? ''}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-[var(--color-text-muted)]">Status</span>
          <select
            name="status"
            defaultValue={query.status ?? ''}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
          >
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded border border-[var(--color-border)] px-4 py-2">
          Apply
        </button>
      </form>

      <details className="rounded border border-[var(--color-border)] p-4">
        <summary className="cursor-pointer text-sm">Add a single invite</summary>
        <form action={createInviteAction} className="mt-4 grid gap-4 sm:grid-cols-3">
          <CsrfInput />
          <Field label="Invite label" name="label" required />
          <Field label="Seats" name="seatsAllotted" type="number" defaultValue="1" required />
          <Field label="Table" name="tableNumber" />
          <Field label="First name" name="firstName" required />
          <Field label="Last name" name="lastName" required />
          <Field label="Email" name="email" type="email" />
          <Field label="Company" name="company" />
          <Field label="Title" name="title" />
          <button
            type="submit"
            className="self-end rounded bg-[var(--color-accent)] px-4 py-2 font-medium text-[var(--on-accent)]"
          >
            Create invite
          </button>
        </form>
      </details>

      <Table headers={['Label', 'Seats', 'Guests', 'Table', 'Status', 'Extra seats', '']}>
        {rows.map((invite) => (
          <tr key={invite.id}>
            <Td>{invite.label}</Td>
            <Td>{invite.seatsAllotted}</Td>
            <Td>{invite.guestCount}</Td>
            <Td>{invite.tableNumber ?? '—'}</Td>
            <Td><StatusPill status={invite.status} /></Td>
            <Td>{invite.extraSeatsStatus === 'PENDING' ? `${invite.extraSeatsRequested} pending` : '—'}</Td>
            <Td>
              <Link href={`/admin/invites/${invite.id}`} className="underline underline-offset-4">
                Open
              </Link>
            </Td>
          </tr>
        ))}
      </Table>

      <Pagination page={query.page} total={total} pageSize={query.pageSize} buildHref={buildHref} />
    </section>
  )
}
