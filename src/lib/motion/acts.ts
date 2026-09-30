/**
 * The guest page as five acts, and the pure maths that turns scroll position
 * into a place in them. No DOM or three.js here: the tracker measures, the
 * stage renders, and everything in between is testable arithmetic.
 */

/** Heading ids of the five acts, in page order. Sections are found by the
 * `aria-labelledby` that points at them. */
export const ACT_IDS = ['welcome', 'event', 'evening', 'seat', 'rsvp'] as const

export const LAST_ACT = ACT_IDS.length - 1

/** A section as measured: document-relative top and height. */
export type ActSection = { act: number; top: number; height: number }
/** The document-y the viewport centre must reach for an act to be on stage. */
export type ActAnchor = { act: number; at: number }

/** Morphs toward act k run over this window of stage position, so each
 * formation is complete a little before its section reaches the anchor. */
const MORPH_START = 0.75
const MORPH_END = 0.15

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** The document-y at the centre of the viewport: where the page "is". */
export function scrollAnchor(scrollY: number, viewportHeight: number): number {
  return scrollY + viewportHeight / 2
}

/**
 * Each act is on stage when its section's centre meets the viewport's centre
 * — clamped to the range scrolling can actually reach. Without the clamp, a
 * short page could never centre its first or last section, and the stage
 * would never arrive at the response act (nor come to rest there).
 */
export function actAnchors(
  sections: readonly ActSection[],
  viewportHeight: number,
  documentHeight: number,
): ActAnchor[] {
  const half = viewportHeight / 2
  const reachable = Math.max(half, documentHeight - half)
  return sections.map(({ act, top, height }) => ({ act, at: clamp(top + height / 2, half, reachable) }))
}

/**
 * Continuous stage position in [0, LAST_ACT]: the integer part is the act the
 * anchor is in, the fraction how far it is toward the next PRESENT act. An
 * absent act (no agenda, say) is skipped over rather than given dead scroll.
 */
export function stagePosition(anchors: readonly ActAnchor[], anchor: number): number {
  const sorted = [...anchors].sort((a, b) => a.act - b.act)
  const first = sorted[0]
  if (!first) return 0
  if (anchor <= first.at) return first.act

  for (let i = 1; i < sorted.length; i++) {
    const from = sorted[i - 1]!
    const to = sorted[i]!
    if (anchor < to.at) {
      const span = to.at - from.at
      const through = span > 0 ? (anchor - from.at) / span : 1
      return from.act + (to.act - from.act) * through
    }
  }
  return sorted[sorted.length - 1]!.act
}

/**
 * Weights of the four morphs (seal→drive, drive→evening, evening→seat,
 * seat→response). Each rises 0→1 as the stage approaches its act.
 */
export function actTransitions(stage: number): [number, number, number, number] {
  const weight = (act: number) => smoothstep(act - MORPH_START, act - MORPH_END, stage)
  return [weight(1), weight(2), weight(3), weight(4)]
}

/**
 * Exponential approach of `current` toward `target`. Frame-rate independent:
 * two 8 ms steps land where one 16 ms step does, so a 120 Hz phone glides at
 * the same speed as a 60 Hz laptop.
 */
export function damp(current: number, target: number, rate: number, dtSeconds: number): number {
  return target + (current - target) * Math.exp(-rate * dtSeconds)
}
