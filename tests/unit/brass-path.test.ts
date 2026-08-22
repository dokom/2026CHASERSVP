import { describe, it, expect } from 'vitest'
import { buildBrassPath } from '@/lib/motion/brass-path'

const base = {
  gutterX: 24,
  width: 375,
  height: 3200,
  start: { x: 187, y: 120 },
  anchors: [{ y: 600 }, { y: 1200 }, { y: 1800, x: 240 }, { y: 2400 }],
  end: { x: 187, y: 3000 },
}

describe('buildBrassPath', () => {
  it('starts at the seal with a move command', () => {
    expect(buildBrassPath(base)).toMatch(/^M\s*187(\.\d+)?\s+120/)
  })

  it('ends at the closing seal', () => {
    const d = buildBrassPath(base)
    const last = d.trim().split(/[A-Z]/).filter(Boolean).at(-1)!.trim().split(/[\s,]+/)
    expect(Number(last.at(-2))).toBeCloseTo(187, 0)
    expect(Number(last.at(-1))).toBeCloseTo(3000, 0)
  })

  it('passes through every anchor y', () => {
    const d = buildBrassPath(base)
    for (const anchor of base.anchors) expect(d).toContain(String(anchor.y))
  })

  it('bends toward an anchor that carries its own x, then returns to the gutter', () => {
    const d = buildBrassPath(base)
    expect(d).toContain('240')
    // The segment after the bend must come back to the gutter x.
    const afterBend = d.slice(d.indexOf('240'))
    expect(afterBend).toContain('24 ')
  })

  it('uses only curves between anchors, never straight line commands', () => {
    // Straight L segments read as a diagram; the line is handwritten, not ruled.
    expect(buildBrassPath(base)).not.toMatch(/\bL\b/)
  })

  it('is deterministic', () => {
    expect(buildBrassPath(base)).toBe(buildBrassPath(base))
  })

  it('still draws a seal-to-seal line with no anchors at all', () => {
    const d = buildBrassPath({ ...base, anchors: [] })
    expect(d.startsWith('M')).toBe(true)
    expect(d).toContain('3000')
  })

  it('never emits NaN', () => {
    expect(buildBrassPath(base)).not.toContain('NaN')
  })

  // L1: consecutive anchors sharing gutterX must not degenerate into a
  // dead-straight vertical rule (control points equal to both endpoints' x).
  it('drifts control points sideways when consecutive anchors share gutterX', () => {
    const straightDown = {
      gutterX: 24,
      width: 375,
      height: 2000,
      start: { x: 24, y: 100 },
      anchors: [{ y: 500 }, { y: 900 }, { y: 1300 }],
      end: { x: 24, y: 1700 },
    }
    const d = buildBrassPath(straightDown)
    const commands = d.match(/C ([^C]+)/g) ?? []
    expect(commands.length).toBeGreaterThan(0)
    // The final segment is checked separately below (it drifts to zero on
    // purpose, straight down the channel into the terminal seal), so this
    // sideways-bow check only applies to the segments before it.
    for (const cmd of commands.slice(0, -1)) {
      const nums = cmd
        .replace('C', '')
        .trim()
        .split(/[\s,]+/)
        .map(Number)
      const [c1x, , c2x] = nums
      // At least one control point must land off the shared gutter x — a
      // curve whose controls both sit on x=24 is the plotted vertical rule
      // the review flagged.
      expect(c1x === 24 && c2x === 24).toBe(false)
    }
  })

  // L2: the end point must always land inside the [0,width] x [0,height]
  // canvas, even if the caller hands in an out-of-range end anchor.
  it('clamps an out-of-bounds end point into the canvas', () => {
    const d = buildBrassPath({ ...base, end: { x: -50, y: 9000 } })
    const last = d.trim().split(/[A-Z]/).filter(Boolean).at(-1)!.trim().split(/[\s,]+/)
    const endX = Number(last.at(-2))
    const endY = Number(last.at(-1))
    expect(endX).toBeGreaterThanOrEqual(0)
    expect(endX).toBeLessThanOrEqual(base.width)
    expect(endY).toBeGreaterThanOrEqual(0)
    expect(endY).toBeLessThanOrEqual(base.height)
  })

  // Q1: the terminus must not lasso — the final approach to the terminal
  // seal carries no drift, so both of its control points share x with the
  // segment's own start and end points (a straight run down the channel).
  it('approaches the terminal seal straight, with no drift on the final segment', () => {
    const d = buildBrassPath(base)
    const commands = d.match(/C ([^C]+)/g) ?? []
    const lastCmd = commands.at(-1)!
    const nums = lastCmd.replace('C', '').trim().split(/[\s,]+/).map(Number)
    const [c1x, , c2x, , endX] = nums
    // Segment runs from the previous anchor's x (240, the table bend, after
    // its return-to-gutter hop) to the end's x (187 in `base`).
    expect(c1x).toBeCloseTo(24, 0) // returned to gutterX before the final hop
    expect(c2x).toBeCloseTo(endX!, 0)
  })

  it('final segment control points share x with the seal-to-seal endpoints when both sit on the gutter', () => {
    const straightDown = {
      gutterX: 24,
      width: 375,
      height: 2000,
      start: { x: 24, y: 100 },
      anchors: [{ y: 500 }, { y: 900 }],
      end: { x: 24, y: 1700 },
    }
    const d = buildBrassPath(straightDown)
    const commands = d.match(/C ([^C]+)/g) ?? []
    const lastCmd = commands.at(-1)!
    const nums = lastCmd.replace('C', '').trim().split(/[\s,]+/).map(Number)
    const [c1x, , c2x] = nums
    expect(c1x).toBeCloseTo(24, 0)
    expect(c2x).toBeCloseTo(24, 0)
  })

  // Q2: the line's full horizontal envelope (gutter plus drift) must stay
  // within the brass-line channel — x = 4..44 for a 375-wide guest column
  // with gutterX = 24 — so it can never cross into act heading glyphs
  // padded to start at x >= 48.
  it('keeps every emitted x, including control points, within the [4,44] channel for gutter-only anchors', () => {
    const gutterOnly = {
      gutterX: 24,
      width: 375,
      height: 3200,
      start: { x: 24, y: 120 },
      anchors: [{ y: 600 }, { y: 1200 }, { y: 1800 }, { y: 2400 }],
      end: { x: 24, y: 3000 },
    }
    const d = buildBrassPath(gutterOnly)
    const allNumberPairs = d
      .replace(/^M/, '')
      .split(/[MC]/)
      .filter(Boolean)
      .flatMap((seg) => seg.trim().split(',').map((pair) => pair.trim().split(/\s+/).map(Number)))
    for (const [x] of allNumberPairs) {
      expect(x).toBeGreaterThanOrEqual(4)
      expect(x).toBeLessThanOrEqual(44)
    }
  })
})
