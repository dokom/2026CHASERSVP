import { z } from 'zod'

export const MAX_DIETARY_ENTRIES = 12
export const MAX_NOTE_LENGTH = 1000
/** No invite may exceed 20 seats; 40 leaves headroom for an approved extra-seat request. */
const MAX_GUESTS_PER_SUBMISSION = 40
const MAX_EXTRA_SEATS = 20

const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Not a valid identifier')
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''))

export const guestEntrySchema = z.object({
  id: objectId.optional(),
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName: z.string().trim().min(1, 'Last name is required').max(80),
  badgeName: optionalText(80),
  company: optionalText(160),
  title: optionalText(160),
  email: z.string().trim().toLowerCase().email('Enter a valid email').optional().or(z.literal('')),
  phone: optionalText(40),
  mealOptionId: objectId.optional().or(z.literal('')),
  dietary: z.array(z.string().trim().min(1).max(120)).max(MAX_DIETARY_ENTRIES).default([]),
  accessibilityNeeds: optionalText(MAX_NOTE_LENGTH),
})

export type GuestEntry = z.infer<typeof guestEntrySchema>

export const rsvpSubmissionSchema = z
  .object({
    attending: z.coerce.boolean(),
    guests: z.array(guestEntrySchema).max(MAX_GUESTS_PER_SUBMISSION),
    extraSeatsRequested: z.coerce.number().int().min(0).max(MAX_EXTRA_SEATS).default(0),
    extraSeatsReason: optionalText(MAX_NOTE_LENGTH),
  })
  .refine((value) => !value.attending || value.guests.length > 0, {
    message: 'Tell us who is coming',
    path: ['guests'],
  })

export type RsvpSubmission = z.infer<typeof rsvpSubmissionSchema>
