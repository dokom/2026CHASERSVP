import type { AuditClient } from '@/lib/audit'
import type { ImportRow } from './csv'

export type SkipReason =
  | 'label matches several invites'
  | 'email already exists'
  | 'same invite as an earlier row'

export type ImportAction =
  | { action: 'create' }
  | { action: 'update'; inviteId: string; primaryGuestId: string | null }
  | { action: 'skip'; reason: SkipReason }

export type PlannedRow = { row: ImportRow; plan: ImportAction }

type Candidate = { id: string; number: number; label: string; primaryGuestId: string | null }

/** "002" and "2" both name invite number 2; anything else is not a number. */
function bareNumber(label: string): number | null {
  return /^\d{1,9}$/.test(label) ? Number(label) : null
}

async function loadCandidates(db: AuditClient, rows: ImportRow[]): Promise<Candidate[]> {
  const labels = rows.map((row) => row.label)
  const numbers = labels.map(bareNumber).filter((n): n is number => n !== null)
  const found = await db.invite.findMany({
    where: { OR: [{ label: { in: labels } }, ...(numbers.length ? [{ number: { in: numbers } }] : [])] },
    select: {
      id: true, number: true, label: true,
      guests: { where: { isPrimary: true }, select: { id: true }, take: 1 },
    },
  })
  return found.map((invite) => ({
    id: invite.id, number: invite.number, label: invite.label,
    primaryGuestId: invite.guests[0]?.id ?? null,
  }))
}

export async function existingEmails(db: AuditClient, emails: string[]): Promise<Set<string>> {
  const wanted = emails.filter(Boolean).map((e) => e.toLowerCase())
  if (wanted.length === 0) return new Set()
  const found = await db.guest.findMany({ where: { email: { in: wanted } }, select: { email: true } })
  return new Set(found.map((guest) => guest.email!.toLowerCase()))
}

/**
 * Decides, per row, whether the import creates, updates or skips.
 *
 * The key is the row's label. Exactly one invite with that label: update
 * it. Several: skip, never guess. None, and the label is a bare number:
 * update the invite printed with that number (so a spreadsheet keyed on
 * the card numbers fills in a placeholder run, and still matches after the
 * organiser renames 002 to "Reyes Party"). Otherwise create, unless the
 * primary email is already in use, which is the existing dedupe rule and
 * applies to creates only.
 *
 * Two rows can resolve to the same invite under differently-spelled labels
 * (a placeholder's printed number and its later rename, or "2" and "002"
 * both naming card 2) — the CSV-level duplicate-label check can't see this
 * because it only compares labels verbatim. So each already-claimed invite
 * id is tracked as rows are planned in order; a later row that resolves to
 * an id an earlier row already claimed is skipped rather than updating the
 * same invite twice and leaving it with two primary guests.
 *
 * Runs against whatever client it is given so `commitInviteImport` can
 * call it inside its transaction and a concurrent edit cannot slip between
 * preview and commit.
 */
export async function planImport(db: AuditClient, rows: ImportRow[]): Promise<PlannedRow[]> {
  if (rows.length === 0) return []
  const [candidates, taken] = await Promise.all([
    loadCandidates(db, rows),
    existingEmails(db, rows.map((row) => row.primaryGuest.email)),
  ])

  const claimed = new Set<string>()
  return rows.map((row) => {
    const byLabel = candidates.filter((c) => c.label === row.label)
    if (byLabel.length > 1) return { row, plan: { action: 'skip', reason: 'label matches several invites' } }
    const match = byLabel[0] ?? candidates.find((c) => c.number === bareNumber(row.label))
    if (match) {
      if (claimed.has(match.id)) return { row, plan: { action: 'skip', reason: 'same invite as an earlier row' } }
      claimed.add(match.id)
      return { row, plan: { action: 'update', inviteId: match.id, primaryGuestId: match.primaryGuestId } }
    }

    const email = row.primaryGuest.email.toLowerCase()
    if (email && taken.has(email)) return { row, plan: { action: 'skip', reason: 'email already exists' } }
    return { row, plan: { action: 'create' } }
  })
}
