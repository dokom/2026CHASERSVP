import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import Script from 'next/script'
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
import { INVITE_REVEAL_COOKIE, INVITE_REVEAL_SEEN_COOKIE } from '@/lib/validation/invites'

/**
 * Builds the inline script that marks a token reveal as consumed.
 *
 * This is deliberately NOT a `cookies().delete()` call during render — Next
 * forbids cookie writes in a Server Component render (it throws, and this
 * codebase has already shipped a production 500 that way; see
 * `CsrfInput`). Instead this renders a plain, non-secret marker cookie
 * ("seen=1", no credential in it) written by the BROWSER via a synchronous
 * `document.cookie` assignment — no network round trip, so it is guaranteed
 * to land before any subsequent navigation the operator makes. The next
 * request to this same page then finds the marker and suppresses the
 * reveal block, even though the httpOnly secret cookie is technically still
 * valid for the rest of its short lifetime.
 *
 * Rendered via `next/script` rather than a plain `<script>` JSX element:
 * the redirect landing on this page after `regenerateTokenAction` is a
 * client-side RSC transition, not a fresh HTML document parse — a raw
 * `<script>` node inserted that way is not guaranteed to execute, whereas
 * `next/script` is specifically built to run reliably across both a full
 * page load and a client-side navigation.
 */
function markRevealSeenScript(id: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; secure' : ''
  const cookie = `${INVITE_REVEAL_SEEN_COOKIE}=1; path=/admin/invites/${id}; max-age=60; samesite=lax${secure}`
  return `document.cookie = ${JSON.stringify(cookie)};`
}

export default async function InviteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  await requireRole('ADMIN')
  const { id } = await params
  const { error } = await searchParams
  const invite = await getInvite(prisma, id)
  if (!invite) notFound()

  const cookieStore = await cookies()
  const revealUrl = cookieStore.get(INVITE_REVEAL_COOKIE)?.value
  const alreadySeen = cookieStore.get(INVITE_REVEAL_SEEN_COOKIE)?.value === '1'
  const showReveal = Boolean(revealUrl) && !alreadySeen

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

      {showReveal ? (
        <div className="rounded border border-[var(--color-brass)] p-4">
          <p className="mb-1 text-sm text-[var(--color-text-muted)]">
            New invite link — copy it now, it will not be shown again.
          </p>
          <code data-testid="invite-url" className="break-all text-sm text-[var(--brass-ink)]">
            {revealUrl}
          </code>
          <Script id={`invite-reveal-seen-${invite.id}`} strategy="afterInteractive">
            {markRevealSeenScript(invite.id)}
          </Script>
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
