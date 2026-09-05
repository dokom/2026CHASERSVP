import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { GUEST_CSRF_COOKIE } from '@/lib/auth/csrf'
import { loadGuestPage } from '@/lib/guest/page-data'
import { formatInviteNumber } from '@/lib/invites/numbering'
import { BrandMark } from '@/components/brand-mark'
import { AgendaTimeline } from '@/components/guest/agenda-timeline'
import { SeatMap } from '@/components/guest/seat-map'
import { MotionProvider } from '@/components/motion/motion-provider'
import { BrassLine } from '@/components/motion/brass-line'
import { FoilHero } from '@/components/motion/foil-hero'
import { Arrival } from '@/components/motion/arrival'
import { Seal } from '@/components/motion/seal'
import { Evening } from '@/components/motion/evening'
import { Countdown } from '@/components/guest/countdown'
import type { SeatVisibility } from '@/lib/guest/seat-reveal'
import { RsvpForm, type PartyMember } from './rsvp-form'

/** Why the table is still hidden, in the guest's terms. */
function seatPendingCopy(seat: SeatVisibility, isAssigned: boolean): string {
  if (seat.shown) return ''
  if (!isAssigned) return 'Your table will appear here once your invitation is ready.'
  switch (seat.reason) {
    case 'NOT_CONFIRMED':
      return 'Confirm you are coming below, and your table will appear here once seating is announced.'
    case 'NOT_RELEASED':
      return 'You are confirmed. Seating will be announced closer to the evening. Until then, the countdown is on.'
    case 'NO_TABLE':
      return 'You are confirmed. Your table will appear here once seating is announced.'
  }
}

/** The URL carries a credential: never index it, never leak it in a referrer. */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export const dynamic = 'force-dynamic'

const SECTION = 'relative z-10 pl-12'
const HEADING = 'font-serif text-3xl sm:text-4xl'

export default async function GuestPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const now = new Date()
  const data = await loadGuestPage(prisma, token, now)
  if (!data) notFound()

  // Read only. Middleware guarantees the guest CSRF cookie for /i/*; setting
  // it here would be a cookie write during render, which Next.js forbids.
  // This is deliberately its own cookie, distinct from the admin one: this
  // page is unauthenticated and renders the token into its HTML, so it must
  // never leak the admin double-submit secret to an anonymous invite holder.
  const store = await cookies()
  const csrf = store.get(GUEST_CSRF_COOKIE)?.value
  if (!csrf) throw new Error('CSRF cookie missing - check that src/proxy.ts matches /i/*')

  const { invite, event, window, seats, seat } = data
  const primary = invite.guests.find((guest) => guest.isPrimary) ?? invite.guests[0]
  // A printed placeholder nobody has been assigned to yet: greet by number,
  // and hold the RSVP until the organiser attaches a name.
  const isAssigned = invite.guests.length > 0
  // Only what the RSVP form needs to render and submit — never the table,
  // contact, or dietary/accessibility fields that ride along on `invite`.
  const party: PartyMember[] = invite.guests.map(({ id, firstName, lastName, isPrimary, attending }) => ({
    id, firstName, lastName, isPrimary, attending,
  }))

  const date = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: event.timezone,
  }).format(event.startsAt)
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: event.timezone,
  }).format(event.startsAt)

  return (
    <MotionProvider>
      {/* `isolate` makes <main> its own stacking context, so the foil canvas
          (z -10) paints above the card's own background on large screens
          instead of vanishing behind it. `overflow-x-clip` lets the seal
          bleed past the left edge without a horizontal scrollbar. */}
      <main
        data-guest-root
        className="relative isolate mx-auto max-w-2xl space-y-16 overflow-x-clip px-6 py-14 lg:my-12 lg:max-w-3xl lg:rounded-[2rem] lg:border lg:border-[var(--color-border)] lg:bg-[var(--surface)] lg:px-28 lg:py-20 lg:shadow-[0_48px_120px_-48px_rgba(0,0,0,0.65)]"
      >
        <BrassLine />
        <FoilHero />

        {/* The host's mark, before the guest's name: this is CHASE's evening. */}
        <div className={SECTION}>
          <BrandMark size="md" />
        </div>

        <Arrival>
          {/* The seal's own channel, left of the text column: a fixed-width
              marker flush with <main>'s content edge, then pulled back by
              half its width so it centres near the gutter the brass line
              runs down. On phones it bleeds off the edge like a seal pressed
              over the envelope's flap; inside the desktop card it sits in
              the wide left margin. */}
          <div className="relative -ml-20 w-40">
            <Seal initial={primary ? primary.firstName.charAt(0) : undefined} size="lg" />
          </div>
          <section aria-labelledby="welcome" className={`${SECTION} mt-2`}>
            {isAssigned ? (
              <>
                <p className="text-[var(--blue-ink)]">CHASE Auto Parts invites</p>
                <h1 id="welcome">
                  <span data-guest-name className="type-hero font-serif block text-[var(--accent-ink)]">
                    {primary!.firstName}
                  </span>
                </h1>
              </>
            ) : (
              <>
                <p className="text-[var(--blue-ink)]">
                  Invitation No. <span data-invite-number>{formatInviteNumber(invite.number)}</span>
                </p>
                <h1 id="welcome" className="type-display text-[var(--accent-ink)]">
                  <span data-guest-name>You are invited</span>
                </h1>
              </>
            )}
            {event.tagline ? (
              <p className="mt-4 max-w-md font-serif text-2xl text-[var(--color-text-muted)]">{event.tagline}</p>
            ) : null}
          </section>
        </Arrival>

        <section aria-labelledby="event" className={SECTION}>
          <h2 id="event" className="type-display text-[var(--color-text)]">{event.name}</h2>
          <div className="mt-5 space-y-1">
            <p className="font-serif text-2xl leading-tight sm:text-3xl">
              <time dateTime={event.startsAt.toISOString()}>{date}</time>
            </p>
            <p className="font-serif text-2xl leading-tight sm:text-3xl">{time}</p>
          </div>
          <div className="mt-5 space-y-1">
            <p className="text-lg">{event.venueName}</p>
            <p className="text-[var(--color-text-muted)]">{event.address}</p>
            {event.dressCode ? <p className="pt-2 text-sm text-[var(--color-text-muted)]">Dress code: {event.dressCode}</p> : null}
          </div>
          <a
            href={`/i/${encodeURIComponent(token)}/calendar`}
            className="mt-7 inline-flex items-center rounded-full border border-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-[var(--accent-ink)] transition-colors hover:bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]"
          >
            Add to calendar
          </a>
        </section>

        {event.agendaItems.length > 0 ? (
          <Evening>
            <section aria-labelledby="evening" className={`${SECTION} space-y-6`}>
              <h2 id="evening" className={HEADING}>The evening</h2>
              <AgendaTimeline items={event.agendaItems} timezone={event.timezone} />
            </section>
          </Evening>
        ) : null}

        {seat.shown && seats.length > 0 ? (
          <section aria-labelledby="seat" className={`${SECTION} space-y-6`}>
            <h2 id="seat" className={HEADING}>{seats.length > 1 ? 'Your seats' : 'Your seat'}</h2>
            <SeatMap floorplanAssetId={event.floorplanAssetId} seats={seats} />
          </section>
        ) : (
          <section aria-labelledby="seat" data-seat-pending={seat.shown ? undefined : seat.reason} className={`${SECTION} space-y-6`}>
            <h2 id="seat" className={HEADING}>Your seat</h2>
            <p className="max-w-md text-[var(--color-text-muted)]">{seatPendingCopy(seat, isAssigned)}</p>
            <Countdown targetMs={event.startsAt.getTime()} initialNowMs={now.getTime()} />
          </section>
        )}

        <section aria-labelledby="rsvp" className={`${SECTION} space-y-6`}>
          <h2 id="rsvp" className={HEADING}>Your response</h2>
          {!isAssigned ? (
            <p role="status" data-testid="invite-unassigned" className="max-w-md rounded-2xl border border-[var(--color-border)] p-5">
              This invitation is still being prepared. Once the organiser has added your name,
              you can respond here.
            </p>
          ) : window.isOpen ? (
            <RsvpForm token={token} guests={party} csrf={csrf} />
          ) : (
            <p role="status" className="max-w-md rounded-2xl border border-[var(--color-border)] p-5">
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
