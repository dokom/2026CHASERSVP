import { describe, expect, it } from 'vitest'
import {
  ACT_IDS, LAST_ACT, actAnchors, actTransitions, damp, scrollAnchor, smoothstep, stagePosition,
} from '@/lib/motion/acts'

const ALL_ACTS = ACT_IDS.map((_, act) => ({ act, at: act * 1000 }))

describe('smoothstep', () => {
  it('clamps below and above its edges', () => {
    expect(smoothstep(0.2, 0.8, 0.1)).toBe(0)
    expect(smoothstep(0.2, 0.8, 0.9)).toBe(1)
  })

  it('passes through one half at the midpoint', () => {
    expect(smoothstep(0.2, 0.8, 0.5)).toBeCloseTo(0.5, 10)
  })
})

describe('scrollAnchor', () => {
  it('is the centre of the viewport in document coordinates', () => {
    expect(scrollAnchor(1000, 800)).toBe(1400)
  })
})

describe('actAnchors', () => {
  const VIEWPORT = 800
  const DOCUMENT = 3000

  it('anchors a section at its own centre', () => {
    expect(actAnchors([{ act: 2, top: 1000, height: 400 }], VIEWPORT, DOCUMENT)).toEqual([{ act: 2, at: 1200 }])
  })

  it('anchors a section too high to centre at the top of the page', () => {
    const [anchor] = actAnchors([{ act: 0, top: 50, height: 300 }], VIEWPORT, DOCUMENT)
    expect(anchor!.at).toBe(scrollAnchor(0, VIEWPORT))
  })

  it('anchors a section too low to centre at the bottom of the page', () => {
    const [anchor] = actAnchors([{ act: 4, top: 2600, height: 400 }], VIEWPORT, DOCUMENT)
    expect(anchor!.at).toBe(scrollAnchor(DOCUMENT - VIEWPORT, VIEWPORT))
  })

  it('reaches the last act at the bottom of any page, however short its final section', () => {
    const sections = ACT_IDS.map((_, act) => ({ act, top: 200 + act * 500, height: 150 }))
    const documentHeight = 2900
    const anchors = actAnchors(sections, VIEWPORT, documentHeight)
    expect(stagePosition(anchors, scrollAnchor(documentHeight - VIEWPORT, VIEWPORT))).toBe(LAST_ACT)
    expect(stagePosition(anchors, scrollAnchor(0, VIEWPORT))).toBe(0)
  })
})

describe('stagePosition', () => {
  it('is the first act above the first section', () => {
    expect(stagePosition(ALL_ACTS, -50)).toBe(0)
  })

  it('interpolates between neighbouring sections', () => {
    expect(stagePosition(ALL_ACTS, 1500)).toBeCloseTo(1.5)
  })

  it('is the last act past the final section', () => {
    expect(stagePosition(ALL_ACTS, 99_999)).toBe(LAST_ACT)
  })

  it('crosses a missing act instead of stalling on it', () => {
    // No agenda: the evening act (2) has no section.
    const anchors = ALL_ACTS.filter(({ act }) => act !== 2)
    expect(stagePosition(anchors, 2000)).toBeCloseTo(2)
  })

  it('does not depend on the order anchors are given in', () => {
    expect(stagePosition([...ALL_ACTS].reverse(), 2500)).toBeCloseTo(2.5)
  })

  it('returns the first act when no sections were found', () => {
    expect(stagePosition([], 1234)).toBe(0)
  })
})

describe('actTransitions', () => {
  it('starts with every morph at rest', () => {
    expect(actTransitions(0)).toEqual([0, 0, 0, 0])
  })

  it('completes each morph before its act is reached', () => {
    const [toDrive, toEvening] = actTransitions(1.9)
    expect(toDrive).toBe(1)
    expect(toEvening).toBe(1)
  })

  it('has every morph complete at the final act', () => {
    expect(actTransitions(LAST_ACT)).toEqual([1, 1, 1, 1])
  })

  it('never moves a morph backwards as the stage advances', () => {
    let previous = actTransitions(0)
    for (let stage = 0; stage <= LAST_ACT; stage += 0.05) {
      const current = actTransitions(stage)
      current.forEach((weight, i) => expect(weight).toBeGreaterThanOrEqual(previous[i]!))
      previous = current
    }
  })
})

describe('damp', () => {
  it('moves toward the target without overshooting', () => {
    const next = damp(0, 4, 5, 0.016)
    expect(next).toBeGreaterThan(0)
    expect(next).toBeLessThan(4)
  })

  it('is frame-rate independent', () => {
    const oneStep = damp(0, 4, 5, 0.016)
    const twoSteps = damp(damp(0, 4, 5, 0.008), 4, 5, 0.008)
    expect(twoSteps).toBeCloseTo(oneStep, 10)
  })
})
