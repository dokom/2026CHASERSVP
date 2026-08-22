import type { PrismaClient } from '@prisma/client'
import { inspectImage } from './images'
import { writeAudit } from '@/lib/audit'

/** Keeps a hostile filename from ever reaching a header or a log line. */
function safeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? 'upload'
  const cleaned = base.replace(/[^\w.-]/g, '-').replace(/^\.+/, '').slice(0, 120)
  return cleaned || 'upload'
}

function isMalformedIdError(error: unknown): boolean {
  return error instanceof Error && /malformed objectid/i.test(error.message)
}

export async function storeImage(
  db: PrismaClient,
  actorId: string | null,
  filename: string,
  bytes: Buffer,
): Promise<string> {
  // Throws before anything is written if the bytes are not a permitted image.
  const info = inspectImage(bytes)
  const cleanName = safeFilename(filename)

  return db.$transaction(async (tx) => {
    const asset = await tx.mediaAsset.create({
      data: {
        filename: cleanName,
        mimeType: info.mimeType,
        // Prisma's Bytes field wants a Uint8Array backed by a plain
        // ArrayBuffer; Buffer's type is backed by ArrayBufferLike (which
        // admits SharedArrayBuffer), so a copy keeps this call type-safe.
        bytes: Uint8Array.from(bytes),
        width: info.width,
        height: info.height,
      },
      select: { id: true },
    })
    await writeAudit(tx, {
      actorId,
      action: 'media.store',
      entity: 'MediaAsset',
      entityId: asset.id,
      // Metadata only — never the bytes.
      meta: { filename: cleanName, mimeType: info.mimeType, byteLength: bytes.length },
    })
    return asset.id
  })
}

export async function readImage(
  db: PrismaClient,
  id: string,
): Promise<{ bytes: Buffer; mimeType: string; filename: string } | null> {
  const asset = await db.mediaAsset
    .findUnique({ where: { id }, select: { bytes: true, mimeType: true, filename: true } })
    .catch((error: unknown) => {
      if (isMalformedIdError(error)) return null
      throw error
    })
  if (!asset) return null
  return { bytes: Buffer.from(asset.bytes), mimeType: asset.mimeType, filename: asset.filename }
}

export async function deleteImage(
  db: PrismaClient,
  actorId: string | null,
  id: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.mediaAsset.delete({ where: { id } })
    await writeAudit(tx, { actorId, action: 'media.delete', entity: 'MediaAsset', entityId: id })
  })
}
