import { z } from 'zod'

export const MAX_NOTE_LENGTH = 1000
const MAX_NAME_LENGTH = 80
/** No invite may exceed 20 seats; 40 leaves headroom for an approved extra-seat request. */
const MAX_GUESTS_PER_SUBMISSION = 40
const MAX_EXTRA_SEATS = 20

const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Not a valid identifier')
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''))

/**
 * One seat's answer: coming or not, and a meal if coming.
 *
 * The guest never types contact details here. Names, company and email come
 * from the organiser's import and an RSVP leaves them alone. A name is
 * accepted only for a companion the guest adds themselves, and even that is
 * optional — it defaults to "Guest of <host>".
 */
export const guestResponseSchema = z.object({
  id: objectId.optional(),
  attending: z.boolean(),
  mealOptionId: objectId.optional().or(z.literal('')),
  firstName: optionalText(MAX_NAME_LENGTH),
  lastName: optionalText(MAX_NAME_LENGTH),
})

export type GuestResponse = z.infer<typeof guestResponseSchema>

export const rsvpSubmissionSchema = z.object({
  guests: z.array(guestResponseSchema).min(1, 'Tell us who is coming').max(MAX_GUESTS_PER_SUBMISSION),
  extraSeatsRequested: z.coerce.number().int().min(0).max(MAX_EXTRA_SEATS).default(0),
  extraSeatsReason: optionalText(MAX_NOTE_LENGTH),
})

export type RsvpSubmission = z.infer<typeof rsvpSubmissionSchema>
