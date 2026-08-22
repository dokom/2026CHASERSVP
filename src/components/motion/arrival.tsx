'use client'

import { useRef } from 'react'
import { animate, createTimeline, morphTo, onScroll, splitText, stagger } from 'animejs'
import { journey } from '@/lib/motion/journey'
import { useMotionScope } from './use-motion-scope'

/**
 * Wraps the welcome section. Two motions with deliberately different triggers:
 * the name resolves ON LOAD (the hero moment should not wait for a scroll),
 * and the seal breaks ON SCROLL through the first act (the guest's own
 * gesture opens the invitation).
 */
export function Arrival({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useMotionScope(() => {
    const root = ref.current
    if (!root) return

    // --- the name, on load ------------------------------------------------
    const name = root.querySelector<HTMLElement>('[data-guest-name]')
    if (name) {
      const { chars } = splitText(name, { chars: true })
      animate(chars, {
        opacity: [0, 1],
        translateY: ['0.35em', '0em'],
        ease: 'outExpo',
        duration: 900,
        delay: stagger(45, { start: 250 }),
      })
    }

    // --- the seal, on scroll -----------------------------------------------
    const intact = root.querySelector<SVGPathElement>('[data-seal-intact]')
    const broken = root.querySelector<SVGPathElement>('[data-seal-broken]')
    if (intact && broken) {
      createTimeline({
        autoplay: onScroll({
          target: root,
          enter: 'top top',
          leave: 'bottom top',
          sync: 0.5,
          onUpdate: (self) => {
            journey.sealBreak = self.progress
          },
        }),
      })
        .add(intact, { d: morphTo(broken), ease: 'inOutQuad', duration: 1000 })
        .add(intact, { rotate: -6, scale: 0.92, ease: 'outQuad', duration: 1000 }, 0)
    }
  })

  return <div ref={ref} data-arrival>{children}</div>
}
