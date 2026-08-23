export type ExportRow = {
  inviteLabel: string; firstName: string; lastName: string; badgeName: string | null
  company: string | null; title: string | null; email: string | null; phone: string | null
  attending: boolean | null; meal: string | null; dietary: string[]; accessibilityNeeds: string | null
  table: string | null; checkedInAt: Date | null
}

const COLUMNS = ['invite', 'firstName', 'lastName', 'badgeName', 'company', 'title', 'email', 'phone',
  'attending', 'meal', 'dietary', 'accessibilityNeeds', 'table', 'checkedInAt'] as const

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r'])

/**
 * RFC 4180 quoting plus formula-injection neutralisation: guest-supplied text
 * goes into a file that opens in Excel. A leading apostrophe on a cell like
 * "-5" is the accepted cost of never executing "=HYPERLINK(...)".
 */
export function escapeCsvCell(value: string | null | undefined): string {
  const text = value ?? ''
  const safe = FORMULA_TRIGGERS.has(text.charAt(0)) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

export function csvHeader(): string {
  return COLUMNS.join(',')
}

export function guestsToCsvRows(rows: ExportRow[]): string[] {
  return rows.map((r) => [
    r.inviteLabel, r.firstName, r.lastName, r.badgeName, r.company, r.title, r.email, r.phone,
    r.attending === null ? '' : r.attending ? 'yes' : 'no',
    r.meal, r.dietary.join('; '), r.accessibilityNeeds, r.table,
    r.checkedInAt ? r.checkedInAt.toISOString() : '',
  ].map(escapeCsvCell).join(','))
}
