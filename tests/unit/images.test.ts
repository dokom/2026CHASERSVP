import { describe, it, expect } from 'vitest'
import {
  inspectImage, InvalidImageError, MAX_IMAGE_BYTES, MAX_DIMENSION, MAX_TOTAL_PIXELS,
} from '@/lib/media/images'

/** Minimal but structurally real headers — enough for a sniffer to parse. */
function pngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0)
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'ascii')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

function jpegHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(20)
  buffer.writeUInt16BE(0xffd8, 0)   // SOI
  buffer.writeUInt16BE(0xffc0, 2)   // SOF0
  buffer.writeUInt16BE(11, 4)       // segment length
  buffer.writeUInt8(8, 6)           // precision
  buffer.writeUInt16BE(height, 7)
  buffer.writeUInt16BE(width, 9)
  return buffer
}

function webpHeader(width: number, height: number): Buffer {
  return webpHeaderWithFourCC('VP8 ', width, height)
}

/** Same layout as webpHeader(), but with an overridable fourCC — for
 * exercising the VP8L/VP8X containers this codebase deliberately can't
 * parse and must reject instead of misreading. */
function webpHeaderWithFourCC(fourCC: string, width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(22, 4)
  buffer.write('WEBP', 8, 'ascii')
  buffer.write(fourCC, 12, 'ascii')
  buffer.writeUInt32LE(10, 16)
  buffer.writeUInt16LE(0x9d01, 20)
  buffer.writeUInt8(0x2a, 22)
  buffer.writeUInt16LE(width, 23)
  buffer.writeUInt16LE(height, 25)
  return buffer
}

describe('inspectImage', () => {
  it('identifies a PNG and reads its dimensions', () => {
    expect(inspectImage(pngHeader(1200, 800)))
      .toEqual({ mimeType: 'image/png', width: 1200, height: 800 })
  })

  it('identifies a JPEG and reads its dimensions', () => {
    expect(inspectImage(jpegHeader(640, 480)))
      .toEqual({ mimeType: 'image/jpeg', width: 640, height: 480 })
  })

  it('identifies a WEBP and reads its dimensions', () => {
    expect(inspectImage(webpHeader(300, 200)))
      .toEqual({ mimeType: 'image/webp', width: 300, height: 200 })
  })

  it('REJECTS a VP8L (lossless) WEBP rather than misreading it as lossy VP8', () => {
    // Same fourCC prefix as lossy VP8; a naive 3-char check would let this
    // through and read garbage dimensions out of the wrong byte offsets.
    expect(() => inspectImage(webpHeaderWithFourCC('VP8L', 300, 200)))
      .toThrow(InvalidImageError)
  })

  it('REJECTS a VP8X (extended) WEBP rather than misreading it as lossy VP8', () => {
    expect(() => inspectImage(webpHeaderWithFourCC('VP8X', 300, 200)))
      .toThrow(InvalidImageError)
  })

  it('REJECTS a file whose bytes are not an image, whatever it claims to be', () => {
    // The attack this exists to stop: an executable or script renamed .png.
    expect(() => inspectImage(Buffer.from('#!/bin/sh\nrm -rf /', 'utf8')))
      .toThrow(InvalidImageError)
  })

  it('rejects an SVG, which is script-capable and not on the allowlist', () => {
    expect(() => inspectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')))
      .toThrow(InvalidImageError)
  })

  it('rejects a GIF, which is a real image but not on the allowlist', () => {
    expect(() => inspectImage(Buffer.from('GIF89a', 'ascii'))).toThrow(InvalidImageError)
  })

  it('rejects an empty buffer', () => {
    expect(() => inspectImage(Buffer.alloc(0))).toThrow(InvalidImageError)
  })

  it('rejects a truncated PNG header', () => {
    expect(() => inspectImage(pngHeader(100, 100).subarray(0, 12))).toThrow(InvalidImageError)
  })

  it('rejects zero dimensions', () => {
    expect(() => inspectImage(pngHeader(0, 100))).toThrow(InvalidImageError)
  })

  it('rejects absurd dimensions that would exhaust memory downstream', () => {
    expect(() => inspectImage(pngHeader(MAX_DIMENSION + 1, 100))).toThrow(InvalidImageError)
  })

  it('rejects a file larger than the cap', () => {
    const huge = Buffer.concat([pngHeader(100, 100), Buffer.alloc(MAX_IMAGE_BYTES)])
    expect(() => inspectImage(huge)).toThrow(InvalidImageError)
  })

  it('rejects total pixel count over the cap even when each side is within MAX_DIMENSION', () => {
    // Both sides individually legal (well under MAX_DIMENSION), but their
    // product exceeds MAX_TOTAL_PIXELS — the case the per-side cap alone
    // cannot catch.
    const side = Math.ceil(Math.sqrt(MAX_TOTAL_PIXELS)) + 1
    expect(side).toBeLessThanOrEqual(MAX_DIMENSION)
    expect(() => inspectImage(pngHeader(side, side))).toThrow(InvalidImageError)
  })

  it('I4b: a syntactically valid header followed by a large arbitrary payload is still ' +
    'rejected on its self-declared, unverified dimensions', () => {
    // Dimensions are read from the header alone and never checked against
    // what follows — a small/valid-looking header can be glued to
    // megabytes of unrelated bytes. Here the header's declared pixel count
    // is what triggers rejection; the trailing payload's content is never
    // even consulted, only its presence (well under the byte-size cap) is
    // exercised to prove that fact.
    const side = Math.ceil(Math.sqrt(MAX_TOTAL_PIXELS)) + 1
    const arbitraryPayload = Buffer.alloc(1024 * 1024, 0xab)
    const bytes = Buffer.concat([pngHeader(side, side), arbitraryPayload])
    expect(() => inspectImage(bytes)).toThrow(InvalidImageError)
  })

  it('never puts file contents in its error message', () => {
    try {
      inspectImage(Buffer.from('SECRET-CONTENT-MARKER', 'utf8'))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as Error).message).not.toContain('SECRET-CONTENT-MARKER')
    }
  })
})
