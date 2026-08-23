import { describe, it, expect } from 'vitest'
import { csvHeader, guestsToCsvRows, escapeCsvCell } from '@/lib/guests/export'

describe('escapeCsvCell', () => {
  it('quotes a plain value', () => expect(escapeCsvCell('Reyes')).toBe('"Reyes"'))
  it('doubles embedded quotes', () => expect(escapeCsvCell('Jo "JJ" Reyes')).toBe('"Jo ""JJ"" Reyes"'))
  it('keeps embedded newlines inside the quotes', () => expect(escapeCsvCell('a\nb')).toBe('"a\nb"'))
  it('renders null as empty', () => expect(escapeCsvCell(null)).toBe('""'))

  it.each(['=', '+', '-', '@', '\t', '\r'])('neutralises a cell starting with %j (formula injection)', (ch) => {
    expect(escapeCsvCell(`${ch}HYPERLINK("x")`)).toBe(`"'${ch}HYPERLINK(""x"")"`)
  })

  it('does not touch a negative-looking value that is genuinely text', () => {
    // Prefixing is the whole defence; a leading apostrophe is the accepted cost.
    expect(escapeCsvCell('-5')).toBe('"\'-5"')
  })

  it('neutralises a formula trigger hidden behind leading whitespace', () => {
    expect(escapeCsvCell('  =HYPERLINK("x")')).toBe('"\'  =HYPERLINK(""x"")"')
  })

  it('neutralises a formula trigger hidden behind a leading newline', () => {
    expect(escapeCsvCell('\n=HYPERLINK("x")')).toBe('"\'\n=HYPERLINK(""x"")"')
  })
})

describe('guestsToCsvRows', () => {
  it('emits one line per guest in header order', () => {
    const rows = guestsToCsvRows([{
      inviteLabel: 'Reyes Party', firstName: 'Jordan', lastName: 'Reyes', badgeName: null,
      company: 'Northwind', title: 'VP', email: 'j@x.test', phone: null, attending: true,
      meal: 'Beef', dietary: ['nut-free', 'vegan'], accessibilityNeeds: null, table: '12',
      checkedInAt: new Date('2026-11-14T18:12:00Z'),
    }])
    expect(rows).toHaveLength(1)
    const cols = rows[0]!.split('","').map((c) => c.replace(/^"|"$/g, ''))
    expect(cols.length).toBe(csvHeader().split(',').length)
    expect(cols).toContain('nut-free; vegan')
    expect(cols).toContain('2026-11-14T18:12:00.000Z')
    expect(cols).toContain('yes')
  })

  it('renders unanswered attendance as blank, not "null"', () => {
    const [row] = guestsToCsvRows([{ inviteLabel: 'P', firstName: 'A', lastName: 'B', badgeName: null, company: null, title: null, email: null, phone: null, attending: null, meal: null, dietary: [], accessibilityNeeds: null, table: null, checkedInAt: null }])
    expect(row).not.toContain('null')
  })
})
