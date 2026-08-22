export class InvalidImageError extends Error {
  constructor(reason: string) {
    // Never interpolate file contents: this message reaches an operator's screen.
    super(`Not a usable image: ${reason}`)
    this.name = 'InvalidImageError'
  }
}

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_DIMENSION = 8000
// Catches the case the per-side cap misses: both sides individually under
// MAX_DIMENSION but their product still absurd (e.g. 8000 x 8000 = 64M px).
export const MAX_TOTAL_PIXELS = 40_000_000

export type ImageInfo = {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function readPng(bytes: Buffer): ImageInfo | null {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_MAGIC)) return null
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return null
  return { mimeType: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

/** Walks JPEG segments to the first start-of-frame marker, which carries the size. */
function readJpeg(bytes: Buffer): ImageInfo | null {
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) return null

  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes.readUInt8(offset) !== 0xff) return null
    const marker = bytes.readUInt8(offset + 1)
    // SOF0-SOF15, skipping the non-frame markers interleaved in that range.
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isFrame) {
      return {
        mimeType: 'image/jpeg',
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      }
    }
    offset += 2 + bytes.readUInt16BE(offset + 2)
  }
  return null
}

/**
 * Parses only the "simple" lossy VP8 container. WEBP also has VP8L
 * (lossless) and VP8X (extended: animation/alpha/ICC) sub-formats, which
 * encode their dimensions at different offsets and bit widths. The 3-char
 * check this replaced ('VP8') matched all three, so VP8L/VP8X bytes were
 * being read through the lossy layout and produced dimensions that were
 * simply wrong, not merely unsupported. Comparing the full 4-byte fourCC
 * ('VP8 ', with a trailing space, vs 'VP8L' / 'VP8X') accepts only the
 * container this function actually knows how to parse and rejects the rest,
 * rather than returning garbage for them.
 */
function readWebp(bytes: Buffer): ImageInfo | null {
  if (bytes.length < 30) return null
  if (bytes.toString('ascii', 0, 4) !== 'RIFF') return null
  if (bytes.toString('ascii', 8, 12) !== 'WEBP') return null
  if (bytes.toString('ascii', 12, 16) !== 'VP8 ') return null
  // Lossy VP8: 14-bit dimensions follow the 3-byte start code.
  return {
    mimeType: 'image/webp',
    width: bytes.readUInt16LE(23) & 0x3fff,
    height: bytes.readUInt16LE(25) & 0x3fff,
  }
}

/**
 * Decides an upload's type from its own leading bytes.
 *
 * The filename and the declared Content-Type are both attacker-controlled and
 * are never consulted. SVG is excluded deliberately: it is script-capable, and
 * serving one from our own origin would be a stored-XSS vector.
 *
 * IMPORTANT — width/height are self-declared header fields, never verified
 * against the payload. Doing that verification would mean decoding the
 * image, which would pull in an image codec as a dependency: a large native
 * supply-chain surface, decoding untrusted bytes, on a project holding PII.
 * That trade was deliberately rejected. So a file can pass this function
 * with a modest declared size and still carry arbitrary bytes after its
 * header, up to MAX_IMAGE_BYTES — the per-side and total-pixel checks below
 * bound only the claimed numbers, not the actual content. That is fine:
 * this module never executes or interprets the payload, it only stores and
 * later returns the same bytes, and the serving route sends them back with
 * the STORED Content-Type plus X-Content-Type-Options: nosniff, so a
 * browser never sniffs or executes them regardless of what they contain.
 */
export function inspectImage(bytes: Buffer): ImageInfo {
  if (bytes.length === 0) throw new InvalidImageError('the file is empty')
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new InvalidImageError(`larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`)
  }

  const info = readPng(bytes) ?? readJpeg(bytes) ?? readWebp(bytes)
  if (!info) throw new InvalidImageError('expected a PNG, JPEG or WEBP')

  if (info.width <= 0 || info.height <= 0) {
    throw new InvalidImageError('the image reports no size')
  }
  if (info.width > MAX_DIMENSION || info.height > MAX_DIMENSION) {
    throw new InvalidImageError(`larger than ${MAX_DIMENSION}px on a side`)
  }
  if (info.width * info.height > MAX_TOTAL_PIXELS) {
    throw new InvalidImageError(`more than ${MAX_TOTAL_PIXELS.toLocaleString()} total pixels`)
  }
  return info
}
