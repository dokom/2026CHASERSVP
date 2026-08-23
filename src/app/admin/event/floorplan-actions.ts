'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireCsrf, requireRole } from '@/lib/auth/guard'
import { storeImage, deleteImage } from '@/lib/media/repository'
import { InvalidImageError, MAX_IMAGE_BYTES } from '@/lib/media/images'
import { upsertTableMarker, deleteTableMarker, MarkerOutOfBoundsError } from '@/lib/events/markers'
import { tableMarkerSchema } from '@/lib/validation/event'
import { getEvent } from '@/lib/events/repository'

function fail(message: string): never {
  redirect(`/admin/event?error=${encodeURIComponent(message)}`)
}

export async function uploadFloorplanAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const event = await getEvent(prisma)
  if (!event) fail('Create the event before uploading a floorplan.')

  const file = formData.get('floorplan')
  if (!(file instanceof File) || file.size === 0) fail('Choose an image to upload.')
  if (file.size > MAX_IMAGE_BYTES) fail('That image is larger than 8 MB.')

  const bytes = Buffer.from(await file.arrayBuffer())

  let assetId: string
  try {
    // storeImage sniffs the real type from these bytes; the filename and the
    // browser's declared type are both ignored.
    assetId = await storeImage(prisma, actor.id, file.name, bytes)
  } catch (error) {
    fail(error instanceof InvalidImageError ? error.message : 'That file could not be read.')
  }

  const previousAssetId = event.floorplanAssetId
  await prisma.event.update({ where: { id: event.id }, data: { floorplanAssetId: assetId } })

  // Only after the new one is referenced, so a failure never leaves the event
  // pointing at a deleted asset.
  if (previousAssetId) {
    await deleteImage(prisma, actor.id, previousAssetId).catch(() => undefined)
  }

  revalidatePath('/admin/event')
}

export async function placeMarkerAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)

  const event = await getEvent(prisma)
  if (!event) fail('Create the event before placing tables.')

  const parsed = tableMarkerSchema.safeParse({
    tableNumber: formData.get('tableNumber'),
    x: formData.get('x'),
    y: formData.get('y'),
  })
  if (!parsed.success) fail(parsed.error.issues[0]?.message ?? 'Check the table details.')

  try {
    await upsertTableMarker(prisma, actor.id, event.id, parsed.data)
  } catch (error) {
    fail(error instanceof MarkerOutOfBoundsError ? error.message : 'That table could not be placed.')
  }
  revalidatePath('/admin/event')
}

export async function removeMarkerAction(formData: FormData): Promise<void> {
  const actor = await requireRole('ADMIN')
  await requireCsrf(formData)
  const id = String(formData.get('id') ?? '')
  if (!/^[0-9a-f]{24}$/.test(id)) fail('That table could not be found.')
  await deleteTableMarker(prisma, actor.id, id)
  revalidatePath('/admin/event')
}
