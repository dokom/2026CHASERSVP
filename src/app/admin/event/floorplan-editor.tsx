'use client'

import { useRef, useState } from 'react'
import type { TableMarkerRow } from '@/lib/events/repository'
import { placeMarkerAction, removeMarkerAction, uploadFloorplanAction } from './floorplan-actions'

export function FloorplanEditor({
  floorplanAssetId, markers, csrf,
}: {
  floorplanAssetId: string | null
  markers: TableMarkerRow[]
  csrf: string
}) {
  const imageRef = useRef<HTMLImageElement>(null)
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null)

  /**
   * Convert a click to normalised 0-1 coordinates using the RENDERED bounding
   * box, not the image's natural size — the floorplan is scaled on every
   * viewport, and natural pixels would put the marker in the wrong place
   * everywhere except one width.
   */
  function handleClick(clickEvent: React.MouseEvent<HTMLImageElement>) {
    const box = imageRef.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return
    setPending({
      x: Math.min(1, Math.max(0, (clickEvent.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (clickEvent.clientY - box.top) / box.height)),
    })
  }

  return (
    <div className="space-y-4">
      <h2 className="font-serif text-xl">Floorplan</h2>

      <form action={uploadFloorplanAction} className="flex flex-wrap items-end gap-4">
        <input type="hidden" name="csrf" value={csrf} />
        <label className="block">
          <span className="mb-1 block text-sm text-[var(--color-text-muted)]">
            Floorplan image (PNG, JPEG or WEBP, up to 8 MB)
          </span>
          <input type="file" name="floorplan" accept="image/png,image/jpeg,image/webp" required className="text-sm" />
        </label>
        <button type="submit" className="rounded border border-[var(--color-border)] px-4 py-2">
          Upload
        </button>
      </form>

      {floorplanAssetId ? (
        <>
          <p className="text-sm text-[var(--color-text-muted)]">
            Click the plan to place a table.
          </p>
          <div className="relative inline-block max-w-full">
            {/* eslint-disable-next-line @next/next/no-img-element -- served from our own
                route handler at unknown intrinsic size */}
            <img
              ref={imageRef}
              src={`/api/media/${floorplanAssetId}`}
              alt="Venue floorplan"
              onClick={handleClick}
              className="block max-w-full cursor-crosshair"
              data-testid="floorplan-image"
            />
            {markers.map((marker) => (
              <span
                key={marker.id}
                className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--color-brass)] text-[10px] font-bold text-[var(--color-ink-deep)]"
                style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
                title={`Table ${marker.tableNumber}`}
              >
                {marker.tableNumber}
              </span>
            ))}
            {pending ? (
              <span
                className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-[var(--color-brass)]"
                style={{ left: `${pending.x * 100}%`, top: `${pending.y * 100}%` }}
                data-testid="pending-marker"
              />
            ) : null}
          </div>

          {pending ? (
            <form action={placeMarkerAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="csrf" value={csrf} />
              <input type="hidden" name="x" value={pending.x} />
              <input type="hidden" name="y" value={pending.y} />
              <label className="block">
                <span className="mb-1 block text-sm text-[var(--color-text-muted)]">Table number</span>
                <input
                  name="tableNumber"
                  required
                  autoFocus
                  className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
                />
              </label>
              <button type="submit" className="rounded bg-[var(--color-brass)] px-4 py-2 font-medium text-[var(--color-ink-deep)]">
                Place table
              </button>
              <button type="button" onClick={() => setPending(null)} className="text-sm underline underline-offset-4">
                Cancel
              </button>
            </form>
          ) : null}

          {markers.length > 0 ? (
            <ul className="flex flex-wrap gap-2 text-sm">
              {markers.map((marker) => (
                <li key={marker.id}>
                  <form action={removeMarkerAction} className="flex items-center gap-1">
                    <input type="hidden" name="csrf" value={csrf} />
                    <input type="hidden" name="id" value={marker.id} />
                    <span className="rounded border border-[var(--color-border)] px-2 py-1">
                      Table {marker.tableNumber}
                    </span>
                    <button type="submit" aria-label={`Remove table ${marker.tableNumber}`} className="text-xs underline">
                      remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
