'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import {
  deviceTier, prefersReducedMotion, resolveMotionMode, type MotionMode,
} from '@/lib/motion/preferences'

const MotionContext = createContext<MotionMode>('reduced')

/**
 * Decides the motion mode exactly once per page load and hands it down.
 *
 * Starts as 'reduced' so server output and the first client paint agree and
 * nothing animates before hydration. The real mode is resolved in an effect —
 * the only place in the app that reads navigator or matchMedia.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<MotionMode>('reduced')

  useEffect(() => {
    const nav = navigator as Navigator & {
      deviceMemory?: number
      connection?: { effectiveType?: string; saveData?: boolean }
    }
    // Resolves the mode exactly once per mount from navigator/matchMedia,
    // which cannot be read during render; this is not a synchronization loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(resolveMotionMode({
      reducedMotion: prefersReducedMotion(window.matchMedia?.bind(window)),
      tier: deviceTier({
        deviceMemory: nav.deviceMemory,
        hardwareConcurrency: nav.hardwareConcurrency,
        connection: nav.connection,
      }),
    }))
  }, [])

  return (
    <MotionContext.Provider value={mode}>
      <div data-motion={mode} className="contents">{children}</div>
    </MotionContext.Provider>
  )
}

export function useMotionMode(): MotionMode {
  return useContext(MotionContext)
}
