'use client'

import { useEffect, useState } from 'react'
import { countdownParts, type CountdownParts } from '@/lib/guest/countdown'

const TICK_MS = 1000

type Unit = { key: keyof Omit<CountdownParts, 'hasArrived'>; label: string }

const UNITS: readonly Unit[] = [
  { key: 'days', label: 'days' },
  { key: 'hours', label: 'hours' },
  { key: 'minutes', label: 'minutes' },
  { key: 'seconds', label: 'seconds' },
]

/**
 * Ticks down to the evening, one second at a time.
 *
 * Both timestamps arrive as epoch milliseconds from the server, and the
 * first frame is computed from the server's `now` — so the HTML the server
 * sent and React's first client render agree exactly, and hydration never
 * mismatches. Only after mount does the clock switch to the device's own
 * time and start ticking.
 */
export function Countdown({ targetMs, initialNowMs }: { targetMs: number; initialNowMs: number }) {
  const [parts, setParts] = useState(() => countdownParts(new Date(targetMs), new Date(initialNowMs)))

  useEffect(() => {
    const tick = () => setParts(countdownParts(new Date(targetMs), new Date()))
    tick()
    const timer = window.setInterval(tick, TICK_MS)
    return () => window.clearInterval(timer)
  }, [targetMs])

  if (parts.hasArrived) {
    return (
      <p data-countdown="arrived" role="status" className="type-title text-[var(--accent-ink)]">
        The evening is here.
      </p>
    )
  }

  return (
    <div
      data-countdown
      role="timer"
      aria-live="off"
      aria-label={`${parts.days} days, ${parts.hours} hours, ${parts.minutes} minutes and ${parts.seconds} seconds until the event`}
      className="grid grid-cols-4 divide-x divide-[var(--color-border)] border-y border-[var(--color-border)] py-5"
    >
      {UNITS.map((unit) => (
        <div key={unit.key} className="px-1 text-center sm:px-3">
          <span
            data-countdown-unit={unit.key}
            className="block font-serif text-4xl tabular-nums text-[var(--accent-ink)] sm:text-5xl"
          >
            {String(parts[unit.key]).padStart(2, '0')}
          </span>
          <span className="mt-2 block text-xs text-[var(--color-text-muted)] sm:text-sm">
            {unit.label}
          </span>
        </div>
      ))}
    </div>
  )
}
