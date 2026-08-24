'use client'

import { useEffect, useRef, useState } from 'react'
import { animate, createDrawable, onScroll } from 'animejs'
import { buildBrassPath, type Anchor } from '@/lib/motion/brass-path'
import { useMotionScope } from './use-motion-scope'
import { useMotionMode } from './motion-provider'

const GUTTER_X = 24
const ACT_IDS = ['welcome', 'event', 'evening', 'seat', 'rsvp'] as const
/** Vertical breathing room between the drawn line's end and the RSVP act it
 * terminates just above, so the stroke never crosses into the form. */
const RSVP_CLEARANCE = 40
/** How far inside the seal's lower edge the line starts, as a fraction of
 * the seal's height — nestled into the wax, not dangling off the rim. */
const SEAL_EDGE_Y_RATIO = 0.08
/** Radius of the small terminal seal drawn where the line closes. */
const TERMINAL_SEAL_RADIUS = 7

type Point = { x: number; y: number }
type Geometry = { d: string; height: number; width: number; end: Point }

/** Document-relative top of an element, independent of current scroll. */
function docTop(el: Element): number {
  return el.getBoundingClientRect().top + window.scrollY
}

/** The point where the drawn line should begin: the seal's lower edge,
 * centred on its width, so the line runs straight down into the channel as
 * the seal's own broken edge continuing rather than a string tied off to
 * one side. */
function sealEdge(seal: HTMLElement, root: HTMLElement, rootTop: number): Point {
  const rect = seal.getBoundingClientRect()
  const rootLeft = root.getBoundingClientRect().left
  return {
    x: rect.left + rect.width / 2 - rootLeft,
    y: docTop(seal) + rect.height - SEAL_EDGE_Y_RATIO * rect.height - rootTop,
  }
}

/** The point where the drawn line should end: just above the RSVP act,
 * inside the gutter, so it never crosses the form. */
function rsvpTerminus(root: HTMLElement, rootTop: number, fallbackY: number): Point {
  const rsvp = root.querySelector<HTMLElement>('#rsvp')
  const y = rsvp ? docTop(rsvp) - rootTop - RSVP_CLEARANCE : fallbackY
  return { x: GUTTER_X, y }
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
  const start = seal ? sealEdge(seal, root, rootTop) : { x: GUTTER_X, y: 120 }
  const end = rsvpTerminus(root, rootTop, height - 80)

  return {
    width,
    height,
    end,
    d: buildBrassPath({ gutterX: GUTTER_X, width, height, start, anchors, end }),
  }
}

/**
 * The signature: one continuous brass line, drawn by scroll, from the opening
 * seal to a small terminal seal glyph just above the RSVP act. Absolutely
 * positioned over the guest <main>, which must be `position: relative`.
 *
 * In reduced mode the path renders fully drawn — the SVG's natural state —
 * and no timeline is created at all.
 */
export function BrassLine() {
  const mode = useMotionMode()
  const pathRef = useRef<SVGPathElement>(null)
  const [geometry, setGeometry] = useState<Geometry | null>(null)

  // Measure after layout, and again whenever the page reflows. The
  // ResizeObserver callback only schedules a rAF-deferred measurement so it
  // never forces synchronous layout from inside the observer's own callback.
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-guest-root]')
    if (!root) return undefined
    const update = () => setGeometry(measure(root))
    update()
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    })
    observer.observe(root)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
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
        enter: { container: 'top', target: 'top' },
        leave: { container: 'bottom', target: 'bottom' },
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
        stroke="var(--accent-dim)"
        strokeWidth={1.25}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* The line closes into a seal again, not a dangling end. */}
      <g data-brass-terminal-seal>
        <circle cx={geometry.end.x} cy={geometry.end.y} r={TERMINAL_SEAL_RADIUS - 2} fill="var(--accent)" />
        <circle
          cx={geometry.end.x}
          cy={geometry.end.y}
          r={TERMINAL_SEAL_RADIUS}
          fill="none"
          stroke="var(--accent-dim)"
          strokeWidth={1.25}
        />
      </g>
    </svg>
  )
}
