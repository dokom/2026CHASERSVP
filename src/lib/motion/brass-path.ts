export type Anchor = { y: number; x?: number }

export type BrassPathInput = {
  gutterX: number
  width: number
  /** Full document height of the line's coordinate space, used to clamp
   * every emitted point on-canvas. */
  height: number
  start: Anchor
  anchors: Anchor[]
  end: Anchor
}

const round = (n: number) => Math.round(n * 10) / 10
const clamp = (n: number, max: number) => Math.min(Math.max(n, 0), max)

/**
 * Lateral drift alternates sign by segment index so the stroke bows
 * sideways instead of plotting a dead-straight vertical — even when
 * consecutive anchors share the gutter x, where a purely-vertical-handle
 * curve would otherwise degenerate into a ruled line. Capped at 5% of the
 * page width or 18px, whichever is smaller, so the line's full envelope
 * (gutter plus drift) never leaves the guest content's left channel and
 * can never cross into a heading's glyphs. Index-based, so it is fully
 * deterministic — no randomness at runtime.
 */
const DRIFT_RATIO = 0.05
const DRIFT_CAP = 18
function driftFor(index: number, width: number): number {
  const magnitude = Math.min(width * DRIFT_RATIO, DRIFT_CAP)
  return (index % 2 === 0 ? 1 : -1) * magnitude
}

/** A single "x y" pair, clamped into the [0,width] x [0,height] canvas. */
function point(x: number, y: number, width: number, height: number): string {
  return `${round(clamp(x, width))} ${round(clamp(y, height))}`
}

/**
 * A cubic segment from (x0,y0) to (x1,y1). The handles carry a vertical
 * offset (so the line travels roughly downward) plus a lateral drift on
 * both control points (so it bows sideways) — "a drawn stroke, not a
 * plotted one". The drift never touches the endpoint itself, only the
 * curve's shape on the way there.
 */
function curveTo(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  drift: number,
  width: number,
  height: number,
): string {
  const dy = (y1 - y0) * 0.5
  const c1 = point(x0 + drift, y0 + dy, width, height)
  const c2 = point(x1 + drift, y1 - dy, width, height)
  const to = point(x1, y1, width, height)
  return `C ${c1}, ${c2}, ${to}`
}

/**
 * Builds the brass line: from the opening seal, down the left gutter through
 * each act, bending toward any anchor that carries its own x (the guest's
 * table), and closing on the final seal. Cubic curves only — a straight
 * segment reads as a diagram, and this is meant to read as a hand.
 */
export function buildBrassPath(input: BrassPathInput): string {
  const { gutterX, width, height, start, anchors, end } = input
  let segment = 0

  const startX = start.x ?? gutterX
  const parts: string[] = [`M ${point(startX, start.y, width, height)}`]

  let cx = startX
  let cy = start.y

  for (const anchor of anchors) {
    const nx = anchor.x ?? gutterX
    parts.push(curveTo(cx, cy, nx, anchor.y, driftFor(segment, width), width, height))
    segment += 1
    cx = nx
    cy = anchor.y

    // An anchor that pulled the line sideways hands it back to the gutter
    // a little further down, so the next act starts from the margin.
    if (anchor.x !== undefined && anchor.x !== gutterX) {
      const returnY = anchor.y + 80
      parts.push(curveTo(cx, cy, gutterX, returnY, driftFor(segment, width), width, height))
      segment += 1
      cx = gutterX
      cy = returnY
    }
  }

  // The final approach to the terminal seal carries no drift: a slip past
  // the seal and a hook back reads as missing the close, not completing it.
  // Zero drift means both control points share their endpoint's x exactly.
  const endX = end.x ?? gutterX
  parts.push(curveTo(cx, cy, endX, end.y, 0, width, height))
  return parts.join(' ')
}
