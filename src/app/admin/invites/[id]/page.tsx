import { cookies, headers } from 'next/headers'
import { notFound } from 'next/navigation'
import Script from 'next/script'
import { prisma } from '@/lib/db'
import { requireRole } from '@/lib/auth/guard'
import { getInvite } from '@/lib/invites/repository'
import { CsrfInput } from '@/components/admin/csrf-input'
import { Field } from '@/components/admin/field'
import { StatusPill } from '@/components/admin/status-pill'
import { formatInviteNumber } from '@/lib/invites/numbering'
import {
  updateInviteAction, deleteInviteAction, regenerateTokenAction,
  addGuestAction, updateGuestAction, removeGuestAction,
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
  // The nonce `src/proxy.ts` minted for this request — required for a
  // next/script instance to run under the strict, nonce-gated script-src.
  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <span data-testid="invite-number" className="rounded border border-[var(--color-border)] px-2 py-0.5 font-mono text-sm tabular-nums">
          No. {formatInviteNumber(invite.number)}
        </span>
        <h1 className="font-serif text-2xl">{invite.label}</h1>
        <StatusPill status={invite.status} />
      </div>

      {error ? (
        <p role="alert" className="rounded border border-[var(--color-danger)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      {showReveal ? (
        <div className="rounded border border-[var(--color-accent)] p-4">
          <p className="mb-1 text-sm text-[var(--color-text-muted)]">
            New invite link — copy it now, it will not be shown again.
          </p>
          <code data-testid="invite-url" className="break-all text-sm text-[var(--accent-ink)]">
            {revealUrl}
          </code>
          <Script id={`invite-reveal-seen-${invite.id}`} strategy="afterInteractive" nonce={nonce}>
            {markRevealSeenScript(invite.id)}
          </Script>
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
          className="self-end rounded bg-[var(--color-accent)] px-4 py-2 font-medium text-[var(--on-accent)]"
        >
          Save changes
        </button>
      </form>

      <section aria-labelledby="guests-heading" className="space-y-4">
        <h2 id="guests-heading" className="font-serif text-xl">
          Guests <span className="text-sm text-[var(--color-text-muted)]">({invite.guests.length})</span>
        </h2>

        {invite.guests.length === 0 ? (
          <p data-testid="invite-no-guests" className="rounded border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">
            Nobody is attached to this invite yet. Add the person this card went to — their QR code stays exactly as printed.
          </p>
        ) : null}

        {invite.guests.map((guest) => (
          <form
            key={guest.id}
            action={updateGuestAction}
            data-testid="invite-guest"
            className="grid gap-3 rounded border border-[var(--color-border)] p-4 sm:grid-cols-3"
          >
            <CsrfInput />
            <input type="hidden" name="id" value={invite.id} />
            <input type="hidden" name="guestId" value={guest.id} />
            <p className="text-sm sm:col-span-3">
              <span className="font-medium">{guest.firstName} {guest.lastName}</span>
              {guest.isPrimary ? ' · primary' : ''}
              {' · '}Attending: {guest.attending === null ? 'no answer yet' : guest.attending ? 'yes' : 'no'}
              {' · '}Table: {guest.tableNumber ?? invite.tableNumber ?? '—'}{guest.tableNumber ? '' : invite.tableNumber ? ' (party default)' : ''}
              {guest.checkedInAt ? ' · checked in' : ''}
            </p>
            <Field label="First name" name="firstName" defaultValue={guest.firstName} required />
            <Field label="Last name" name="lastName" defaultValue={guest.lastName} required />
            <Field label="Email" name="email" type="email" defaultValue={guest.email ?? ''} />
            <Field label="Company" name="company" defaultValue={guest.company ?? ''} />
            <Field label="Title" name="title" defaultValue={guest.title ?? ''} />
            <Field label="Table" name="tableNumber" defaultValue={guest.tableNumber ?? ''} />
            <div className="flex items-end gap-3">
              <button type="submit" className="rounded border border-[var(--color-border)] px-4 py-2 text-sm">
                Save guest
              </button>
              {guest.checkedInAt ? null : (
                <button
                  type="submit"
                  formAction={removeGuestAction}
                  className="px-2 py-2 text-sm text-[var(--color-danger)] underline underline-offset-4"
                >
                  Remove
                </button>
              )}
            </div>
          </form>
        ))}

        <details className="rounded border border-[var(--color-border)] p-4" open={invite.guests.length === 0}>
          <summary className="cursor-pointer text-sm">Add a guest</summary>
          <form action={addGuestAction} className="mt-4 grid gap-4 sm:grid-cols-3">
            <CsrfInput />
            <input type="hidden" name="id" value={invite.id} />
            <Field label="First name" name="firstName" required />
            <Field label="Last name" name="lastName" required />
            <Field label="Email" name="email" type="email" />
            <Field label="Company" name="company" />
            <Field label="Title" name="title" />
            <Field label="Table" name="tableNumber" />
            <button
              type="submit"
              className="self-end rounded bg-[var(--color-accent)] px-4 py-2 font-medium text-[var(--on-accent)]"
            >
              Add guest
            </button>
          </form>
        </details>
      </section>

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
