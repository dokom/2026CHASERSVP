'use client'

import { useRef } from 'react'
import { animate } from 'animejs'
import { useMotionScope, withWillChange } from './use-motion-scope'

/** The stamp comes down: a press from slightly above, a settle, then the shimmer. */
export function Sealed({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)

  useMotionScope(() => {
    const el = ref.current
    if (!el) return
    const willChange = withWillChange(el, 'transform, opacity')
    animate(el, {
      scale: [1.18, 0.97, 1],
      rotate: [-3, 0.6, 0],
      opacity: [0, 1, 1],
      ease: 'outBack',
      duration: 700,
      onBegin: willChange.onBegin,
      onComplete: () => {
        willChange.onComplete()
        el.classList.add('sealed-shimmer')
      },
    })
  })

  return <div ref={ref} data-sealed className="origin-center">{children}</div>
}
