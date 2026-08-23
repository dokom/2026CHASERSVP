import Papa from 'papaparse'

export const CSV_COLUMNS = [
  'label', 'seatsAllotted', 'tableNumber',
  'primaryFirstName', 'primaryLastName', 'primaryEmail',
  'primaryCompany', 'primaryTitle', 'adminNotes',
] as const

const REQUIRED_COLUMNS = ['label', 'primaryFirstName', 'primaryLastName'] as const

const MAX_SEATS = 20
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type ImportRow = {
  label: string
  seatsAllotted: number
  tableNumber: string
  adminNotes: string
  primaryGuest: {
    firstName: string
    lastName: string
    email: string
    company: string
    title: string
  }
}

export type ParsedRow = {
  rowNumber: number
  raw: Record<string, string>
  data: ImportRow | null
  errors: string[]
}

function cell(raw: Record<string, string>, key: string): string {
  return (raw[key] ?? '').trim()
}

function parseSeats(value: string, errors: string[]): number {
  if (value === '') return 1
  const seats = Number(value)
  if (!Number.isInteger(seats) || seats < 1 || seats > MAX_SEATS) {
    errors.push(`seats must be a whole number between 1 and ${MAX_SEATS}`)
    return 1
  }
  return seats
}

function validateRow(
  raw: Record<string, string>,
  rowNumber: number,
  seenEmails: Set<string>,
): ParsedRow {
  const errors: string[] = []

  const label = cell(raw, 'label')
  if (!label) errors.push('label is required')

  const firstName = cell(raw, 'primaryFirstName')
  if (!firstName) errors.push('primaryFirstName is required')

  const lastName = cell(raw, 'primaryLastName')
  if (!lastName) errors.push('primaryLastName is required')

  const seatsAllotted = parseSeats(cell(raw, 'seatsAllotted'), errors)

  const email = cell(raw, 'primaryEmail').toLowerCase()
  if (email && !EMAIL_PATTERN.test(email)) {
    errors.push('primaryEmail is not a valid email address')
  } else if (email && seenEmails.has(email)) {
    errors.push(`duplicate email ${email} appears earlier in this file`)
  } else if (email) {
    seenEmails.add(email)
  }

  return {
    rowNumber,
    raw,
    errors,
    data: errors.length
      ? null
      : {
          label,
          seatsAllotted,
          tableNumber: cell(raw, 'tableNumber'),
          adminNotes: cell(raw, 'adminNotes'),
          primaryGuest: {
            firstName,
            lastName,
            email,
            company: cell(raw, 'primaryCompany'),
            title: cell(raw, 'primaryTitle'),
          },
        },
  }
}

type RawRow = { fields: string[]; line: number }

// Parses the file with PapaParse's row-level `step` callback so we can derive
// each row's PHYSICAL line number from its cursor position, instead of its
// index in an already blank-line-stripped array. `skipEmptyLines` is left
// off here on purpose — blank lines must still consume a line number even
// though they are filtered out afterwards by the caller.
function collectRawRows(text: string): RawRow[] {
  const rows: RawRow[] = []
  let prevCursor = 0
  let lineCount = 0

  Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: false,
    step: (result) => {
      const cursor = result.meta.cursor
      const slice = text.slice(prevCursor, cursor)
      // A trailing newline at end-of-file produces one final, phantom empty
      // step whose cursor never advances — it isn't a real line, skip it.
      if (slice.length === 0) return

      const line = lineCount + 1
      const newlineCount = (slice.match(/\n/g) ?? []).length
      // A quoted field can embed newlines, so a single row may span several
      // physical lines; count them so the next row's number stays correct.
      lineCount += newlineCount + (slice.endsWith('\n') ? 0 : 1)
      prevCursor = cursor
      rows.push({ fields: result.data, line })
    },
  })

  return rows
}

function toRecord(headers: string[], fields: string[]): Record<string, string> {
  const record: Record<string, string> = {}
  headers.forEach((header, i) => {
    record[header] = fields[i] ?? ''
  })
  return record
}

export function parseInviteCsv(text: string): { headerErrors: string[]; rows: ParsedRow[] } {
  if (!text.trim()) return { headerErrors: ['The file is empty'], rows: [] }

  const [headerRow, ...dataRows] = collectRawRows(text)
  const headers = (headerRow?.fields ?? []).map((h) => h.trim())

  const headerErrors = REQUIRED_COLUMNS
    .filter((column) => !headers.includes(column))
    .map((column) => `Missing required column: ${column}`)

  if (headerErrors.length) return { headerErrors, rows: [] }

  const seenEmails = new Set<string>()
  const rows = dataRows
    .filter((row) => row.fields.some((v) => (v ?? '').trim() !== ''))
    // Row 1 is the header, so data rows start at 2 — matching what the operator sees.
    .map((row) => validateRow(toRecord(headers, row.fields), row.line, seenEmails))

  return { headerErrors: [], rows }
}

export function csvTemplate(): string {
  const example = [
    'Reyes Party', '2', '12', 'Jordan', 'Reyes',
    'jordan@example.com', 'Acme Corp', 'VP Engineering', 'Seated with the board',
  ]
  return `${CSV_COLUMNS.join(',')}\n${example.join(',')}\n`
}
