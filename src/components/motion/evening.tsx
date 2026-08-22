'use client'

import { useRef } from 'react'
import { animate, onScroll } from 'animejs'
import { useMotionScope } from './use-motion-scope'

/**
 * Wraps Plan 2's `<ol data-agenda>` timeline. Each `<li>` reveals as it
 * enters the lower part of the viewport — opacity and a short rise only,
 * as if the brass line's pen has just reached it. The item's brass dot
 * (the `aria-hidden` marker already in the markup) scales in a beat later,
 * as if the pen paused there. The list markup itself is untouched.
 */
export function Evening({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useMotionScope(() => {
    const root = ref.current
    if (!root) return
    const items = root.querySelectorAll<HTMLLIElement>('[data-agenda] > li')

    items.forEach((item) => {
      const dot = item.querySelector<HTMLElement>('[aria-hidden="true"]')
      animate(item, {
        opacity: [0, 1],
        translateY: [14, 0],
        ease: 'outQuad',
        duration: 600,
        autoplay: onScroll({ target: item, enter: 'bottom-=12% top', sync: 0.6 }),
      })
      if (dot) {
        animate(dot, {
          scale: [0, 1],
          ease: 'outBack',
          duration: 400,
          delay: 150,
          autoplay: onScroll({ target: item, enter: 'bottom-=12% top' }),
        })
      }
    })
  })

  return <div ref={ref} data-evening>{children}</div>
}
