export class InvalidImageError extends Error {
  constructor(reason: string) {
    // Never interpolate file contents: this message reaches an operator's screen.
    super(`Not a usable image: ${reason}`)
    this.name = 'InvalidImageError'
  }
}

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
export const MAX_DIMENSION = 8000

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

function readWebp(bytes: Buffer): ImageInfo | null {
  if (bytes.length < 30) return null
  if (bytes.toString('ascii', 0, 4) !== 'RIFF') return null
  if (bytes.toString('ascii', 8, 12) !== 'WEBP') return null
  if (bytes.toString('ascii', 12, 15) !== 'VP8') return null
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
  return info
}
