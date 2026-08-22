import QRCode from 'qrcode'
import JSZip from 'jszip'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export type QrItem = { label: string; url: string }

const DEFAULT_SIZE = 600

/** A4 in PDF points. */
const PAGE_WIDTH = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN = 36
const COLUMNS = 3
const ROWS = 4
const PER_PAGE = COLUMNS * ROWS
const LABEL_HEIGHT = 14

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

  for (const item of items) {
    const png = await renderQrPng(item.url)
    zip.file(uniqueName(safeFilename(item.label), used), png)
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

export async function buildQrPdf(items: QrItem[]): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)

  const cellWidth = (PAGE_WIDTH - MARGIN * 2) / COLUMNS
  const cellHeight = (PAGE_HEIGHT - MARGIN * 2) / ROWS
  const codeSize = Math.min(cellWidth, cellHeight - LABEL_HEIGHT) - 12

  const pageCount = Math.max(1, Math.ceil(items.length / PER_PAGE))

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    const pageItems = items.slice(pageIndex * PER_PAGE, (pageIndex + 1) * PER_PAGE)

    for (const [slot, item] of pageItems.entries()) {
      await drawQrCell(doc, page, font, item, slot, cellWidth, cellHeight, codeSize)
    }
  }

  return Buffer.from(await doc.save())
}

async function drawQrCell(
  doc: PDFDocument,
  page: import('pdf-lib').PDFPage,
  font: import('pdf-lib').PDFFont,
  item: QrItem,
  slot: number,
  cellWidth: number,
  cellHeight: number,
  codeSize: number,
): Promise<void> {
  const column = slot % COLUMNS
  const row = Math.floor(slot / COLUMNS)

  const cellLeft = MARGIN + column * cellWidth
  const cellTop = PAGE_HEIGHT - MARGIN - row * cellHeight

  const png = await doc.embedPng(await renderQrPng(item.url, 600))
  page.drawImage(png, {
    x: cellLeft + (cellWidth - codeSize) / 2,
    y: cellTop - codeSize - 4,
    width: codeSize,
    height: codeSize,
  })

  const label = item.label.length > 32 ? `${item.label.slice(0, 31)}…` : item.label
  const labelWidth = font.widthOfTextAtSize(label, 9)
  page.drawText(label, {
    x: cellLeft + (cellWidth - labelWidth) / 2,
    y: cellTop - codeSize - LABEL_HEIGHT - 4,
    size: 9,
    font,
    color: rgb(0.1, 0.1, 0.1),
  })
}
