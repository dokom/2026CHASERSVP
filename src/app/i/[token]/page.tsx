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
      <main data-guest-root className="grain relative mx-auto max-w-2xl space-y-24 px-6 py-16">
        <BrassLine />
        <FoilHero />

        <Arrival>
          <section aria-labelledby="welcome" className="relative z-10">
            <Seal />
            <h1 id="welcome" className="type-display">
              Welcome,{' '}
              <span data-guest-name className="type-hero block text-[var(--brass)]">
                {primary ? primary.firstName : invite.label}
              </span>
            </h1>
            {event.tagline ? (
              <p className="mt-3 text-[var(--color-text-muted)]">{event.tagline}</p>
            ) : null}
          </section>
        </Arrival>

        <section aria-labelledby="event" className="relative z-10 space-y-2">
          <h2 id="event" className="font-serif text-3xl text-[var(--color-brass)]">{event.name}</h2>
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

        {event.agendaItems.length > 0 ? (
          <Evening>
            <section aria-labelledby="evening" className="relative z-10 space-y-6">
              <h2 id="evening" className="font-serif text-3xl">The evening</h2>
              <AgendaTimeline items={event.agendaItems} timezone={event.timezone} />
            </section>
          </Evening>
        ) : null}

        {table ? (
          <SeatAct>
            <section aria-labelledby="seat" className="relative z-10 space-y-4">
              <h2 id="seat" className="font-serif text-3xl">Your seat</h2>
              <SeatMap floorplanAssetId={event.floorplanAssetId} marker={marker} table={table} />
            </section>
          </SeatAct>
        ) : null}

        <section aria-labelledby="rsvp" className="relative z-10 space-y-4">
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
