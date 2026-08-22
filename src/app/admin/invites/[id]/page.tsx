import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth/guard'
import { getInvite } from '@/lib/invites/repository'
import { CsrfInput } from '@/components/admin/csrf-input'
import { Field } from '@/components/admin/field'
import { Table, Td } from '@/components/admin/table'
import { StatusPill } from '@/components/admin/status-pill'
import {
  updateInviteAction, deleteInviteAction, regenerateTokenAction, resolveExtraSeatsAction,
} from '../actions'

export default async function InviteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; inviteUrl?: string }>
}) {
  await requireRole('ADMIN')
  const { id } = await params
  const { error, inviteUrl } = await searchParams
  const invite = await getInvite(prisma, id)
  if (!invite) notFound()

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-serif text-2xl">{invite.label}</h1>
        <StatusPill status={invite.status} />
      </div>

      {error ? (
        <p role="alert" className="rounded border border-[var(--color-danger)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      {inviteUrl ? (
        <div className="rounded border border-[var(--color-brass)] p-4">
          <p className="mb-1 text-sm text-[var(--color-text-muted)]">
            New invite link — copy it now, it will not be shown again.
          </p>
          <code data-testid="invite-url" className="break-all text-sm text-[var(--color-brass)]">
            {inviteUrl}
          </code>
        </div>
      ) : null}

      {invite.extraSeatsStatus === 'PENDING' ? (
        <div className="rounded border border-[var(--color-brass)] p-4">
          <p className="mb-3 text-sm">
            Requested {invite.extraSeatsRequested} extra seat(s).
            {invite.extraSeatsReason ? ` Reason: ${invite.extraSeatsReason}` : ''}
          </p>
          <div className="flex gap-3">
            {(['APPROVED', 'DENIED'] as const).map((decision) => (
              <form key={decision} action={resolveExtraSeatsAction}>
                <CsrfInput />
                <input type="hidden" name="id" value={invite.id} />
                <input type="hidden" name="decision" value={decision} />
                <button type="submit" className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm">
                  {decision === 'APPROVED' ? 'Approve' : 'Deny'}
                </button>
              </form>
            ))}
          </div>
        </div>
      ) : null}

      <form action={updateInviteAction} className="grid gap-4 sm:grid-cols-3">
        <CsrfInput />
        <input type="hidden" name="id" value={invite.id} />
        <Field label="Invite label" name="label" defaultValue={invite.label} required />
        <Field label="Seats" name="seatsAllotted" type="number" defaultValue={String(invite.seatsAllotted)} required />
        <Field label="Table" name="tableNumber" defaultValue={invite.tableNumber ?? ''} />
        <Field label="Admin notes" name="adminNotes" defaultValue={invite.adminNotes ?? ''} />
        <button
          type="submit"
          className="self-end rounded bg-[var(--color-brass)] px-4 py-2 font-medium text-[var(--color-ink-deep)]"
        >
          Save changes
        </button>
      </form>

      <Table headers={['Name', 'Company', 'Title', 'Email', 'Attending', 'Table']}>
        {invite.guests.map((guest) => (
          <tr key={guest.id}>
            <Td>{guest.firstName} {guest.lastName}{guest.isPrimary ? ' (primary)' : ''}</Td>
            <Td>{guest.company ?? '—'}</Td>
            <Td>{guest.title ?? '—'}</Td>
            <Td>{guest.email ?? '—'}</Td>
            <Td>{guest.attending === null ? '—' : guest.attending ? 'Yes' : 'No'}</Td>
            <Td>{guest.tableNumber ?? invite.tableNumber ?? '—'}</Td>
          </tr>
        ))}
      </Table>

      <div className="flex gap-4">
        <form action={regenerateTokenAction}>
          <CsrfInput />
          <input type="hidden" name="id" value={invite.id} />
          <button type="submit" className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
            Regenerate QR token
          </button>
        </form>
        <form action={deleteInviteAction}>
          <CsrfInput />
          <input type="hidden" name="id" value={invite.id} />
          <button type="submit" className="rounded border border-[var(--color-danger)] px-4 py-2 text-sm text-[var(--color-danger)]">
            Delete invite
          </button>
        </form>
      </div>
    </section>
  )
}
