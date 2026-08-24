import { describe, it, expect } from 'vitest'
import { IDENTITY_ZOOM, SEAT_ZOOM_SCALE, toTransformStyle, zoomTowards } from '@/lib/guest/seat-zoom'

const viewport = { width: 400, height: 300 }

describe('zoomTowards', () => {
  it('brings the clicked point to the centre of the viewport', () => {
    const point = { x: 100, y: 80 }
    const z = zoomTowards(point, viewport)
    expect(z.scale).toBe(SEAT_ZOOM_SCALE)
    expect(point.x * z.scale + z.x).toBeCloseTo(viewport.width / 2)
    expect(point.y * z.scale + z.y).toBeCloseTo(viewport.height / 2)
  })

  it('never reveals blank space past the top-left edge', () => {
    const z = zoomTowards({ x: 2, y: 2 }, viewport)
    expect(z.x).toBe(0)
    expect(z.y).toBe(0)
  })

  it('never reveals blank space past the bottom-right edge', () => {
    const z = zoomTowards({ x: 398, y: 298 }, viewport)
    expect(z.x).toBeCloseTo(viewport.width * (1 - z.scale))
    expect(z.y).toBeCloseTo(viewport.height * (1 - z.scale))
  })

  it('a click dead-centre leaves the plan centred', () => {
    const z = zoomTowards({ x: 200, y: 150 }, viewport)
    expect(z.x).toBeCloseTo((viewport.width * (1 - z.scale)) / 2)
    expect(z.y).toBeCloseTo((viewport.height * (1 - z.scale)) / 2)
  })

  it('scale 1 is the identity regardless of the point', () => {
    expect(zoomTowards({ x: 37, y: 91 }, viewport, 1)).toEqual(IDENTITY_ZOOM)
  })
})

describe('toTransformStyle', () => {
  it('translates before scaling so the offsets are in viewport pixels', () => {
    expect(toTransformStyle({ scale: 2.5, x: -50, y: -75 })).toBe('translate(-50px, -75px) scale(2.5)')
  })

  it('renders the identity as a no-op transform', () => {
    expect(toTransformStyle(IDENTITY_ZOOM)).toBe('translate(0px, 0px) scale(1)')
  })
})
