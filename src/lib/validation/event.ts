import { z } from 'zod'

const objectId = z.string().regex(/^[0-9a-f]{24}$/, 'Not a valid identifier')
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(''))

export const eventDetailsSchema = z.object({
  name: z.string().trim().min(1, 'Event name is required').max(160),
  tagline: optionalText(200),
  startsAt: z.coerce.date(),
  timezone: z.string().trim().min(1).max(64).default('UTC'),
  venueName: z.string().trim().min(1, 'Venue is required').max(160),
  address: z.string().trim().min(1, 'Address is required').max(400),
  dressCode: optionalText(120),
  rsvpDeadline: z.coerce.date(),
}).refine((v) => v.rsvpDeadline.getTime() < v.startsAt.getTime(), {
  message: 'The RSVP deadline must fall before the event starts',
  path: ['rsvpDeadline'],
})

export const agendaItemSchema = z.object({
  id: objectId.optional(),
  title: z.string().trim().min(1, 'Title is required').max(160),
  description: optionalText(1000),
  icon: optionalText(40),
  startsAt: z.coerce.date(),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
})

export const mealOptionSchema = z.object({
  id: objectId.optional(),
  label: z.string().trim().min(1, 'Label is required').max(80),
  description: optionalText(400),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
})

export const tableMarkerSchema = z.object({
  tableNumber: z.string().trim().min(1, 'Table number is required').max(20),
  x: z.coerce.number().min(0).max(1),
  y: z.coerce.number().min(0).max(1),
})
