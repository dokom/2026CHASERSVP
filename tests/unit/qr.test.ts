import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import {
  inviteUrl, renderQrPng, buildQrZip, buildQrPdf, buildQrCsv, qrCaption, safeFilename,
} from '@/lib/invites/qr'

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])

describe('inviteUrl', () => {
  it('builds the scan target', () => {
    expect(inviteUrl('abc123', 'https://gala.example.com')).toBe('https://gala.example.com/i/abc123')
  })

  it('tolerates a trailing slash on the base', () => {
    expect(inviteUrl('abc123', 'https://gala.example.com/')).toBe('https://gala.example.com/i/abc123')
  })

  it('percent-encodes a token containing URL-unsafe characters', () => {
    expect(inviteUrl('a/b', 'https://x.test')).toBe('https://x.test/i/a%2Fb')
  })
})

describe('safeFilename', () => {
  it('replaces path separators and spaces', () => {
    expect(safeFilename('Reyes / Okafor Party')).toBe('Reyes-Okafor-Party')
  })

  it('falls back for an empty label', () => {
    expect(safeFilename('   ')).toBe('invite')
  })

  it('truncates a very long label', () => {
    expect(safeFilename('x'.repeat(200)).length).toBeLessThanOrEqual(80)
  })
})

describe('renderQrPng', () => {
  it('returns a PNG buffer', async () => {
    const png = await renderQrPng('https://gala.example.com/i/abc')
    expect(png.subarray(0, 4).equals(PNG_MAGIC)).toBe(true)
  })

  it('honours the requested size', async () => {
    const small = await renderQrPng('https://gala.example.com/i/abc', 200)
    const large = await renderQrPng('https://gala.example.com/i/abc', 800)
    expect(large.length).toBeGreaterThan(small.length)
  })
})

describe('buildQrZip', () => {
  it('contains one PNG per item, named by label', async () => {
    const zip = await buildQrZip([
      { label: 'Reyes Party', url: 'https://x.test/i/a' },
      { label: 'Okafor Party', url: 'https://x.test/i/b' },
    ])
    const archive = await JSZip.loadAsync(zip)
    const names = Object.keys(archive.files).sort()
    expect(names).toEqual(['Okafor-Party.png', 'Reyes-Party.png'])
  })

  it('disambiguates duplicate labels', async () => {
    const zip = await buildQrZip([
      { label: 'Party', url: 'https://x.test/i/a' },
      { label: 'Party', url: 'https://x.test/i/b' },
    ])
    const archive = await JSZip.loadAsync(zip)
    expect(Object.keys(archive.files).sort()).toEqual(['Party-2.png', 'Party.png'])
  })

  it('produces an empty archive for no items', async () => {
    const archive = await JSZip.loadAsync(await buildQrZip([]))
    expect(Object.keys(archive.files)).toHaveLength(0)
  })

  it('names numbered codes by their printed number, whatever the label says', async () => {
    const zip = await buildQrZip([
      { number: '001', label: '001', url: 'https://x.test/i/a' },
      { number: '002', label: 'Reyes Party', url: 'https://x.test/i/b' },
    ])
    const archive = await JSZip.loadAsync(zip)
    expect(Object.keys(archive.files).sort()).toEqual(['001.png', '002.png'])
  })
})

describe('qrCaption', () => {
  it('is the bare number for an unassigned placeholder', () => {
    expect(qrCaption({ number: '001', label: '001', url: 'u' })).toBe('001')
  })

  it('pairs the number with the label once the invite is named', () => {
    expect(qrCaption({ number: '001', label: 'Reyes Party', url: 'u' })).toBe('001 · Reyes Party')
  })

  it('falls back to the label alone without a number', () => {
    expect(qrCaption({ label: 'Reyes Party', url: 'u' })).toBe('Reyes Party')
  })
})

describe('buildQrCsv', () => {
  it('lists number, label and URL per row for the printer', () => {
    const csv = buildQrCsv([
      { number: '001', label: '001', url: 'https://x.test/i/a' },
      { number: '002', label: 'Reyes Party', url: 'https://x.test/i/b' },
    ])
    expect(csv.split(String.fromCharCode(13, 10))).toEqual([
      'number,label,url',
      '"001","001","https://x.test/i/a"',
      '"002","Reyes Party","https://x.test/i/b"',
      '',
    ])
  })

  it('neutralises a label that would open as a spreadsheet formula', () => {
    const csv = buildQrCsv([{ number: '001', label: '=HYPERLINK("x")', url: 'u' }])
    expect(csv).toContain('"\'=HYPERLINK(""x"")"')
  })
})

describe('buildQrPdf', () => {
  it('returns a loadable PDF', async () => {
    const pdf = await buildQrPdf([{ label: 'Reyes Party', url: 'https://x.test/i/a' }])
    const doc = await PDFDocument.load(pdf)
    expect(doc.getPageCount()).toBe(1)
  })

  it('paginates at 12 codes per page', { timeout: 20_000 }, async () => {
    const items = Array.from({ length: 13 }, (_, i) => ({
      label: `Party ${i}`, url: `https://x.test/i/${i}`,
    }))
    const doc = await PDFDocument.load(await buildQrPdf(items))
    expect(doc.getPageCount()).toBe(2)
  })

  it('emits a single empty page for no items', async () => {
    const doc = await PDFDocument.load(await buildQrPdf([]))
    expect(doc.getPageCount()).toBe(1)
  })
})
