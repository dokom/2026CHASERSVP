'use client'

import { useEffect, useRef, type RefObject } from 'react'
import { ACT_IDS, actAnchors, scrollAnchor, stagePosition, type ActSection } from '@/lib/motion/acts'
import { setStage } from '@/lib/motion/journey'

/** Document-relative box of each act section present on this page. */
function measureActs(): ActSection[] {
  return ACT_IDS.flatMap((id, act) => {
    const section = document.querySelector(`[aria-labelledby="${id}"]`)
    if (!section) return []
    const rect = section.getBoundingClientRect()
    return [{ act, top: rect.top + window.scrollY, height: rect.height }]
  })
}

/**
 * Follows the guest's scroll through the five acts. Writes the continuous
 * position through `setStage` (which wakes the WebGL loop), and the nearest act to
 * `data-act` on the returned ref's element, which the lite fallback's CSS
 * keys off (and e2e asserts on). At most one update per frame, and only when something moved.
 *
 * Sections are re-measured whenever the page's height changes: the RSVP
 * form swaps for a ticket, fonts load, the agenda reveals.
 */
export function useStageTracker<T extends HTMLElement>(enabled: boolean): RefObject<T | null> {
  const target = useRef<T>(null)

  useEffect(() => {
    if (!enabled) return undefined

    let sections = measureActs()
    let frame = 0

    const update = () => {
      frame = 0
      const { innerHeight } = window
      const anchors = actAnchors(sections, innerHeight, document.documentElement.scrollHeight)
      const stage = stagePosition(anchors, scrollAnchor(window.scrollY, innerHeight))
      setStage(stage)
      const act = String(Math.round(stage))
      const el = target.current
      if (el && el.dataset.act !== act) el.dataset.act = act
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    const remeasure = () => { sections = measureActs(); schedule() }

    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', remeasure)
    const ro = new ResizeObserver(remeasure)
    ro.observe(document.body)
    update()

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', remeasure)
      ro.disconnect()
      setStage(0)
    }
  }, [enabled])

  return target
}
