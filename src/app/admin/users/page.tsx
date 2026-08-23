import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth/guard'
import { listAdminUsers } from '@/lib/admin-users/repository'
import { CsrfInput } from '@/components/admin/csrf-input'
import { Field } from '@/components/admin/field'
import { Table, Td } from '@/components/admin/table'
import { createUserAction, changeRoleAction, toggleActiveAction, resetPasswordAction } from './actions'

const ROLES = ['OWNER', 'ADMIN', 'STAFF'] as const

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  await requireRole('OWNER')
  const { error } = await searchParams
  const users = await listAdminUsers(prisma)

  return (
    <section className="space-y-8">
      <h1 className="font-serif text-2xl">Admin users</h1>

      {error ? (
        <p role="alert" className="rounded border border-[var(--color-danger)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      <form action={createUserAction} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <CsrfInput />
        <Field label="Email" name="email" type="email" required />
        <Field label="Name" name="name" required />
        <label className="block">
          <span className="mb-1 block text-sm text-[var(--color-text-muted)]">Role</span>
          <select
            name="role"
            defaultValue="ADMIN"
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <Field label="Temporary password" name="password" type="password" required />
        <button
          type="submit"
          className="self-end rounded bg-[var(--color-brass)] px-4 py-2 font-medium text-[var(--color-ink-deep)]"
        >
          Create admin
        </button>
      </form>

      <Table headers={['Email', 'Name', 'Role', 'Status', 'Last sign-in', 'Reset password', '']}>
        {users.map((user) => (
          <tr key={user.id}>
            <Td>{user.email}</Td>
            <Td>{user.name}</Td>
            <Td>
              <form action={changeRoleAction} className="flex items-center gap-2">
                <CsrfInput />
                <input type="hidden" name="userId" value={user.id} />
                <label className="sr-only" htmlFor={`role-${user.id}`}>
                  Role
                </label>
                <select
                  id={`role-${user.id}`}
                  name="role"
                  defaultValue={user.role}
                  aria-label="Role"
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button type="submit" className="text-xs underline underline-offset-4">
                  Save role
                </button>
              </form>
            </Td>
            <Td>{user.isActive ? 'Active' : 'Deactivated'}</Td>
            <Td>{user.lastLoginAt ? user.lastLoginAt.toISOString().slice(0, 16).replace('T', ' ') : '—'}</Td>
            <Td>
              <form action={resetPasswordAction} className="flex items-center gap-2">
                <CsrfInput />
                <input type="hidden" name="userId" value={user.id} />
                <label className="sr-only" htmlFor={`reset-${user.id}`}>
                  New password
                </label>
                <input
                  id={`reset-${user.id}`}
                  name="password"
                  type="password"
                  aria-label="New password"
                  className="w-36 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1"
                />
                <button type="submit" className="text-xs underline underline-offset-4">
                  Reset password
                </button>
              </form>
            </Td>
            <Td>
              <form action={toggleActiveAction}>
                <CsrfInput />
                <input type="hidden" name="userId" value={user.id} />
                <input type="hidden" name="isActive" value={user.isActive ? 'false' : 'true'} />
                <button type="submit" className="text-xs underline underline-offset-4">
                  {user.isActive ? 'Deactivate' : 'Reactivate'}
                </button>
              </form>
            </Td>
          </tr>
        ))}
      </Table>
    </section>
  )
}
