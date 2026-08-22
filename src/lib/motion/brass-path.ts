export type Anchor = { y: number; x?: number }

export type BrassPathInput = {
  gutterX: number
  width: number
  start: Anchor
  anchors: Anchor[]
  end: Anchor
}

const round = (n: number) => Math.round(n * 10) / 10

/**
 * A cubic segment from (x0,y0) to (x1,y1) whose handles are vertical, so the
 * line leaves and arrives travelling straight down — a drawn stroke, not a
 * plotted one.
 */
function curveTo(x0: number, y0: number, x1: number, y1: number): string {
  const dy = (y1 - y0) * 0.5
  return `C ${round(x0)} ${round(y0 + dy)}, ${round(x1)} ${round(y1 - dy)}, ${round(x1)} ${round(y1)}`
}

/**
 * Builds the brass line: from the opening seal, down the left gutter through
 * each act, bending toward any anchor that carries its own x (the guest's
 * table), and closing on the final seal. Cubic curves only — a straight
 * segment reads as a diagram, and this is meant to read as a hand.
 */
export function buildBrassPath(input: BrassPathInput): string {
  const { gutterX, start, anchors, end } = input
  const parts: string[] = [`M ${round(start.x ?? gutterX)} ${round(start.y)}`]

  let cx = start.x ?? gutterX
  let cy = start.y

  for (const anchor of anchors) {
    const nx = anchor.x ?? gutterX
    parts.push(curveTo(cx, cy, nx, anchor.y))
    cx = nx
    cy = anchor.y

    // An anchor that pulled the line sideways hands it back to the gutter
    // a little further down, so the next act starts from the margin.
    if (anchor.x !== undefined && anchor.x !== gutterX) {
      const returnY = anchor.y + 80
      parts.push(curveTo(cx, cy, gutterX, returnY))
      cx = gutterX
      cy = returnY
    }
  }

  parts.push(curveTo(cx, cy, end.x ?? gutterX, end.y))
  return parts.join(' ')
}
