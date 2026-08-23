import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth/guard'
import { listAudit, distinctEntities } from '@/lib/audit-log/query'
import { listAdminUsers } from '@/lib/admin-users/repository'
import { Table, Td } from '@/components/admin/table'
import { Pagination } from '@/components/admin/pagination'

const auditQuerySchema = z.object({
  actorId: z.string().trim().min(1).optional(),
  entity: z.string().trim().min(1).optional(),
  action: z.string().trim().min(1).max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

const DEFAULT_QUERY = {
  actorId: undefined, entity: undefined, action: undefined, from: undefined, to: undefined,
  page: 1, pageSize: 50,
} as const

function formatWhen(date: Date): string {
  return date.toISOString().slice(0, 16).replace('T', ' ')
}

function dateInputValue(date: Date | undefined): string {
  return date ? date.toISOString().slice(0, 10) : ''
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireRole('OWNER')
  const params = await searchParams
  const parsed = auditQuerySchema.safeParse({
    actorId: params.actorId || undefined,
    entity: params.entity || undefined,
    action: params.action || undefined,
    from: params.from || undefined,
    to: params.to || undefined,
    page: params.page ?? 1,
    pageSize: 50,
  })
  const query = parsed.success ? parsed.data : DEFAULT_QUERY

  const [{ rows, total }, adminUsers, entities] = await Promise.all([
    listAudit(prisma, query),
    listAdminUsers(prisma),
    distinctEntities(prisma),
  ])

  const buildHref = (page: number) => {
    const next = new URLSearchParams()
    if (query.actorId) next.set('actorId', query.actorId)
    if (query.entity) next.set('entity', query.entity)
    if (query.action) next.set('action', query.action)
    if (query.from) next.set('from', dateInputValue(query.from))
    if (query.to) next.set('to', dateInputValue(query.to))
    next.set('page', String(page))
    return `/admin/audit?${next.toString()}`
  }

  return (
    <section className="space-y-8">
      <h1 className="font-serif text-2xl">Audit log</h1>

      <form className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-sm text-[var(--color-text-muted)]">Actor</span>
          <select
            name="actorId"
            defaultValue={query.actorId ?? ''}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
          >
            <option value="">All</option>
            {adminUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} ({user.email})
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-[var(--color-text-muted)]">Entity</span>
          <select
            name="entity"
            defaultValue={query.entity ?? ''}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
          >
            <option value="">All</option>
            {entities.map((entity) => (
              <option key={entity} value={entity}>
                {entity}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-[var(--color-text-muted)]">Action</span>
          <input
            name="action"
            defaultValue={query.action ?? ''}
            placeholder="e.g. invite."
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-[var(--color-text-muted)]">From</span>
          <input
            type="date"
            name="from"
            defaultValue={dateInputValue(query.from)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm text-[var(--color-text-muted)]">To</span>
          <input
            type="date"
            name="to"
            defaultValue={dateInputValue(query.to)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
          />
        </label>
        <button type="submit" className="rounded border border-[var(--color-border)] px-4 py-2">
          Apply
        </button>
      </form>

      <Table headers={['When', 'Who', 'Action', 'Entity', 'Details']}>
        {rows.map((row) => (
          <tr key={row.id}>
            <Td>{formatWhen(row.createdAt)}</Td>
            <Td>{row.actor ? `${row.actor.name} (${row.actor.email})` : '—'}</Td>
            <Td>{row.action}</Td>
            <Td>{row.entity}{row.entityId ? ` #${row.entityId}` : ''}</Td>
            <Td>
              <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(row.meta, null, 1)}</pre>
            </Td>
          </tr>
        ))}
      </Table>

      <Pagination page={query.page} total={total} pageSize={query.pageSize} buildHref={buildHref} />
    </section>
  )
}
