import { describe, it, expect } from 'vitest'
import {
  rsvpSubmissionSchema, guestEntrySchema, MAX_DIETARY_ENTRIES, MAX_NOTE_LENGTH,
} from '@/lib/validation/guest'

const guest = { firstName: 'Jordan', lastName: 'Reyes', dietary: [] }

describe('guestEntrySchema', () => {
  it('accepts a minimal guest', () => {
    expect(guestEntrySchema.safeParse(guest).success).toBe(true)
  })

  it('requires a first and last name', () => {
    expect(guestEntrySchema.safeParse({ ...guest, firstName: '' }).success).toBe(false)
    expect(guestEntrySchema.safeParse({ ...guest, lastName: '  ' }).success).toBe(false)
  })

  it('trims surrounding whitespace', () => {
    const parsed = guestEntrySchema.parse({ ...guest, firstName: '  Jordan  ' })
    expect(parsed.firstName).toBe('Jordan')
  })

  it('rejects a malformed email but accepts an absent one', () => {
    expect(guestEntrySchema.safeParse({ ...guest, email: 'nope' }).success).toBe(false)
    expect(guestEntrySchema.safeParse({ ...guest, email: '' }).success).toBe(true)
    expect(guestEntrySchema.safeParse(guest).success).toBe(true)
  })

  it('lowercases an email', () => {
    expect(guestEntrySchema.parse({ ...guest, email: 'A@B.COM' }).email).toBe('a@b.com')
  })

  it('caps the number of dietary entries', () => {
    const tooMany = Array.from({ length: MAX_DIETARY_ENTRIES + 1 }, (_, i) => `d${i}`)
    expect(guestEntrySchema.safeParse({ ...guest, dietary: tooMany }).success).toBe(false)
  })

  it('caps the length of free text', () => {
    const long = 'x'.repeat(MAX_NOTE_LENGTH + 1)
    expect(guestEntrySchema.safeParse({ ...guest, accessibilityNeeds: long }).success).toBe(false)
  })

  it('rejects a mealOptionId that is not an ObjectId', () => {
    expect(guestEntrySchema.safeParse({ ...guest, mealOptionId: 'nope' }).success).toBe(false)
    expect(guestEntrySchema.safeParse({ ...guest, mealOptionId: 'a'.repeat(24) }).success).toBe(true)
  })

  it('rejects an id that is not an ObjectId', () => {
    // Ids arrive from the client and go straight into a Prisma where clause.
    expect(guestEntrySchema.safeParse({ ...guest, id: '../../etc' }).success).toBe(false)
  })
})

describe('rsvpSubmissionSchema', () => {
  const submission = { attending: true, guests: [guest], extraSeatsRequested: 0 }

  it('accepts a valid submission', () => {
    expect(rsvpSubmissionSchema.safeParse(submission).success).toBe(true)
  })

  it('requires at least one guest when attending', () => {
    expect(rsvpSubmissionSchema.safeParse({ ...submission, guests: [] }).success).toBe(false)
  })

  it('allows an empty guest list when declining', () => {
    const declined = { attending: false, guests: [], extraSeatsRequested: 0 }
    expect(rsvpSubmissionSchema.safeParse(declined).success).toBe(true)
  })

  it('rejects a negative extra-seat request', () => {
    expect(rsvpSubmissionSchema.safeParse({ ...submission, extraSeatsRequested: -1 }).success)
      .toBe(false)
  })

  it('rejects an absurd extra-seat request', () => {
    expect(rsvpSubmissionSchema.safeParse({ ...submission, extraSeatsRequested: 999 }).success)
      .toBe(false)
  })

  it('rejects more guests than any invite could hold', () => {
    const many = Array.from({ length: 41 }, () => guest)
    expect(rsvpSubmissionSchema.safeParse({ ...submission, guests: many }).success).toBe(false)
  })

  it('coerces the numeric field from a form string', () => {
    const parsed = rsvpSubmissionSchema.parse({ ...submission, extraSeatsRequested: '2' })
    expect(parsed.extraSeatsRequested).toBe(2)
  })
})
