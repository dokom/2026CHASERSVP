import type { PrismaClient } from '@prisma/client'
import { writeAudit } from '@/lib/audit'

export class MarkerOutOfBoundsError extends Error {
  constructor() {
    super('Marker coordinates must be between 0 and 1')
    this.name = 'MarkerOutOfBoundsError'
  }
}

export type TableMarkerInput = { tableNumber: string; x: number; y: number }

function assertInBounds(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new MarkerOutOfBoundsError()
}

/**
 * Coordinates are normalised 0-1 against the floorplan, so a marker stays put
 * at every rendered size. One marker per table per event: placing the same
 * table again MOVES it, which is what an operator dragging a pin expects.
 */
export async function upsertTableMarker(
  db: PrismaClient,
  actorId: string | null,
  eventId: string,
  input: TableMarkerInput,
): Promise<string> {
  assertInBounds(input.x)
  assertInBounds(input.y)

  const tableNumber = input.tableNumber.trim()
  if (!tableNumber) throw new Error('A table number is required')

  return db.$transaction(async (tx) => {
    const marker = await tx.tableMarker.upsert({
      where: { eventId_tableNumber: { eventId, tableNumber } },
      create: { eventId, tableNumber, x: input.x, y: input.y },
      update: { x: input.x, y: input.y },
      select: { id: true },
    })
    await writeAudit(tx, {
      actorId, action: 'tableMarker.upsert', entity: 'TableMarker', entityId: marker.id,
      meta: { tableNumber, x: input.x, y: input.y },
    })
    return marker.id
  })
}

export async function deleteTableMarker(
  db: PrismaClient,
  actorId: string | null,
  id: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.tableMarker.delete({ where: { id } })
    await writeAudit(tx, {
      actorId, action: 'tableMarker.delete', entity: 'TableMarker', entityId: id,
    })
  })
}
