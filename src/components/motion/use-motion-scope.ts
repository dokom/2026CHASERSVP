'use client'

import { useEffect, type DependencyList } from 'react'
import { createScope, type Scope } from 'animejs'
import type { MotionMode } from '@/lib/motion/preferences'
import { useMotionMode } from './motion-provider'

/**
 * Runs a timeline factory inside an Anime scope and reverts it on cleanup.
 *
 * React 19 Strict Mode runs every effect twice in development. Without the
 * revert, every timeline in the app would be created twice and the second
 * copy would leak. Every animation in this codebase goes through this hook.
 *
 * The factory is skipped entirely in 'reduced' mode: the markup's own final
 * state IS the reduced-motion rendering, so there is nothing to set up.
 */
export function useMotionScope(
  factory: (scope: Scope, mode: Exclude<MotionMode, 'reduced'>) => void,
  deps: DependencyList = [],
): void {
  const mode = useMotionMode()

  useEffect(() => {
    if (mode === 'reduced') return undefined
    const scope = createScope()
    scope.add(() => factory(scope, mode))
    return () => {
      scope.revert()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- factory identity is intentionally not a dep
  }, [mode, ...deps])
}

type WillChangeTarget = HTMLElement | ArrayLike<HTMLElement>

/**
 * The plan's `will-change` rail: apply it only while a timeline is actually
 * running, remove it the moment the timeline completes. Pass the result's
 * `onBegin`/`onComplete` straight through to `animate()` or `createTimeline()`
 * — never leave `will-change` set in CSS or hanging around after a timeline
 * finishes, both of which pin a compositor layer for no reason.
 */
export function withWillChange(
  target: WillChangeTarget,
  property = 'transform, opacity',
): { onBegin: () => void; onComplete: () => void } {
  const elements = target instanceof HTMLElement ? [target] : Array.from(target)

  return {
    onBegin: () => {
      elements.forEach((el) => { el.style.willChange = property })
    },
    onComplete: () => {
      elements.forEach((el) => { el.style.willChange = '' })
    },
  }
}
