import Link from 'next/link'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth/guard'
import { listGuests } from '@/lib/guests/repository'
import { getEvent } from '@/lib/events/repository'
import { Table, Td } from '@/components/admin/table'
import { Pagination } from '@/components/admin/pagination'

const ATTENDING_OPTIONS = ['yes', 'no', 'unanswered'] as const

const guestQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  attending: z.enum(ATTENDING_OPTIONS).optional(),
  mealOptionId: z.string().trim().min(1).optional(),
  checkedIn: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

const DEFAULT_QUERY = {
  search: undefined, attending: undefined, mealOptionId: undefined, checkedIn: undefined,
  page: 1, pageSize: 50,
} as const

export default async function GuestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireRole('ADMIN')
  const params = await searchParams
  const parsedQuery = guestQuerySchema.safeParse({
    search: params.search || undefined,
    attending: params.attending || undefined,
    mealOptionId: params.mealOptionId || undefined,
    checkedIn: params.checkedIn === 'true' ? 'true' : undefined,
    page: params.page ?? 1,
    pageSize: 50,
  })
  const query = parsedQuery.success ? parsedQuery.data : DEFAULT_QUERY

  const [{ rows, total }, event] = await Promise.all([
    listGuests(prisma, query),
    getEvent(prisma),
  ])
  const mealOptions = event?.mealOptions ?? []

  const buildHref = (page: number) => {
    const next = new URLSearchParams()
    if (query.search) next.set('search', query.search)
    if (query.attending) next.set('attending', query.attending)
    if (query.mealOptionId) next.set('mealOptionId', query.mealOptionId)
    if (query.checkedIn) next.set('checkedIn', 'true')
    next.set('page', String(page))
    return `/admin/guests?${next.toString()}`
  }

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-serif text-2xl">Guests</h1>
        <Link href="/api/admin/guests/export" className="underline underline-offset-4">
          Download CSV
        </Link>
      </div>

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
          <span className="mb-1 block text-sm text-[var(--color-text-muted)]">Attending</span>
          <select
            name="attending"
            defaultValue={query.attending ?? ''}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
          >
            <option value="">All</option>
            {ATTENDING_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-[var(--color-text-muted)]">Meal</span>
          <select
            name="mealOptionId"
            defaultValue={query.mealOptionId ?? ''}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
          >
            <option value="">All</option>
            {mealOptions.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2">
          <input type="checkbox" name="checkedIn" value="true" defaultChecked={query.checkedIn === true} />
          <span className="text-sm text-[var(--color-text-muted)]">Checked in only</span>
        </label>
        <button type="submit" className="rounded border border-[var(--color-border)] px-4 py-2">
          Apply
        </button>
      </form>

      <Table headers={['Name', 'Invite', 'Company', 'Attending', 'Meal', 'Table', 'Arrived']}>
        {rows.map((guest) => (
          <tr key={guest.id}>
            <Td>{guest.firstName} {guest.lastName}</Td>
            <Td>{guest.inviteLabel}</Td>
            <Td>{guest.company ?? '—'}</Td>
            <Td>{guest.attending === null ? 'unanswered' : guest.attending ? 'yes' : 'no'}</Td>
            <Td>{guest.meal ?? '—'}</Td>
            <Td>{guest.table ?? '—'}</Td>
            <Td>{guest.checkedInAt ? guest.checkedInAt.toLocaleString() : '—'}</Td>
          </tr>
        ))}
      </Table>

      <Pagination page={query.page} total={total} pageSize={query.pageSize} buildHref={buildHref} />
    </section>
  )
}
