import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { storeImage, readImage, readFloorplanImage, deleteImage } from '@/lib/media/repository'
import { InvalidImageError, MAX_TOTAL_PIXELS, MAX_DIMENSION } from '@/lib/media/images'

function pngHeader(width = 100, height = 100): Buffer {
  const buffer = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0)
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'ascii')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

beforeEach(resetDb)
afterAll(() => testDb.$disconnect())

describe('media repository', () => {
  it('stores an image and reads it back byte-identical', async () => {
    const bytes = pngHeader(1200, 800)
    const id = await storeImage(testDb, null, 'floorplan.png', bytes)
    const stored = await readImage(testDb, id)
    expect(stored?.mimeType).toBe('image/png')
    expect(Buffer.compare(stored!.bytes, bytes)).toBe(0)
  })

  it('records the dimensions it sniffed', async () => {
    const id = await storeImage(testDb, null, 'floorplan.png', pngHeader(1200, 800))
    const row = await testDb.mediaAsset.findUniqueOrThrow({ where: { id } })
    expect(row).toMatchObject({ width: 1200, height: 800 })
  })

  it('refuses a file that is not an image', async () => {
    await expect(storeImage(testDb, null, 'evil.png', Buffer.from('#!/bin/sh')))
      .rejects.toBeInstanceOf(InvalidImageError)
  })

  it('stores nothing when the file is refused', async () => {
    await storeImage(testDb, null, 'evil.png', Buffer.from('#!/bin/sh')).catch(() => undefined)
    expect(await testDb.mediaAsset.count()).toBe(0)
  })

  it('I4b: refuses a valid-looking header + large arbitrary payload whose ' +
    'self-declared pixel count exceeds the total cap, and stores nothing', async () => {
    const side = Math.ceil(Math.sqrt(MAX_TOTAL_PIXELS)) + 1
    expect(side).toBeLessThanOrEqual(MAX_DIMENSION)
    const bytes = Buffer.concat([pngHeader(side, side), Buffer.alloc(1024 * 1024, 0xab)])
    await expect(storeImage(testDb, null, 'floorplan.png', bytes))
      .rejects.toBeInstanceOf(InvalidImageError)
    expect(await testDb.mediaAsset.count()).toBe(0)
  })

  it('DERIVES the mime type from the bytes, ignoring the filename', async () => {
    // A .jpg extension on PNG bytes must be stored as image/png.
    const id = await storeImage(testDb, null, 'lying-name.jpg', pngHeader())
    expect((await readImage(testDb, id))?.mimeType).toBe('image/png')
  })

  it('returns null for an unknown id', async () => {
    expect(await readImage(testDb, '0'.repeat(24))).toBeNull()
  })

  it('returns null rather than throwing for a malformed id', async () => {
    // Ids arrive straight from the URL; a malformed ObjectId must be a 404.
    await expect(readImage(testDb, 'not-an-objectid')).resolves.toBeNull()
  })

  it('sanitises the stored filename', async () => {
    const id = await storeImage(testDb, null, '../../etc/passwd.png', pngHeader())
    const stored = await readImage(testDb, id)
    expect(stored?.filename).not.toContain('..')
    expect(stored?.filename).not.toContain('/')
  })

  it('deletes an image', async () => {
    const id = await storeImage(testDb, null, 'floorplan.png', pngHeader())
    await deleteImage(testDb, null, id)
    expect(await readImage(testDb, id)).toBeNull()
  })

  it('audits storage and deletion without recording the bytes', async () => {
    const bytes = pngHeader(1200, 800)
    const id = await storeImage(testDb, null, 'floorplan.png', bytes)
    await deleteImage(testDb, null, id)
    const logs = await testDb.auditLog.findMany()
    expect(logs.map((l) => l.action)).toEqual(
      expect.arrayContaining(['media.store', 'media.delete']),
    )
    const storeLog = logs.find((l) => l.action === 'media.store')
    // The proxy this replaces — asserting the whole log payload serializes
    // under 2000 chars — would still pass with a kilobyte of leaked image
    // bytes tucked into meta. Assert the real property instead: meta is
    // exactly the small, documented metadata object, nothing more, and
    // none of the actual pixel bytes appear in it anywhere.
    expect(storeLog?.meta).toEqual({
      filename: 'floorplan.png',
      mimeType: 'image/png',
      byteLength: bytes.length,
    })
    expect(JSON.stringify(storeLog?.meta)).not.toContain(bytes.toString('base64'))
  })
})

describe('readFloorplanImage', () => {
  async function seedEventWithFloorplan(assetId: string | null) {
    return testDb.event.create({
      data: {
        name: 'Gala, 2026',
        startsAt: new Date('2026-11-14T18:00:00Z'),
        venueName: 'The Grand Hall',
        address: '1 Placeholder Avenue',
        rsvpDeadline: new Date('2026-10-24T23:59:00Z'),
        ...(assetId ? { floorplanAssetId: assetId } : {}),
      },
    })
  }

  it('serves the current event\'s floorplan unauthenticated', async () => {
    const id = await storeImage(testDb, null, 'floorplan.png', pngHeader(1200, 800))
    await seedEventWithFloorplan(id)
    const asset = await readFloorplanImage(testDb, id)
    expect(asset?.mimeType).toBe('image/png')
  })

  it('I5: 404s (returns null) for a MediaAsset that is not the current floorplan', async () => {
    const floorplanId = await storeImage(testDb, null, 'floorplan.png', pngHeader())
    const otherId = await storeImage(testDb, null, 'other.png', pngHeader())
    await seedEventWithFloorplan(floorplanId)
    expect(await readFloorplanImage(testDb, otherId)).toBeNull()
  })

  it('I5: 404s when no event has configured a floorplan yet', async () => {
    const id = await storeImage(testDb, null, 'floorplan.png', pngHeader())
    // No Event row at all.
    expect(await readFloorplanImage(testDb, id)).toBeNull()
  })

  it('I5: 404s for an unknown or malformed id, without throwing', async () => {
    const floorplanId = await storeImage(testDb, null, 'floorplan.png', pngHeader())
    await seedEventWithFloorplan(floorplanId)
    expect(await readFloorplanImage(testDb, 'not-an-objectid')).toBeNull()
  })
})
