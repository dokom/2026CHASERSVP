'use client'

import { useEffect, useRef } from 'react'
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, PerspectiveCamera,
  Points, Scene, ShaderMaterial, WebGLRenderer,
} from 'three'
import { journey } from '@/lib/motion/journey'

const COUNT = 800
const BRASS = new Color('#C9A24D')

const VERTEX = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uDisperse;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    // Slow drift upward with a lateral sway unique to each fleck.
    p.y += mod(uTime * 0.04 * (0.6 + aSeed), 2.4) - 1.2;
    p.x += sin(uTime * 0.3 + aSeed * 6.28) * 0.08;
    // Disperse radially from the origin as the seal breaks.
    p.xy += normalize(p.xy + 0.0001) * uDisperse * (0.8 + aSeed) * 1.6;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.2 + aSeed * 2.2) * (240.0 / -mv.z);
    vAlpha = (0.35 + aSeed * 0.5) * (1.0 - uDisperse * 0.6);
  }
`

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    // Soft disc; discard the corners so points read as flecks, not squares.
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float edge = smoothstep(0.5, 0.2, d);
    gl_FragColor = vec4(uColor, vAlpha * edge);
  }
`

function buildGeometry(): BufferGeometry {
  const positions = new Float32Array(COUNT * 3)
  const seeds = new Float32Array(COUNT)
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 3.2
    positions[i * 3 + 1] = (Math.random() - 0.5) * 2.4
    positions[i * 3 + 2] = (Math.random() - 0.5) * 1.5
    seeds[i] = Math.random()
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1))
  return geometry
}

/**
 * Brass foil flecks behind the arrival act. Pauses when the tab is hidden or
 * the hero scrolls out of view, and disposes everything on unmount — a WebGL
 * context left running off-screen is exactly the battery drain the spec's
 * motion rails forbid.
 */
export function FoilScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'low-power' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))

    const scene = new Scene()
    const camera = new PerspectiveCamera(55, 1, 0.1, 10)
    camera.position.z = 2.6

    const material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uDisperse: { value: 0 },
        uColor: { value: BRASS },
      },
    })
    const points = new Points(buildGeometry(), material)
    scene.add(points)

    const resize = () => {
      const { clientWidth, clientHeight } = canvas
      renderer.setSize(clientWidth, clientHeight, false)
      camera.aspect = clientWidth / clientHeight
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let visible = true
    let hidden = document.hidden
    let frame = 0
    const start = performance.now()

    const tick = () => {
      frame = 0
      if (!visible || hidden) return
      material.uniforms.uTime!.value = (performance.now() - start) / 1000
      material.uniforms.uDisperse!.value = journey.sealBreak
      renderer.render(scene, camera)
      frame = requestAnimationFrame(tick)
    }
    const run = () => { if (!frame && visible && !hidden) frame = requestAnimationFrame(tick) }

    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false
      run()
    })
    io.observe(canvas)

    const onVisibility = () => { hidden = document.hidden; run() }
    document.addEventListener('visibilitychange', onVisibility)
    run()

    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', onVisibility)
      io.disconnect()
      ro.disconnect()
      points.geometry.dispose()
      material.dispose()
      renderer.dispose()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-foil-hero
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[70vh] w-full"
    />
  )
}
