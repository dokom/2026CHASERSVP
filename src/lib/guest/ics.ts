import type { EventDetail } from '@/lib/events/repository'

export type IcsEvent = {
  uid: string
  startsAt: Date
  endsAt: Date
  stamp: Date
  title: string
  description?: string | undefined
  location?: string | undefined
}

const MAX_OCTETS = 75

/** RFC 5545 §3.3.11. Backslash MUST be escaped first or later escapes double up. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

/**
 * RFC 5545 §3.1: no line may exceed 75 octets. Continuations begin with a
 * single space. Measured in octets, not characters, so multi-byte content
 * folds correctly.
 */
export function foldIcsLine(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= MAX_OCTETS) return line

  const segments: string[] = []
  let current = ''
  let limit = MAX_OCTETS

  for (const char of line) {
    if (Buffer.byteLength(current + char, 'utf8') > limit) {
      segments.push(current)
      current = ' '
      limit = MAX_OCTETS
    }
    current += char
  }
  segments.push(current)
  return segments.join('\r\n')
}

/** UTC basic format: 20261114T180000Z */
function formatUtc(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`
}

export function buildIcs(event: IcsEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gala RSVP//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${formatUtc(event.stamp)}`,
    `DTSTART:${formatUtc(event.startsAt)}`,
    `DTEND:${formatUtc(event.endsAt)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
  ]

  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`)
  if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`)

  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.map(foldIcsLine).join('\r\n')
}

const HOUR_MS = 60 * 60 * 1000
const DEFAULT_DURATION_MS = 5 * HOUR_MS

/**
 * The schema records when an event starts but not when it ends. The last
 * agenda item plus an hour is the best available signal; with no agenda, five
 * hours is a reasonable evening. Kept here rather than in the route so it is
 * testable without a request.
 */
export function buildInviteIcs(event: EventDetail, inviteId: string, stamp: Date): string {
  const lastItem = event.agendaItems.at(-1)
  const endsAt = lastItem
    ? new Date(lastItem.startsAt.getTime() + HOUR_MS)
    : new Date(event.startsAt.getTime() + DEFAULT_DURATION_MS)

  return buildIcs({
    uid: `${inviteId}.${event.id}@gala-rsvp`,
    startsAt: event.startsAt,
    endsAt,
    stamp,
    title: event.name,
    location: `${event.venueName}, ${event.address}`,
    description: event.dressCode ? `Dress code: ${event.dressCode}` : undefined,
  })
}
