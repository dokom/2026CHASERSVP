export type MotionMode = 'full' | 'lite' | 'reduced'
export type DeviceTier = 'high' | 'low'

export type NavigatorLike = {
  deviceMemory?: number
  hardwareConcurrency?: number
  connection?: { effectiveType?: string; saveData?: boolean }
}

export type MatchMediaLike = (query: string) => { matches: boolean }

const MIN_MEMORY_GB = 4
const MIN_CORES = 4
const SLOW_CONNECTIONS = new Set(['slow-2g', '2g'])

/**
 * Classifies the device from the signals the browser volunteers.
 *
 * A missing signal counts as capable: Safari reports none of these, and
 * penalising absence would drop every iPhone to the low tier. Only a signal
 * that is present AND poor demotes the device.
 */
export function deviceTier(nav: NavigatorLike): DeviceTier {
  if (nav.deviceMemory !== undefined && nav.deviceMemory < MIN_MEMORY_GB) return 'low'
  if (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency < MIN_CORES) return 'low'
  if (nav.connection?.saveData) return 'low'
  if (nav.connection?.effectiveType && SLOW_CONNECTIONS.has(nav.connection.effectiveType)) {
    return 'low'
  }
  return 'high'
}

export function prefersReducedMotion(matchMedia: MatchMediaLike | undefined): boolean {
  if (!matchMedia) return false
  return matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * reduced > lite > full. Reduced motion is an accessibility preference and
 * always wins; lite is the same journey without the WebGL layer.
 */
export function resolveMotionMode(input: { reducedMotion: boolean; tier: DeviceTier }): MotionMode {
  if (input.reducedMotion) return 'reduced'
  if (input.tier === 'low') return 'lite'
  return 'full'
}
