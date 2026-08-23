import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { GUEST_CSRF_COOKIE } from '@/lib/auth/csrf'
import { loadGuestPage } from '@/lib/guest/page-data'
import { AgendaTimeline } from '@/components/guest/agenda-timeline'
import { SeatMap } from '@/components/guest/seat-map'
import { MotionProvider } from '@/components/motion/motion-provider'
import { BrassLine } from '@/components/motion/brass-line'
import { FoilHero } from '@/components/motion/foil-hero'
import { Arrival } from '@/components/motion/arrival'
import { Seal } from '@/components/motion/seal'
import { Evening } from '@/components/motion/evening'
import { SeatAct } from '@/components/motion/seat'
import { RsvpForm } from './rsvp-form'

/** The URL carries a credential: never index it, never leak it in a referrer. */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export const dynamic = 'force-dynamic'

export default async function GuestPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const data = await loadGuestPage(prisma, token, new Date())
  if (!data) notFound()

  // Read only. Middleware guarantees the guest CSRF cookie for /i/*; setting
  // it here would be a cookie write during render, which Next.js forbids.
  // This is deliberately its own cookie, distinct from the admin one: this
  // page is unauthenticated and renders the token into its HTML, so it must
  // never leak the admin double-submit secret to an anonymous invite holder.
  const store = await cookies()
  const csrf = store.get(GUEST_CSRF_COOKIE)?.value
  if (!csrf) throw new Error('CSRF cookie missing - check that src/middleware.ts matches /i/*')

  const { invite, event, window, table, marker } = data
  const primary = invite.guests.find((guest) => guest.isPrimary) ?? invite.guests[0]

  return (
    <MotionProvider>
      <main data-guest-root className="relative mx-auto max-w-2xl lg:max-w-4xl overflow-x-clip space-y-24 px-6 py-16">
        <BrassLine />
        <FoilHero />

        <Arrival>
          {/* The seal's own channel, left of the text column: a fixed-width
              marker flush with <main>'s content edge, then pulled back by
              exactly half its width so the seal centres at roughly x=24 of
              <main> regardless of its rendered size — not mx-auto'd across
              the whole page. `overflow-x-clip` on <main> lets it bleed past
              the edge without opening a horizontal scrollbar. */}
          <div className="relative w-40 -ml-20">
            <Seal initial={primary ? primary.firstName.charAt(0) : undefined} size="lg" />
          </div>
          <section aria-labelledby="welcome" className="relative z-10 pl-12">
            <h1 id="welcome" className="type-display">
              {/* The name is the hero by AREA, not just colour: it floors far
                  larger than this line, which recedes in both size and tint. */}
              <span className="type-title block text-[var(--text-muted)]">Welcome, </span>
              <span data-guest-name className="type-hero block text-[var(--brass-ink)]">
                {primary ? primary.firstName : invite.label}
              </span>
            </h1>
            {event.tagline ? (
              <p className="mt-3 text-[var(--color-text-muted)]">{event.tagline}</p>
            ) : null}
          </section>
        </Arrival>

        <section aria-labelledby="event" className="relative z-10 space-y-2 pl-12">
          <h2 id="event" className="type-display text-[var(--color-text)]">{event.name}</h2>
          <p>
            <time dateTime={event.startsAt.toISOString()}>
              {new Intl.DateTimeFormat('en-US', {
                dateStyle: 'full', timeStyle: 'short', timeZone: event.timezone,
              }).format(event.startsAt)}
            </time>
          </p>
          <p className="text-[var(--color-text-muted)]">{event.venueName}, {event.address}</p>
          {event.dressCode ? <p className="text-sm">Dress code: {event.dressCode}</p> : null}
          <a href={`/i/${encodeURIComponent(token)}/calendar`} className="inline-block pt-2 underline underline-offset-4">
            Add to calendar
          </a>
        </section>

        {/* flex flex-col + gap-24 below lg reproduces the space-y-24 gap
            these two sections got for free when they were direct children
            of <main>'s space-y-24 — wrapping them in one div for the lg
            grid took them out of that selector's reach, so the gap has to
            be re-declared here instead (space-y's margin-based approach
            doesn't translate correctly once the container becomes a grid
            at lg, hence gap-* on a flex container below lg instead). */}
        <div className="flex flex-col gap-24 lg:grid lg:grid-cols-2 lg:gap-12">
          {event.agendaItems.length > 0 ? (
            <Evening>
              <section aria-labelledby="evening" className="relative z-10 space-y-6 pl-12">
                <h2 id="evening" className="font-serif text-3xl">The evening</h2>
                <AgendaTimeline items={event.agendaItems} timezone={event.timezone} />
              </section>
            </Evening>
          ) : null}

          {table ? (
            <SeatAct>
              <section aria-labelledby="seat" className="relative z-10 space-y-4 pl-12">
                <h2 id="seat" className="font-serif text-3xl">Your seat</h2>
                <SeatMap floorplanAssetId={event.floorplanAssetId} marker={marker} table={table} />
              </section>
            </SeatAct>
          ) : null}
        </div>

        <section aria-labelledby="rsvp" className="relative z-10 space-y-4 pl-12">
          <h2 id="rsvp" className="font-serif text-3xl">Your response</h2>
          {window.isOpen ? (
            <RsvpForm token={token} invite={invite} mealOptions={event.mealOptions} csrf={csrf} />
          ) : (
            <p role="status" className="rounded border border-[var(--color-border)] p-4">
              RSVPs closed on{' '}
              <time dateTime={window.closesAt.toISOString()}>
                {new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: event.timezone })
                  .format(window.closesAt)}
              </time>
              . Please contact the organiser if you need to change your response.
            </p>
          )}
        </section>
      </main>
    </MotionProvider>
  )
}
