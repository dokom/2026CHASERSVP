import { z } from 'zod'

export const MAX_NOTE_LENGTH = 1000
const MAX_NAME_LENGTH = 80
/**
 * A request-size bound, not a seat policy: a party may be any size, but
 * one form post carrying more than this is almost certainly not a guest.
 */
export const MAX_GUESTS_PER_SUBMISSION = 100
export const PARTY_TOO_LARGE = 'That is too many people to submit in one go. Please contact the organiser.'

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
  guests: z
    .array(guestResponseSchema)
    .min(1, 'Tell us who is coming')
    .max(MAX_GUESTS_PER_SUBMISSION, PARTY_TOO_LARGE),
})

export type RsvpSubmission = z.infer<typeof rsvpSubmissionSchema>
