import { describe, it, expect } from 'vitest'
import { rsvpSubmissionSchema, guestResponseSchema } from '@/lib/validation/guest'

const ID = 'a'.repeat(24)
const coming = { id: ID, attending: true }

describe('guestResponseSchema', () => {
  it('accepts a known guest who is coming', () => {
    expect(guestResponseSchema.safeParse(coming).success).toBe(true)
  })

  it('accepts a known guest who is not coming', () => {
    expect(guestResponseSchema.safeParse({ id: ID, attending: false }).success).toBe(true)
  })

  it('requires an explicit yes or no, never a coerced string', () => {
    expect(guestResponseSchema.safeParse({ id: ID }).success).toBe(false)
    expect(guestResponseSchema.safeParse({ id: ID, attending: 'no' }).success).toBe(false)
  })

  it('accepts a companion with no id and no name', () => {
    expect(guestResponseSchema.safeParse({ attending: true }).success).toBe(true)
  })

  it('trims an optional companion name and caps its length', () => {
    expect(guestResponseSchema.parse({ attending: true, firstName: '  Sam  ' }).firstName).toBe('Sam')
    expect(guestResponseSchema.safeParse({ attending: true, firstName: 'x'.repeat(81) }).success).toBe(false)
  })

  it('rejects a malformed meal option id but allows an empty one', () => {
    expect(guestResponseSchema.safeParse({ ...coming, mealOptionId: 'nope' }).success).toBe(false)
    expect(guestResponseSchema.safeParse({ ...coming, mealOptionId: '' }).success).toBe(true)
    expect(guestResponseSchema.safeParse({ ...coming, mealOptionId: ID }).success).toBe(true)
  })

  it('rejects a guest id that is not an ObjectId', () => {
    expect(guestResponseSchema.safeParse({ ...coming, id: '../../etc' }).success).toBe(false)
  })

  it('has no field for contact details, so a form cannot overwrite them', () => {
    const parsed = guestResponseSchema.parse({ ...coming, company: 'Injected', email: 'x@y.z' })
    expect(parsed).not.toHaveProperty('company')
    expect(parsed).not.toHaveProperty('email')
  })
})

describe('rsvpSubmissionSchema', () => {
  const submission = { guests: [coming] }

  it('accepts a valid submission', () => {
    expect(rsvpSubmissionSchema.safeParse(submission).success).toBe(true)
  })

  it('rejects an empty party', () => {
    expect(rsvpSubmissionSchema.safeParse({ guests: [] }).success).toBe(false)
  })

  it('accepts a party where nobody is coming', () => {
    expect(rsvpSubmissionSchema.safeParse({ guests: [{ id: ID, attending: false }] }).success).toBe(true)
  })

  it('accepts a large party: there is no seat allowance', () => {
    const many = Array.from({ length: 60 }, () => ({ attending: true }))
    expect(rsvpSubmissionSchema.safeParse({ guests: many }).success).toBe(true)
  })

  it('caps a single submission at 100 entries as a request-size bound', () => {
    const many = Array.from({ length: 101 }, () => ({ attending: true }))
    const result = rsvpSubmissionSchema.safeParse({ guests: many })
    expect(result.success).toBe(false)
    expect(result.success ? '' : result.error.issues[0]?.message).toMatch(/too many people/)
  })

  it('has no extra-seats fields', () => {
    const parsed = rsvpSubmissionSchema.parse({ ...submission, extraSeatsRequested: 3, extraSeatsReason: 'x' })
    expect(parsed).not.toHaveProperty('extraSeatsRequested')
    expect(parsed).not.toHaveProperty('extraSeatsReason')
  })
})
