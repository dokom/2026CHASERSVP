import { describe, it, expect } from 'vitest'
import { buildBrassPath } from '@/lib/motion/brass-path'

const base = {
  gutterX: 24,
  width: 375,
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
})
