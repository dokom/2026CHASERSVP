import { z } from 'zod'
import { MIN_PASSWORD_LENGTH } from '@/lib/crypto/password'

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})

export const createAdminSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  name: z.string().trim().min(1, 'Name is required').max(120),
  role: z.enum(['OWNER', 'ADMIN', 'STAFF']),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
})

export const updateAdminRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['OWNER', 'ADMIN', 'STAFF']),
})

export const setAdminActiveSchema = z.object({
  userId: z.string().min(1),
  isActive: z.coerce.boolean(),
})

export const resetAdminPasswordSchema = z.object({
  userId: z.string().min(1),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
})
