'use client'

import dynamic from 'next/dynamic'
import { useMotionMode } from './motion-provider'

/**
 * The ONLY path to three.js. Gated on mode before the dynamic component is
 * rendered, so the chunk is never requested on a lite or reduced visit.
 * ssr: false keeps three out of the server bundle entirely.
 */
const FoilScene = dynamic(() => import('./foil-scene').then((m) => m.FoilScene), {
  ssr: false,
  loading: () => null,
})

export function FoilHero() {
  const mode = useMotionMode()
  if (mode !== 'full') return null
  return <FoilScene />
}
