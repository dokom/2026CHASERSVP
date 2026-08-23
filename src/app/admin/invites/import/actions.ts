'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireCsrf, requireRole } from '@/lib/auth/guard'
import { parseInviteCsv, type ParsedRow } from '@/lib/invites/csv'
import { commitInviteImport, MAX_IMPORT_ROWS } from '@/lib/invites/import'
import { importRowSchema } from '@/lib/validation/invites'

const MAX_FILE_BYTES = 5 * 1024 * 1024

// Re-validates the entire decoded commit payload — the preview and the
// commit are two separate requests, and nothing carries integrity between
// them. A row edited in devtools between those requests (out-of-range
// seats, a missing name, a malformed email, a duplicate) must fail here
// rather than reach `commitInviteImport` as a bare cast.
const importRowsSchema = z.array(importRowSchema).max(MAX_IMPORT_ROWS)

export type PreviewState = {
  headerErrors: string[]
  rows: ParsedRow[]
  payload: string
} | null

function failImport(message: string): never {
  redirect(`/admin/invites/import?error=${encodeURIComponent(message)}`)
}

export async function validateCsvAction(
  _prev: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  await requireRole('ADMIN')
  await requireCsrf(formData)

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { headerErrors: ['Choose a CSV file'], rows: [], payload: '' }
  }
  if (file.size > MAX_FILE_BYTES) {
    return { headerErrors: ['File is larger than 5 MB'], rows: [], payload: '' }
  }

  const text = await file.text()
  const { headerErrors, rows } = parseInviteCsv(text)

  if (rows.length > MAX_IMPORT_ROWS) {
    return {
      headerErrors: [`File has ${rows.length} rows; the limit is ${MAX_IMPORT_ROWS}`],
      rows: [],
      payload: '',
    }
  }

  const valid = rows.filter((r) => r.data).map((r) => r.data!)
  return { headerErrors, rows, payload: JSON.stringify(valid) }
}

export async function commitCsvAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const payload = String(formData.get('payload') ?? '[]')
  let decoded: unknown
  try {
    decoded = JSON.parse(payload)
  } catch {
    failImport('Could not read the validated rows')
  }

  const parsed = importRowsSchema.safeParse(decoded)
  if (!parsed.success) {
    failImport(parsed.error.issues[0]?.message ?? 'The validated rows failed re-validation')
  }

  const result = await commitInviteImport(prisma, actor.id, parsed.data)
  revalidatePath('/admin/invites')
  redirect(`/admin/invites?imported=${result.created}&skipped=${result.skippedExistingEmails.length}`)
}
