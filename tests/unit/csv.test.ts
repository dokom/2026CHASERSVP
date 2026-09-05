import { describe, it, expect } from 'vitest'
import { parseInviteCsv, csvTemplate, CSV_COLUMNS } from '@/lib/invites/csv'

const HEADER = 'label,seatsAllotted,tableNumber,primaryFirstName,primaryLastName,primaryEmail,primaryCompany,primaryTitle,adminNotes'

describe('parseInviteCsv', () => {
  it('parses a valid row', () => {
    const csv = `${HEADER}\nReyes Party,2,12,Jordan,Reyes,jordan@example.com,Acme,VP,VIP`
    const { headerErrors, rows } = parseInviteCsv(csv)
    expect(headerErrors).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.errors).toEqual([])
    expect(rows[0]?.data).toMatchObject({
      label: 'Reyes Party',
      seatsAllotted: 2,
      tableNumber: '12',
      primaryGuest: { firstName: 'Jordan', lastName: 'Reyes', email: 'jordan@example.com' },
    })
  })

  it('numbers rows from 2 so they match the spreadsheet', () => {
    const csv = `${HEADER}\nA,1,,Ada,Okafor,,,,\nB,1,,Sam,Reyes,,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 3])
  })

  it('reports a missing required column', () => {
    const { headerErrors } = parseInviteCsv('label,seatsAllotted\nA,1')
    expect(headerErrors.join(' ')).toMatch(/primaryFirstName/)
  })

  it('accepts columns in any order', () => {
    const csv = 'primaryLastName,primaryFirstName,label,seatsAllotted\nOkafor,Ada,A Party,3'
    const { headerErrors, rows } = parseInviteCsv(csv)
    expect(headerErrors).toEqual([])
    expect(rows[0]?.data?.seatsAllotted).toBe(3)
  })

  it('flags a missing label', () => {
    const csv = `${HEADER}\n,2,,Jordan,Reyes,,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows[0]?.data).toBeNull()
    expect(rows[0]?.errors.join(' ')).toMatch(/label/i)
  })

  it('flags a non-integer seat count', () => {
    const csv = `${HEADER}\nA,two,,Jordan,Reyes,,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows[0]?.errors.join(' ')).toMatch(/seats/i)
  })

  it('flags a seat count below one', () => {
    const csv = `${HEADER}\nA,0,,Jordan,Reyes,,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows[0]?.errors.join(' ')).toMatch(/seats/i)
  })

  it('defaults a blank seat count to 1', () => {
    const csv = `${HEADER}\nA,,,Jordan,Reyes,,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows[0]?.data?.seatsAllotted).toBe(1)
  })

  it('flags a malformed email', () => {
    const csv = `${HEADER}\nA,1,,Jordan,Reyes,not-an-email,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows[0]?.errors.join(' ')).toMatch(/email/i)
  })

  it('accepts a blank email', () => {
    const csv = `${HEADER}\nA,1,,Jordan,Reyes,,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows[0]?.errors).toEqual([])
    expect(rows[0]?.data?.primaryGuest.email).toBe('')
  })

  it('flags a duplicate email within the file', () => {
    const csv = `${HEADER}\nA,1,,Jordan,Reyes,dupe@example.com,,,\nB,1,,Sam,Okafor,dupe@example.com,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows[0]?.errors).toEqual([])
    expect(rows[1]?.errors.join(' ')).toMatch(/duplicate/i)
  })

  it('treats duplicate emails case-insensitively', () => {
    const csv = `${HEADER}\nA,1,,Jordan,Reyes,dupe@example.com,,,\nB,1,,Sam,Okafor,DUPE@Example.COM,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows[1]?.errors.join(' ')).toMatch(/duplicate/i)
  })

  it('flags a label that repeats within the file, keeping the first', () => {
    const csv = `${HEADER}\n002,1,,Ada,Okafor,,,,\n002,1,,Sam,Reyes,,,,\n003,1,,Mira,L,,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows[0]?.errors).toEqual([])
    expect(rows[1]?.errors).toEqual(['duplicate label in file'])
    expect(rows[1]?.data).toBeNull()
    expect(rows[2]?.errors).toEqual([])
  })

  it('trims surrounding whitespace', () => {
    const csv = `${HEADER}\n"  Reyes Party ",2,, Jordan , Reyes ,,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows[0]?.data?.label).toBe('Reyes Party')
    expect(rows[0]?.data?.primaryGuest.firstName).toBe('Jordan')
  })

  it('skips entirely blank lines', () => {
    const csv = `${HEADER}\nA,1,,Jordan,Reyes,,,,\n,,,,,,,,\n`
    const { rows } = parseInviteCsv(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.rowNumber).toBe(2)
  })

  it('numbers a row after a blank line by its physical line, not array index', () => {
    const csv = `${HEADER}\nA,1,,Ada,Okafor,,,,\n\nB,1,,Sam,Reyes,,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 4])
  })

  it('numbers a row correctly after several consecutive blank lines', () => {
    const csv = `${HEADER}\nA,1,,Ada,Okafor,,,,\n\n\n\nB,1,,Sam,Reyes,,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 6])
  })

  it('keeps physical line numbers correct after a quoted embedded newline', () => {
    const csv = `${HEADER}\nA,1,,Ada,"Oka\nfor",,,,\nB,1,,Sam,Reyes,,,,`
    const { rows } = parseInviteCsv(csv)
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 4])
    expect(rows[0]?.data?.primaryGuest.lastName).toBe('Oka\nfor')
  })

  it('returns no rows for a header-only file', () => {
    expect(parseInviteCsv(HEADER).rows).toEqual([])
  })

  it('reports an error for an empty file', () => {
    expect(parseInviteCsv('').headerErrors.length).toBeGreaterThan(0)
  })
})

describe('csvTemplate', () => {
  it('emits every column in the documented order', () => {
    expect(csvTemplate().split('\n')[0]).toBe(CSV_COLUMNS.join(','))
  })

  it('includes one example row', () => {
    expect(csvTemplate().trim().split('\n')).toHaveLength(2)
  })
})
