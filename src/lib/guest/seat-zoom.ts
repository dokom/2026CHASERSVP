/**
 * Click-to-zoom geometry for the floorplan. Pure so it can be unit-tested
 * without a DOM: the component measures the viewport and the click, this
 * decides where the plan goes.
 *
 * All coordinates are viewport pixels with the origin at the viewport's
 * top-left, and the transform is applied with `transform-origin: 0 0` as
 * `translate(x, y) scale(scale)`, so a point p on the unzoomed plan lands at
 * `p * scale + translate`.
 */

export type ZoomTransform = { scale: number; x: number; y: number }
export type Point = { x: number; y: number }
export type Size = { width: number; height: number }

export const SEAT_ZOOM_SCALE = 2.5
export const IDENTITY_ZOOM: ZoomTransform = { scale: 1, x: 0, y: 0 }

/**
 * The translate that puts `point` at the viewport's centre at `scale`, clamped
 * so the enlarged plan always covers the whole viewport (no blank margins when
 * the guest clicks near an edge).
 */
export function zoomTowards(point: Point, viewport: Size, scale: number = SEAT_ZOOM_SCALE): ZoomTransform {
  if (scale === 1) return IDENTITY_ZOOM
  const x = clamp(viewport.width / 2 - point.x * scale, viewport.width * (1 - scale), 0)
  const y = clamp(viewport.height / 2 - point.y * scale, viewport.height * (1 - scale), 0)
  return { scale, x, y }
}

export function toTransformStyle({ scale, x, y }: ZoomTransform): string {
  return `translate(${x}px, ${y}px) scale(${scale})`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
