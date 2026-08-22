'use client'

import { useRef } from 'react'
import { animate, createTimeline, morphTo, onScroll, splitText, stagger } from 'animejs'
import { journey } from '@/lib/motion/journey'
import { useMotionScope, withWillChange } from './use-motion-scope'

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
      const willChange = withWillChange(chars, 'transform, opacity')
      animate(chars, {
        opacity: [0, 1],
        translateY: ['0.35em', '0em'],
        ease: 'outExpo',
        duration: 900,
        delay: stagger(45, { start: 250 }),
        onBegin: willChange.onBegin,
        onComplete: willChange.onComplete,
      })
    }

    // --- the seal, on scroll -----------------------------------------------
    const intact = root.querySelector<SVGPathElement>('[data-seal-intact]')
    const broken = root.querySelector<SVGPathElement>('[data-seal-broken]')
    if (intact && broken) {
      createTimeline({
        autoplay: onScroll({
          target: root,
          // Anime's threshold object form is { target, container }: the
          // point on TARGET that must reach the point on CONTAINER. `enter`
          // fires as soon as the welcome section's own top reaches the
          // viewport's top — i.e. right at the start of the very first
          // scroll, since this section sits at the top of the page.
          enter: { target: 'top', container: 'top' },
          // The seal must be fully broken by the time the welcome section
          // has scrolled OUT of the viewport — i.e. once the section's
          // BOTTOM edge has passed the viewport's TOP edge. The equivalent
          // shorthand string is 'top bottom' (container edge first), not
          // the previous 'bottom top': that asked for the section's own top
          // to reach the viewport's bottom, which — for a section already
          // pinned at the top of the page — only happens scrolling
          // backwards past the very start, so it never resolved going
          // forward and the seal timeline had no real end. This pairing is
          // also Anime's own default `leave` value.
          leave: { target: 'bottom', container: 'top' },
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
