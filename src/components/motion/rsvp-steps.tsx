'use client'

import { useRef } from 'react'
import { animate, stagger } from 'animejs'
import { useMotionScope, withWillChange } from './use-motion-scope'

/**
 * Animates the children of whichever step is currently visible. Re-runs when
 * `step` changes. Never touches `hidden`: the form owns which step is shown,
 * and the all-steps-stay-mounted rule is what keeps a guest's input alive
 * across Back.
 */
export function RsvpSteps({ step, children }: { step: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useMotionScope(() => {
    const root = ref.current
    if (!root) return
    // A step can span several sibling elements — step 2 is a div of guest
    // cards AND the "add another guest" button — so collect every visible one.
    const active = Array.from(root.children).filter(
      (el) => !(el as HTMLElement).hidden && el.getAttribute('aria-hidden') !== 'true',
    ) as HTMLElement[]
    const targets = active.flatMap((el) => Array.from(el.children) as HTMLElement[])
    if (targets.length === 0) return

    const willChange = withWillChange(targets, 'transform, opacity')
    animate(targets, {
      opacity: [0, 1],
      translateX: [18, 0],
      ease: 'outExpo',
      duration: 520,
      delay: stagger(40),
      onBegin: willChange.onBegin,
      onComplete: willChange.onComplete,
    })
  }, [step])

  return <div ref={ref} data-rsvp-steps>{children}</div>
}
