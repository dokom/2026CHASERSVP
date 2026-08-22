'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireCsrf, requireRole } from '@/lib/auth/guard'
import {
  createAdminUser,
  updateAdminRole,
  setAdminActive,
  resetAdminPassword,
  LastOwnerError,
  DuplicateEmailError,
} from '@/lib/admin-users/repository'
import {
  createAdminSchema,
  updateAdminRoleSchema,
  setAdminActiveSchema,
  resetAdminPasswordSchema,
} from '@/lib/validation/admin'

function fail(message: string): never {
  redirect(`/admin/users?error=${encodeURIComponent(message)}`)
}

function describe(error: unknown): string {
  if (error instanceof LastOwnerError || error instanceof DuplicateEmailError) return error.message
  return 'Something went wrong. Try again.'
}

export async function createUserAction(formData: FormData): Promise<void> {
  const actor = await requireRole('OWNER')
  await requireCsrf(formData)

  const parsed = createAdminSchema.safeParse({
    email: formData.get('email'),
    name: formData.get('name'),
    role: formData.get('role'),
    password: formData.get('password'),
  })
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? 'Invalid input')

  try {
    await createAdminUser(prisma, actor.id, parsed.data)
  } catch (error) {
    fail(describe(error))
  }
  revalidatePath('/admin/users')
}

export async function changeRoleAction(formData: FormData): Promise<void> {
  const actor = await requireRole('OWNER')
  await requireCsrf(formData)

  const parsed = updateAdminRoleSchema.safeParse({
    userId: formData.get('userId'),
    role: formData.get('role'),
  })
  if (!parsed.success) fail('Invalid role change')

  try {
    await updateAdminRole(prisma, actor.id, parsed.data.userId, parsed.data.role)
  } catch (error) {
    fail(describe(error))
  }
  revalidatePath('/admin/users')
}

export async function toggleActiveAction(formData: FormData): Promise<void> {
  const actor = await requireRole('OWNER')
  await requireCsrf(formData)

  const parsed = setAdminActiveSchema.safeParse({
    userId: formData.get('userId'),
    isActive: formData.get('isActive') === 'true',
  })
  if (!parsed.success) fail('Invalid request')

  try {
    await setAdminActive(prisma, actor.id, parsed.data.userId, parsed.data.isActive)
  } catch (error) {
    fail(describe(error))
  }
  revalidatePath('/admin/users')
}

export async function resetPasswordAction(formData: FormData): Promise<void> {
  const actor = await requireRole('OWNER')
  await requireCsrf(formData)

  const parsed = resetAdminPasswordSchema.safeParse({
    userId: formData.get('userId'),
    password: formData.get('password'),
  })
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? 'Invalid password')

  try {
    await resetAdminPassword(prisma, actor.id, parsed.data.userId, parsed.data.password)
  } catch (error) {
    fail(describe(error))
  }
  revalidatePath('/admin/users')
}
