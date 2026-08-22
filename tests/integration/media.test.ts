import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { testDb, resetDb } from '../helpers/db'
import { storeImage, readImage, deleteImage } from '@/lib/media/repository'
import { InvalidImageError } from '@/lib/media/images'

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
    const id = await storeImage(testDb, null, 'floorplan.png', pngHeader())
    await deleteImage(testDb, null, id)
    const logs = await testDb.auditLog.findMany()
    expect(logs.map((l) => l.action)).toEqual(
      expect.arrayContaining(['media.store', 'media.delete']),
    )
    expect(JSON.stringify(logs).length).toBeLessThan(2000)
  })
})
