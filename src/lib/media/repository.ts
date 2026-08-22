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

/**
 * Mirrors the "one event per deployment" lookup in events/repository.ts
 * (oldest-first `findFirst`, so a stray second row can never shadow the
 * real one) without pulling in that module's full agenda/meal/marker
 * select — this call site only ever needs the one field.
 */
async function getCurrentFloorplanAssetId(db: PrismaClient): Promise<string | null> {
  const event = await db.event.findFirst({
    select: { floorplanAssetId: true },
    orderBy: { createdAt: 'asc' },
  })
  return event?.floorplanAssetId ?? null
}

/**
 * The only image this deployment serves to an unauthenticated caller: the
 * current event's floorplan. Every other MediaAsset id — including past
 * floorplans an event update has since replaced — 404s, even though the
 * table holds only operator uploads today. That "only operator uploads"
 * fact is not a promise this function should lean on; scoping to the
 * live floorplanAssetId keeps the endpoint safe regardless of what else
 * ever lands in the table. Staying unauthenticated is deliberate: a guest
 * opening their invite link has no session and still needs to see the
 * floorplan.
 */
export async function readFloorplanImage(
  db: PrismaClient,
  id: string,
): Promise<{ bytes: Buffer; mimeType: string; filename: string } | null> {
  const currentFloorplanId = await getCurrentFloorplanAssetId(db)
  if (!currentFloorplanId || currentFloorplanId !== id) return null
  return readImage(db, id)
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
