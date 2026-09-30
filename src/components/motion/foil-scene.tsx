'use client'

import { useEffect, useRef } from 'react'
import { PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { actTransitions, damp } from '@/lib/motion/acts'
import { journey, onStageChange } from '@/lib/motion/journey'
import { buildStageLayout } from '@/lib/motion/stage-layout'
import type { ColorScheme } from './motion-provider'
import { CameraRig } from './stage/camera-rig'
import { applyScheme, createParticles, type StageUniforms } from './stage/particles'

/** How fast the shown stage catches up with the scrolled one (per second).
 * A jump from the first act to the last settles in about 1.7 s. */
const STAGE_RATE = 5
/** Close enough to snap: below this the difference is invisible, and
 * snapping is what lets the loop come to rest. */
const SETTLE_EPSILON = 0.001
/** A tab returning from the background must not teleport the camera. */
const MAX_FRAME_SECONDS = 0.1
const FAR_PLANE = 60

type Live = {
  material: ReturnType<typeof createParticles>['material']
  uniforms: StageUniforms
  wake: () => void
}

/**
 * The five-act stage: one fixed full-viewport canvas behind the page, where
 * the foil flecks of the seal become the lights of a night drive, a
 * chandelier, and the tables of the room, as the guest scrolls.
 *
 * The loop runs only while there is something to animate. Once the response
 * act is reached and the camera has settled, it renders one still frame and
 * stops, waking again when the stage moves or the canvas resizes; it also
 * pauses while the tab is hidden or the context is lost, and disposes
 * everything on unmount.
 */
export function FoilScene({ scheme, highlight }: { scheme: ColorScheme; highlight: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const liveRef = useRef<Live | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    // No usable WebGL — disabled, a blocklisted GPU, or a context this canvas
    // already lost — throws from inside Three's constructor. The stage is
    // decoration: log it and render nothing rather than take the page down.
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' })
    } catch (error) {
      console.warn('Stage disabled: WebGL is unavailable on this device', error)
      return undefined
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))

    const scene = new Scene()
    const camera = new PerspectiveCamera(55, 1, 0.1, FAR_PLANE)
    const rig = new CameraRig()
    const { mesh, material, uniforms } = createParticles(buildStageLayout())
    scene.add(mesh)

    // The text column is the guest page's <main>, centred: its share of the
    // viewport's width is its half-width in NDC.
    const column = canvas.closest('[data-guest-root]')
    const resize = () => {
      const { clientWidth, clientHeight } = canvas
      renderer.setSize(clientWidth, clientHeight, false)
      camera.aspect = clientWidth / clientHeight
      camera.updateProjectionMatrix()
      uniforms.uColumn.value = column ? Math.min(1, column.clientWidth / clientWidth) : 1
    }
    resize()

    let hidden = document.hidden
    let lost = false
    let frame = 0
    // Start where the page already is: a reload halfway down must not fly
    // the camera in from the seal.
    let shown = journey.stage
    let last = performance.now()
    const start = last

    const tick = (now: number) => {
      frame = 0
      if (hidden || lost) return
      const dt = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - last) / 1000))
      last = now

      const target = journey.stage
      shown = Math.abs(target - shown) < SETTLE_EPSILON ? target : damp(shown, target, STAGE_RATE, dt)
      const morph = actTransitions(shown)

      rig.apply(camera, shown)
      uniforms.uMorph.value.set(...morph)
      uniforms.uTime.value = (now - start) / 1000
      uniforms.uSealBreak.value = journey.sealBreak
      renderer.render(scene, camera)

      const resting = morph[3] >= 1 && shown === target
      if (!resting) frame = requestAnimationFrame(tick)
    }
    const wake = () => {
      if (frame || hidden || lost) return
      last = performance.now()
      frame = requestAnimationFrame(tick)
    }

    liveRef.current = { material, uniforms, wake }
    applyScheme(material, uniforms, scheme)
    uniforms.uHighlight.value = highlight ? 1 : 0

    const onResize = () => { resize(); wake() }
    const ro = new ResizeObserver(onResize)
    ro.observe(canvas)
    const onVisibility = () => { hidden = document.hidden; wake() }
    // Three prevents the default on loss so the context can come back; the
    // loop only has to stop asking for frames until it does.
    const onLost = () => { lost = true; cancelAnimationFrame(frame); frame = 0 }
    const onRestored = () => { lost = false; wake() }

    document.addEventListener('visibilitychange', onVisibility)
    // Woken by the tracker AFTER it writes the new stage — never by scroll
    // directly, which could run first and read the stage one frame stale.
    const offStage = onStageChange(wake)
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)
    wake()

    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', onVisibility)
      offStage()
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      ro.disconnect()
      liveRef.current = null
      mesh.geometry.dispose()
      material.dispose()
      renderer.dispose()
      // dispose() alone frees Three's own GPU resources but leaves the
      // underlying WebGL context alive; without forcing its loss here the
      // context leaks across client-side navigations between guest pages.
      // Only once the canvas has really left the document, though: React's
      // dev-mode StrictMode re-runs this effect on the SAME canvas, and a
      // context lost here can never be re-acquired by the next renderer.
      if (!canvas.isConnected) renderer.forceContextLoss()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scene setup/teardown runs once; prop changes are applied by the effect below
  }, [])

  useEffect(() => {
    const live = liveRef.current
    if (!live) return
    applyScheme(live.material, live.uniforms, scheme)
    live.uniforms.uHighlight.value = highlight ? 1 : 0
    live.wake()
  }, [scheme, highlight])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-foil-hero
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  )
}
