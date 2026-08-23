'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import {
  deviceTier, prefersReducedMotion, resolveMotionMode, type MotionMode,
} from '@/lib/motion/preferences'

const MotionContext = createContext<MotionMode>('reduced')

export type ColorScheme = 'dark' | 'light'

const ColorSchemeContext = createContext<ColorScheme>('dark')

/**
 * Resolves which colour scheme is actually on screen right now: an explicit
 * `data-theme="dark"|"light"` on `<html>` always wins (the admin theme
 * toggle sets this), and only when it is absent does the OS
 * `prefers-color-scheme` decide. Reading `prefers-color-scheme` alone (as
 * FoilScene used to) misses a visitor whose OS is light but who has an
 * explicit dark theme applied, or vice versa.
 */
function resolveColorScheme(): ColorScheme {
  const attr = document.documentElement.getAttribute('data-theme')
  if (attr === 'dark' || attr === 'light') return attr
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Decides the motion mode exactly once per page load and hands it down.
 *
 * Starts as 'reduced' so server output and the first client paint agree and
 * nothing animates before hydration. The real mode is resolved in an effect —
 * the only place in the app that reads navigator or matchMedia for motion.
 *
 * Also tracks the resolved colour scheme (see `resolveColorScheme`) and
 * re-resolves it whenever `data-theme` changes or the OS preference changes,
 * so components that need scheme-aware colours (FoilScene) never have to
 * read `matchMedia` themselves.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<MotionMode>('reduced')
  const [scheme, setScheme] = useState<ColorScheme>('dark')

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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScheme(resolveColorScheme())

    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const onMediaChange = () => setScheme(resolveColorScheme())
    media?.addEventListener('change', onMediaChange)

    const onAttributeChange = new MutationObserver(() => setScheme(resolveColorScheme()))
    onAttributeChange.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    return () => {
      media?.removeEventListener('change', onMediaChange)
      onAttributeChange.disconnect()
    }
  }, [])

  return (
    <MotionContext.Provider value={mode}>
      <ColorSchemeContext.Provider value={scheme}>
        <div data-motion={mode} className="contents">{children}</div>
      </ColorSchemeContext.Provider>
    </MotionContext.Provider>
  )
}

export function useMotionMode(): MotionMode {
  return useContext(MotionContext)
}

export function useColorScheme(): ColorScheme {
  return useContext(ColorSchemeContext)
}
