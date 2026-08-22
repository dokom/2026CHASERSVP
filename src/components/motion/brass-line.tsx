'use client'

import { useEffect, useRef, useState } from 'react'
import { animate, createDrawable, onScroll } from 'animejs'
import { buildBrassPath, type Anchor } from '@/lib/motion/brass-path'
import { useMotionScope } from './use-motion-scope'
import { useMotionMode } from './motion-provider'

const GUTTER_X = 24
const ACT_IDS = ['welcome', 'event', 'evening', 'seat', 'rsvp'] as const

type Geometry = { d: string; height: number; width: number }

/** Document-relative top of an element, independent of current scroll. */
function docTop(el: Element): number {
  return el.getBoundingClientRect().top + window.scrollY
}

function measure(root: HTMLElement): Geometry | null {
  const headings = ACT_IDS
    .map((id) => root.querySelector<HTMLElement>(`#${id}`))
    .filter((el): el is HTMLElement => el !== null)
  if (headings.length < 2) return null

  const rootTop = docTop(root)
  const width = root.clientWidth
  const height = root.scrollHeight

  const anchors: Anchor[] = headings.slice(1).map((h) => {
    const anchor: Anchor = { y: docTop(h) - rootTop }
    // The seat act bends toward the guest's marker, if one is placed.
    if (h.id === 'seat') {
      const marker = root.querySelector<HTMLElement>('[data-testid="table-marker"]')
      if (marker) {
        const rect = marker.getBoundingClientRect()
        anchor.x = rect.left + rect.width / 2 - root.getBoundingClientRect().left
        anchor.y = docTop(marker) - rootTop
      }
    }
    return anchor
  })

  // The seal is an <svg>, not an HTMLElement — offsetWidth/offsetHeight are
  // undefined on SVGSVGElement, which would poison this whole path with NaN.
  // getBoundingClientRect() works on any Element and is already used above.
  const seal = root.querySelector<HTMLElement>('[data-seal]')
  const sealX = seal
    ? seal.getBoundingClientRect().left + seal.getBoundingClientRect().width / 2 - root.getBoundingClientRect().left
    : width / 2
  const sealY = seal ? docTop(seal) + seal.getBoundingClientRect().height / 2 - rootTop : 120

  return {
    width,
    height,
    d: buildBrassPath({
      gutterX: GUTTER_X,
      width,
      start: { x: sealX, y: sealY },
      anchors,
      end: { x: width / 2, y: height - 80 },
    }),
  }
}

/**
 * The signature: one continuous brass line, drawn by scroll, from the opening
 * seal to the closing one. Absolutely positioned over the guest <main>, which
 * must be `position: relative`.
 *
 * In reduced mode the path renders fully drawn — the SVG's natural state —
 * and no timeline is created at all.
 */
export function BrassLine() {
  const mode = useMotionMode()
  const pathRef = useRef<SVGPathElement>(null)
  const [geometry, setGeometry] = useState<Geometry | null>(null)

  // Measure after layout, and again whenever the page reflows. Reflow is a
  // layout event we respond to, not something we animate.
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-guest-root]')
    if (!root) return undefined
    const update = () => setGeometry(measure(root))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useMotionScope(() => {
    const path = pathRef.current
    const root = document.querySelector<HTMLElement>('[data-guest-root]')
    if (!path || !root || !geometry) return
    const [drawable] = createDrawable(path)
    if (!drawable) return
    animate(drawable, {
      draw: ['0 0', '0 1'],
      ease: 'linear',
      autoplay: onScroll({
        target: root,
        enter: 'top top',
        leave: 'bottom bottom',
        sync: 0.35,
      }),
    })
  }, [geometry?.d])

  if (!geometry) return null

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0"
      width={geometry.width}
      height={geometry.height}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      data-brass-line={mode}
    >
      <path
        ref={pathRef}
        d={geometry.d}
        fill="none"
        stroke="var(--brass-dim)"
        strokeWidth={1.25}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
