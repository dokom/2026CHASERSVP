import { afterEach, describe, expect, it, vi } from 'vitest'
import { journey, onStageChange, setStage } from '@/lib/motion/journey'

describe('setStage', () => {
  afterEach(() => setStage(0))

  it('writes the value before telling listeners, so they read the new stage', () => {
    const seen: number[] = []
    const off = onStageChange(() => seen.push(journey.stage))

    setStage(2.5)
    off()

    expect(seen).toEqual([2.5])
  })

  it('stays quiet when the stage has not moved', () => {
    setStage(1)
    const listener = vi.fn()
    const off = onStageChange(listener)

    setStage(1)
    off()

    expect(listener).not.toHaveBeenCalled()
  })

  it('stops telling a listener once it unsubscribes', () => {
    const listener = vi.fn()
    const off = onStageChange(listener)

    off()
    setStage(3)

    expect(listener).not.toHaveBeenCalled()
  })
})
