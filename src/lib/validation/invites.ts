import { z } from 'zod'

export const primaryGuestSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName: z.string().trim().min(1, 'Last name is required').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email').optional().or(z.literal('')),
  company: z.string().trim().max(160).optional().or(z.literal('')),
  title: z.string().trim().max(160).optional().or(z.literal('')),
})

export const createInviteSchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(160),
  seatsAllotted: z.coerce.number().int().min(1, 'At least one seat').max(20),
  tableNumber: z.string().trim().max(20).optional().or(z.literal('')),
  adminNotes: z.string().trim().max(2000).optional().or(z.literal('')),
  primaryGuest: primaryGuestSchema,
})

export const updateInviteSchema = z.object({
  label: z.string().trim().min(1).max(160).optional(),
  seatsAllotted: z.coerce.number().int().min(1).max(20).optional(),
  tableNumber: z.string().trim().max(20).optional(),
  adminNotes: z.string().trim().max(2000).optional(),
})

export const inviteQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(['PENDING', 'ATTENDING', 'DECLINED', 'PARTIAL']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})
