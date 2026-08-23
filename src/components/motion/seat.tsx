'use client'

import { useRef } from 'react'
import { animate, onScroll } from 'animejs'
import { useMotionScope, withWillChange } from './use-motion-scope'

export function SeatAct({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useMotionScope(() => {
    const root = ref.current
    if (!root) return
    const map = root.querySelector<HTMLElement>('[data-seat-map]')
    if (!map) return

    // transform-origin is the marker itself (set by SeatMap), so scaling the
    // plan zooms toward the guest's table with the marker pinned in place.
    //
    // Anime's shorthand threshold string is "<container-edge> <target-edge>"
    // (container word first) — the object form is used here instead because
    // that ordering reads backwards from the section's own top/bottom words
    // and is easy to invert by accident (as the shorthand once was here: the
    // zoom never started because 'top bottom-=20%' asked for the section's
    // own bottom-20% point to reach the *viewport's* top, which this short
    // section never scrolls far enough to satisfy).
    const willChange = withWillChange(map, 'transform')
    animate(map, {
      scale: [1, 1.55],
      ease: 'outQuad',
      autoplay: onScroll({
        target: root,
        enter: { target: 'top', container: 'bottom-=20%' },
        leave: { target: 'center', container: 'center' },
        sync: 0.5,
      }),
      onBegin: willChange.onBegin,
      onComplete: willChange.onComplete,
    })
  })

  return <div ref={ref} data-seat-act>{children}</div>
}
