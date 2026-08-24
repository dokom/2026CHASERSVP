'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * The floorplan's frame, with click-to-fullscreen.
 *
 * `inline` is the [data-seat-map] stage SeatAct scales on scroll; this frame
 * clips it (an element cannot `overflow-hidden` its own transform, which is
 * why the two are separate). `fullscreen` is a second, unscaled rendering of
 * the same plan for the overlay: server-rendered twice rather than cloned
 * here, so this client component never needs a render function passed
 * across the server boundary.
 *
 * A fixed overlay rather than the Fullscreen API: iOS Safari does not grant
 * that API to anything but <video>, and the gala's guests are on phones.
 */
export function SeatMapViewer({ inline, fullscreen }: { inline: React.ReactNode; fullscreen: React.ReactNode }) {
  const [isFullscreen, setFullscreen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isFullscreen) return undefined
    const trigger = triggerRef.current
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      trigger?.focus()
    }
  }, [isFullscreen])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setFullscreen(true)}
        aria-label="View the floorplan full screen"
        data-seat-map-viewport
        className="relative block w-full cursor-zoom-in overflow-hidden rounded border border-[var(--color-border)] p-0 text-left lg:max-w-md"
      >
        {inline}
      </button>

      {/* Portalled to <body>: the motion layer wraps this section in
          transformed ancestors, and `position: fixed` inside a transform is
          trapped in that ancestor's stacking context — the overlay would be
          drawn underneath the sections that follow it, which then intercept
          the tap meant to close it. */}
      {isFullscreen ? createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Floorplan of the venue"
          data-seat-map-fullscreen
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[var(--ink)]/95 p-4"
        >
          <button
            type="button"
            autoFocus
            onClick={() => setFullscreen(false)}
            aria-label="Exit full screen"
            className="relative max-h-full max-w-full cursor-zoom-out rounded border border-[var(--color-accent)] bg-black"
          >
            {fullscreen}
          </button>
          <p className="text-sm text-white/80">Tap anywhere to exit</p>
          {/* The backdrop itself closes too: a guest who taps beside the plan expects the same result. */}
          <button type="button" onClick={() => setFullscreen(false)} aria-hidden="true" tabIndex={-1} className="absolute inset-0 -z-10 cursor-zoom-out" />
        </div>,
        document.body,
      ) : null}
    </>
  )
}
