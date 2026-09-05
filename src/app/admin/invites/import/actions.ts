'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireCsrf, requireRole } from '@/lib/auth/guard'
import { parseInviteCsv, type ParsedRow } from '@/lib/invites/csv'
import { commitInviteImport, MAX_IMPORT_ROWS } from '@/lib/invites/import'
import { planImport } from '@/lib/invites/import-plan'
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
  /** Per rowNumber: what the commit will do with a valid row. */
  actions: Record<number, 'create' | 'update' | 'skip'>
  skipReasons: Record<number, string>
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
    return { headerErrors: ['Choose a CSV file'], rows: [], actions: {}, skipReasons: {}, payload: '' }
  }
  if (file.size > MAX_FILE_BYTES) {
    return { headerErrors: ['File is larger than 5 MB'], rows: [], actions: {}, skipReasons: {}, payload: '' }
  }

  const text = await file.text()
  const { headerErrors, rows } = parseInviteCsv(text)

  if (rows.length > MAX_IMPORT_ROWS) {
    return {
      headerErrors: [`File has ${rows.length} rows; the limit is ${MAX_IMPORT_ROWS}`],
      rows: [],
      actions: {},
      skipReasons: {},
      payload: '',
    }
  }

  const validRows = rows.filter((r) => r.data)
  const planned = await planImport(prisma, validRows.map((r) => r.data!))
  const actions: Record<number, 'create' | 'update' | 'skip'> = {}
  const skipReasons: Record<number, string> = {}
  planned.forEach(({ plan }, i) => {
    const rowNumber = validRows[i]!.rowNumber
    actions[rowNumber] = plan.action
    if (plan.action === 'skip') skipReasons[rowNumber] = plan.reason
  })
  return { headerErrors, rows, actions, skipReasons, payload: JSON.stringify(validRows.map((r) => r.data)) }
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
  redirect(`/admin/invites?imported=${result.created}&updated=${result.updated}&skipped=${result.skipped.length}`)
}
