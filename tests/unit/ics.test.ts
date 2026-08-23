import { describe, it, expect } from 'vitest'
import { buildIcs, escapeIcsText, foldIcsLine } from '@/lib/guest/ics'

const base = {
  uid: 'invite-123@gala.example.com',
  startsAt: new Date('2026-11-14T18:00:00Z'),
  endsAt: new Date('2026-11-15T00:00:00Z'),
  stamp: new Date('2026-08-22T12:00:00Z'),
  title: 'The 2026 Annual Gala',
  location: 'The Grand Hall, 1 Placeholder Avenue',
  description: 'Black tie. Cocktails at 6.',
}

describe('escapeIcsText', () => {
  it('escapes commas, semicolons and backslashes', () => {
    expect(escapeIcsText('a,b;c\\d')).toBe('a\\,b\\;c\\\\d')
  })

  it('escapes newlines as literal \\n', () => {
    expect(escapeIcsText('line1\nline2')).toBe('line1\\nline2')
  })

  it('normalises CRLF to a single escaped newline', () => {
    expect(escapeIcsText('line1\r\nline2')).toBe('line1\\nline2')
  })

  it('escapes the backslash before the comma, not after', () => {
    // Escaping in the wrong order double-escapes and corrupts the file.
    expect(escapeIcsText('\\,')).toBe('\\\\\\,')
  })
})

describe('foldIcsLine', () => {
  it('leaves a short line alone', () => {
    expect(foldIcsLine('SUMMARY:short')).toBe('SUMMARY:short')
  })

  it('folds a long line with CRLF and a leading space', () => {
    const folded = foldIcsLine('SUMMARY:' + 'x'.repeat(200))
    expect(folded).toContain('\r\n ')
    folded.split('\r\n').forEach((segment) => {
      expect(segment.length).toBeLessThanOrEqual(75)
    })
  })
})

describe('buildIcs', () => {
  it('produces a complete VCALENDAR', () => {
    const ics = buildIcs(base)
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('VERSION:2.0')
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('END:VEVENT')
    expect(ics).toContain('END:VCALENDAR')
  })

  it('uses CRLF line endings throughout', () => {
    const ics = buildIcs(base)
    expect(ics).toContain('\r\n')
    expect(ics.split('\r\n').join('')).not.toContain('\n')
  })

  it('formats timestamps as UTC basic format', () => {
    expect(buildIcs(base)).toContain('DTSTART:20261114T180000Z')
    expect(buildIcs(base)).toContain('DTEND:20261115T000000Z')
    expect(buildIcs(base)).toContain('DTSTAMP:20260822T120000Z')
  })

  it('carries the uid', () => {
    expect(buildIcs(base)).toContain('UID:invite-123@gala.example.com')
  })

  it('escapes a title containing a comma', () => {
    const ics = buildIcs({ ...base, title: 'Gala, 2026' })
    expect(ics).toContain('SUMMARY:Gala\\, 2026')
  })

  it('omits optional fields rather than emitting empty ones', () => {
    const ics = buildIcs({ ...base, description: undefined, location: undefined })
    expect(ics).not.toContain('DESCRIPTION:')
    expect(ics).not.toContain('LOCATION:')
  })

  it('never emits a line longer than 75 octets', () => {
    const ics = buildIcs({ ...base, description: 'y'.repeat(500) })
    ics.split('\r\n').forEach((line) => {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75)
    })
  })
})
