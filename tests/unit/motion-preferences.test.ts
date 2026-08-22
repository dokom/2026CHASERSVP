import { describe, it, expect } from 'vitest'
import { deviceTier, prefersReducedMotion, resolveMotionMode } from '@/lib/motion/preferences'

describe('deviceTier', () => {
  it('is high for a capable device', () => {
    expect(deviceTier({ deviceMemory: 8, hardwareConcurrency: 8 })).toBe('high')
  })

  it('is low when memory is scarce', () => {
    expect(deviceTier({ deviceMemory: 2, hardwareConcurrency: 8 })).toBe('low')
  })

  it('is low when cores are scarce', () => {
    expect(deviceTier({ deviceMemory: 8, hardwareConcurrency: 2 })).toBe('low')
  })

  it('is low on a slow connection', () => {
    expect(deviceTier({ deviceMemory: 8, hardwareConcurrency: 8, connection: { effectiveType: '2g' } })).toBe('low')
    expect(deviceTier({ deviceMemory: 8, hardwareConcurrency: 8, connection: { effectiveType: 'slow-2g' } })).toBe('low')
  })

  it('is low when the visitor asked to save data', () => {
    expect(deviceTier({ deviceMemory: 8, hardwareConcurrency: 8, connection: { saveData: true } })).toBe('low')
  })

  it('treats missing signals as capable — Safari reports none of them', () => {
    // Penalising the absence of a signal would drop every iPhone to low tier.
    expect(deviceTier({})).toBe('high')
  })

  it('treats exactly the threshold as capable', () => {
    expect(deviceTier({ deviceMemory: 4, hardwareConcurrency: 4 })).toBe('high')
  })
})

describe('prefersReducedMotion', () => {
  it('reads the media query', () => {
    const matchMedia = (q: string) => ({ matches: q.includes('reduce') })
    expect(prefersReducedMotion(matchMedia)).toBe(true)
  })

  it('is false when the query does not match', () => {
    expect(prefersReducedMotion(() => ({ matches: false }))).toBe(false)
  })

  it('is false when matchMedia is unavailable', () => {
    expect(prefersReducedMotion(undefined)).toBe(false)
  })
})

describe('resolveMotionMode', () => {
  it('reduced wins over everything', () => {
    expect(resolveMotionMode({ reducedMotion: true, tier: 'high' })).toBe('reduced')
    expect(resolveMotionMode({ reducedMotion: true, tier: 'low' })).toBe('reduced')
  })

  it('low tier gets lite motion — timelines without the WebGL layer', () => {
    expect(resolveMotionMode({ reducedMotion: false, tier: 'low' })).toBe('lite')
  })

  it('high tier gets everything', () => {
    expect(resolveMotionMode({ reducedMotion: false, tier: 'high' })).toBe('full')
  })
})
