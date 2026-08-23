import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { PDFDocument } from 'pdf-lib'
import {
  inviteUrl, renderQrPng, buildQrZip, buildQrPdf, safeFilename,
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
})

describe('buildQrPdf', () => {
  it('returns a loadable PDF', async () => {
    const pdf = await buildQrPdf([{ label: 'Reyes Party', url: 'https://x.test/i/a' }])
    const doc = await PDFDocument.load(pdf)
    expect(doc.getPageCount()).toBe(1)
  })

  it('paginates at 12 codes per page', async () => {
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
