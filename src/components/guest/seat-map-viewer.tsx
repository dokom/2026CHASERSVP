'use client'

import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import { IDENTITY_ZOOM, toTransformStyle, zoomTowards, type Point, type ZoomTransform } from '@/lib/guest/seat-zoom'

/**
 * The clipping viewport around the floorplan, with click-to-zoom.
 *
 * Three nested layers, each with one job:
 *   1. this <button>: fixed footprint, `overflow-hidden`, so nothing inside can
 *      spill onto the page however far it is scaled;
 *   2. the zoom layer: the guest's click, as translate+scale from origin 0 0;
 *   3. `children` (the [data-seat-map] stage): the scroll-driven zoom toward
 *      the marker that SeatAct animates. It is a separate element so the two
 *      transforms compose instead of fighting over one `style.transform`.
 *
 * A click zooms toward and centres that point; a second click resets. The
 * keyboard toggles the same zoom on the guest's own table (or the centre when
 * there is no marker), so the interaction is not pointer-only.
 */
export function SeatMapViewer({
  marker, children,
}: {
  /** Normalised 0–1 position of the guest's table, if known. */
  marker: Point | null
  children: React.ReactNode
}) {
  const [zoom, setZoom] = useState<ZoomTransform>(IDENTITY_ZOOM)
  const isZoomed = zoom.scale !== 1

  const toggleAt = (element: HTMLElement, point: Point) => {
    const { width, height } = element.getBoundingClientRect()
    setZoom(isZoomed ? IDENTITY_ZOOM : zoomTowards(point, { width, height }))
  }

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    toggleAt(event.currentTarget, { x: event.clientX - rect.left, y: event.clientY - rect.top })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    const { width, height } = event.currentTarget.getBoundingClientRect()
    const focus = marker ?? { x: 0.5, y: 0.5 }
    toggleAt(event.currentTarget, { x: focus.x * width, y: focus.y * height })
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onKeyDown={onKeyDown}
      aria-pressed={isZoomed}
      aria-label={isZoomed ? 'Reset the floorplan zoom' : 'Zoom in on the floorplan'}
      data-seat-map-viewport
      className={`relative block w-full overflow-hidden rounded border border-[var(--color-border)] p-0 text-left lg:max-w-md ${
        isZoomed ? 'cursor-zoom-out' : 'cursor-zoom-in'
      }`}
    >
      <div
        data-seat-map-zoom
        className="origin-top-left transition-transform duration-300 ease-out"
        style={{ transform: toTransformStyle(zoom) }}
      >
        {children}
      </div>
    </button>
  )
}
