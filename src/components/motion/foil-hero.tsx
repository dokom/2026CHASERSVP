'use client'

import dynamic from 'next/dynamic'
import { ACT_IDS } from '@/lib/motion/acts'
import { useColorScheme, useMotionMode } from './motion-provider'
import { useStageTracker } from './use-stage-tracker'

/**
 * The ONLY path to three.js. Gated on mode before the dynamic component is
 * rendered, so the chunk is never requested on a lite or reduced visit.
 * ssr: false keeps three out of the server bundle entirely.
 */
const FoilScene = dynamic(() => import('./foil-scene').then((m) => m.FoilScene), {
  ssr: false,
  loading: () => null,
})

/**
 * The stage behind the guest page. Full motion gets the WebGL scene; lite
 * gets one CSS glow per act, cross-faded by `data-act` with no per-frame
 * work; reduced gets nothing — the page's own ground is its final state.
 *
 * `highlightSeat` is a boolean on purpose: the scene lights a symbolic table,
 * so no table number ever has to reach the client for it.
 */
export function FoilHero({ highlightSeat = false }: { highlightSeat?: boolean }) {
  const mode = useMotionMode()
  const scheme = useColorScheme()
  const stageRef = useStageTracker<HTMLDivElement>(mode !== 'reduced')

  if (mode === 'reduced') return null
  return (
    <div ref={stageRef} data-stage className="contents">
      {mode === 'full' ? (
        <FoilScene scheme={scheme} highlight={highlightSeat} />
      ) : (
        <div aria-hidden="true" className="stage-lite">
          {ACT_IDS.map((id, act) => <span key={id} data-lite-act={act} />)}
        </div>
      )}
    </div>
  )
}
