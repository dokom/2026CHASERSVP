import QRCode from 'qrcode'
import JSZip from 'jszip'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { escapeCsvCell } from '@/lib/guests/export'

/**
 * `number` is the printed index ("001"), already padded, so every export
 * format agrees on it; `label` is whatever the admin has named the invite
 * so far — for a fresh placeholder that is the same string.
 */
export type QrItem = { number?: string; label: string; url: string }

/** What is printed under the code and used to name its file. */
export function qrCaption(item: QrItem): string {
  if (!item.number) return item.label
  return item.label === item.number ? item.number : `${item.number} · ${item.label}`
}

const DEFAULT_SIZE = 600
/** Pixels per code inside the PDF: a 150pt cell printed at 2in is 160dpi from
 * 320px, crisp for a scanner and a quarter of the bytes of the 600px ZIP image. */
const PDF_CODE_SIZE = 320
/** Codes rendered concurrently. zlib runs on libuv's thread pool, so a few
 * in flight keep the CPU busy without holding hundreds of buffers at once. */
const RENDER_CONCURRENCY = 8

/** A4 in PDF points. */
const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 36
const COLUMNS = 3
const ROWS = 4
const PER_PAGE = COLUMNS * ROWS
/** The printed index sits under the code in bold; the party name, if any, under that. */
const NUMBER_SIZE = 14
const LABEL_SIZE = 8
const CAPTION_HEIGHT = NUMBER_SIZE + LABEL_SIZE + 6
const MAX_LABEL_CHARS = 34

/**
 * Builds the printable/scannable invite URL for a token.
 * Takes baseUrl as a parameter (never reads process.env) so this
 * module stays importable and testable outside of Next.js.
 */
export function inviteUrl(token: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/i/${encodeURIComponent(token)}`
}

export function safeFilename(label: string): string {
  const cleaned = label
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return cleaned || 'invite'
}

export async function renderQrPng(url: string, size: number = DEFAULT_SIZE): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: 'png',
    errorCorrectionLevel: 'M',
    width: size,
    margin: 1,
    color: { dark: '#000000ff', light: '#ffffffff' },
  })
}

/** Renders every item's code, a few at a time, preserving order. */
async function renderAll(items: QrItem[], size: number): Promise<Buffer[]> {
  const out: Buffer[] = []
  for (let start = 0; start < items.length; start += RENDER_CONCURRENCY) {
    const chunk = items.slice(start, start + RENDER_CONCURRENCY)
    out.push(...(await Promise.all(chunk.map((item) => renderQrPng(item.url, size)))))
  }
  return out
}

/** Appends a numeric suffix so two invites with the same label do not collide. */
function uniqueName(base: string, used: Set<string>): string {
  let name = `${base}.png`
  let counter = 2
  while (used.has(name)) {
    name = `${base}-${counter}.png`
    counter++
  }
  used.add(name)
  return name
}

export async function buildQrZip(items: QrItem[]): Promise<Buffer> {
  const zip = new JSZip()
  const used = new Set<string>()

  const pngs = await renderAll(items, DEFAULT_SIZE)
  items.forEach((item, index) => {
    // The number alone names the file: the printer matches "001.png" to
    // card 001 without caring what the invite is labelled this week.
    zip.file(uniqueName(safeFilename(item.number ?? item.label), used), pngs[index]!)
  })

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/**
 * The printer's manifest: one row per code, so the print shop can lay out
 * each card's number next to its URL (and generate their own codes if they
 * prefer). Cells go through the same formula-injection guard as the guest
 * export — a label is admin-typed text that will open in a spreadsheet.
 */
export function buildQrCsv(items: QrItem[]): string {
  const header = 'number,label,url'
  const rows = items.map((item) =>
    [item.number ?? '', item.label, item.url].map(escapeCsvCell).join(','),
  )
  return `${[header, ...rows].join('\r\n')}\r\n`
}

type Fonts = { regular: PDFFont; bold: PDFFont }

export async function buildQrPdf(items: QrItem[]): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  }

  const cellWidth = (PAGE_WIDTH - MARGIN * 2) / COLUMNS
  const cellHeight = (PAGE_HEIGHT - MARGIN * 2) / ROWS
  const codeSize = Math.min(cellWidth, cellHeight - CAPTION_HEIGHT) - 12

  const pngs = await renderAll(items, PDF_CODE_SIZE)
  const pageCount = Math.max(1, Math.ceil(items.length / PER_PAGE))

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    const pageItems = items.slice(pageIndex * PER_PAGE, (pageIndex + 1) * PER_PAGE)

    for (const [slot, item] of pageItems.entries()) {
      const png = pngs[pageIndex * PER_PAGE + slot]!
      await drawQrCell(doc, page, fonts, item, png, slot, cellWidth, cellHeight, codeSize)
    }
  }

  return Buffer.from(await doc.save())
}

async function drawQrCell(
  doc: PDFDocument,
  page: PDFPage,
  fonts: Fonts,
  item: QrItem,
  png: Buffer,
  slot: number,
  cellWidth: number,
  cellHeight: number,
  codeSize: number,
): Promise<void> {
  const column = slot % COLUMNS
  const row = Math.floor(slot / COLUMNS)

  const cellLeft = MARGIN + column * cellWidth
  const cellTop = PAGE_HEIGHT - MARGIN - row * cellHeight

  const image = await doc.embedPng(png)
  page.drawImage(image, {
    x: cellLeft + (cellWidth - codeSize) / 2,
    y: cellTop - codeSize - 4,
    width: codeSize,
    height: codeSize,
  })

  const centred = (text: string, font: PDFFont, size: number, y: number) =>
    page.drawText(text, {
      x: cellLeft + (cellWidth - font.widthOfTextAtSize(text, size)) / 2,
      y,
      size,
      font,
      color: rgb(0.1, 0.1, 0.1),
    })

  // The index is the line the print shop cuts on, so it is bold and on its
  // own; the party name (once the invite is assigned) is a smaller line
  // beneath. An un-numbered invite keeps its label as the headline.
  const headline = item.number ?? item.label
  const numberBaseline = cellTop - codeSize - 4 - NUMBER_SIZE
  centred(headline, fonts.bold, NUMBER_SIZE, numberBaseline)

  if (item.number && item.label !== item.number) {
    const label = item.label.length > MAX_LABEL_CHARS ? `${item.label.slice(0, MAX_LABEL_CHARS - 1)}…` : item.label
    centred(label, fonts.regular, LABEL_SIZE, numberBaseline - LABEL_SIZE - 3)
  }
}
