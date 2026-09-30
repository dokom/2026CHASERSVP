import { describe, expect, it } from 'vitest'
import {
  CAMERA_POSITIONS, CAMERA_TARGETS, CHAIR_RADIUS, HIGHLIGHT_TABLE, KIND_LAMP, KIND_RED, KIND_WHITE,
  ROAD_LENGTH, TABLE_CENTRES, TABLE_RADIUS, buildStageLayout, createRandom,
} from '@/lib/motion/stage-layout'
import { LAST_ACT } from '@/lib/motion/acts'

const COUNT = 600

function point(values: Float32Array, i: number): [number, number, number] {
  return [values[i * 3]!, values[i * 3 + 1]!, values[i * 3 + 2]!]
}

describe('createRandom', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = createRandom(7)
    const b = createRandom(7)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('stays within [0, 1)', () => {
    const random = createRandom(42)
    for (let i = 0; i < 1000; i++) {
      const value = random()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('buildStageLayout', () => {
  it('is identical on every build, so the settled frame is deterministic', () => {
    expect(buildStageLayout(COUNT)).toEqual(buildStageLayout(COUNT))
  })

  it('sizes every per-particle array for the count', () => {
    const layout = buildStageLayout(COUNT)
    expect(layout.seeds).toHaveLength(COUNT)
    expect(layout.kinds).toHaveLength(COUNT)
    expect(layout.highlight).toHaveLength(COUNT)
    for (const positions of [layout.seal, layout.drive, layout.evening, layout.seat]) {
      expect(positions).toHaveLength(COUNT * 3)
    }
  })

  it('uses all three particle kinds', () => {
    const kinds = new Set(buildStageLayout(COUNT).kinds)
    expect(kinds).toEqual(new Set([KIND_RED, KIND_WHITE, KIND_LAMP]))
  })

  it('keeps tail-lights in our lane and headlights in the oncoming one', () => {
    const layout = buildStageLayout(COUNT)
    for (let i = 0; i < COUNT; i++) {
      const [x, , z] = point(layout.drive, i)
      expect(z).toBeLessThanOrEqual(0)
      expect(z).toBeGreaterThanOrEqual(-ROAD_LENGTH)
      if (layout.kinds[i] === KIND_RED) expect(x).toBeGreaterThan(0)
      if (layout.kinds[i] === KIND_WHITE) expect(x).toBeLessThan(0)
    }
  })

  it('seats every particle on a table rim or at one of its chairs', () => {
    const layout = buildStageLayout(COUNT)
    for (let i = 0; i < COUNT; i++) {
      const [x, , z] = point(layout.seat, i)
      const nearest = Math.min(...TABLE_CENTRES.map(([cx, , cz]) => Math.hypot(x - cx, z - cz)))
      expect(nearest).toBeGreaterThan(TABLE_RADIUS * 0.8)
      expect(nearest).toBeLessThan(CHAIR_RADIUS * 1.2)
    }
  })

  it('marks exactly one table as the highlighted one', () => {
    const layout = buildStageLayout(COUNT)
    const highlighted = Array.from(layout.highlight).filter((flag) => flag === 1).length
    expect(highlighted).toBe(COUNT / TABLE_CENTRES.length)
  })
})

describe('stage framing', () => {
  it('puts the highlighted table in the centre column, inside a phone-width frame', () => {
    // Side columns fall outside a portrait phone's view of the room.
    expect(TABLE_CENTRES[HIGHLIGHT_TABLE]![0]).toBe(0)
  })

  it('has one camera key per act', () => {
    expect(CAMERA_POSITIONS).toHaveLength(LAST_ACT + 1)
    expect(CAMERA_TARGETS).toHaveLength(LAST_ACT + 1)
  })
})
