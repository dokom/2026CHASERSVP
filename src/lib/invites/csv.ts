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

export function parseInviteCsv(text: string): { headerErrors: string[]; rows: ParsedRow[] } {
  if (!text.trim()) return { headerErrors: ['The file is empty'], rows: [] }

  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  })

  const headers = result.meta.fields ?? []
  const headerErrors = REQUIRED_COLUMNS
    .filter((column) => !headers.includes(column))
    .map((column) => `Missing required column: ${column}`)

  if (headerErrors.length) return { headerErrors, rows: [] }

  const seenEmails = new Set<string>()
  const rows = result.data
    .filter((raw) => Object.values(raw).some((v) => (v ?? '').trim() !== ''))
    // Row 1 is the header, so data rows start at 2 — matching what the operator sees.
    .map((raw, index) => validateRow(raw, index + 2, seenEmails))

  return { headerErrors: [], rows }
}

export function csvTemplate(): string {
  const example = [
    'Reyes Party', '2', '12', 'Jordan', 'Reyes',
    'jordan@example.com', 'Acme Corp', 'VP Engineering', 'Seated with the board',
  ]
  return `${CSV_COLUMNS.join(',')}\n${example.join(',')}\n`
}
