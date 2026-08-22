'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireCsrf, requireRole } from '@/lib/auth/guard'
import { parseInviteCsv, type ParsedRow, type ImportRow } from '@/lib/invites/csv'
import { commitInviteImport, MAX_IMPORT_ROWS } from '@/lib/invites/import'

const MAX_FILE_BYTES = 5 * 1024 * 1024

export type PreviewState = {
  headerErrors: string[]
  rows: ParsedRow[]
  payload: string
} | null

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
  let rows: ImportRow[]
  try {
    const decoded: unknown = JSON.parse(payload)
    if (!Array.isArray(decoded)) throw new Error('not an array')
    rows = decoded as ImportRow[]
  } catch {
    redirect('/admin/invites/import?error=Could+not+read+the+validated+rows')
  }

  const result = await commitInviteImport(prisma, actor.id, rows)
  revalidatePath('/admin/invites')
  redirect(`/admin/invites?imported=${result.created}&skipped=${result.skippedExistingEmails.length}`)
}
