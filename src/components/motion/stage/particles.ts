import {
  AdditiveBlending, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, NormalBlending,
  PlaneGeometry, ShaderMaterial, Vector4,
} from 'three'
import { ROAD_LENGTH, type StageLayout } from '@/lib/motion/stage-layout'
import type { ColorScheme } from '../motion-provider'

/** World-space fleck size: 2–6 CSS px at the seal act's camera distance,
 * the same scale the foil hero settled on after the red-wall bug. */
const FLECK_SIZE = 0.045
/** Light-scheme flecks read as darker foil on a bone ground, not a smear. */
const LIGHT_ALPHA_SCALE = 0.45
/** Flecks behind the text column burn at this fraction; the world stays
 * vivid only beside it (on a desktop, around the card). */
const COLUMN_DIM = 0.5

const VERTEX = /* glsl */ `
  attribute float aSeed;
  attribute float aKind;
  attribute float aHighlight;
  attribute vec3 aSeal;
  attribute vec3 aDrive;
  attribute vec3 aEvening;
  attribute vec3 aSeat;

  uniform float uTime;
  uniform float uSealBreak;
  uniform vec4 uMorph;        // seal→drive, drive→evening, evening→seat, seat→response
  uniform float uHighlight;   // 1 when the guest has a released seat
  uniform float uLight;       // 1 on the light scheme
  uniform float uAlphaScale;
  uniform float uSize;
  uniform float uColumn;      // half-width of the text column, in NDC

  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;

  const vec3 RED   = vec3(0.878, 0.055, 0.059);
  const vec3 GOLD  = vec3(1.0, 0.76, 0.42);
  const vec3 WHITE = vec3(1.0, 0.93, 0.84);
  const vec3 NAVY  = vec3(0.30, 0.52, 0.82);
  const float ROAD = ${ROAD_LENGTH.toFixed(1)};
  const float COLUMN_DIM = ${COLUMN_DIM.toFixed(2)};

  vec3 byKind(vec3 red, vec3 white, vec3 lamp) {
    return aKind < 0.5 ? red : (aKind < 1.5 ? white : lamp);
  }
  float byKind(float red, float white, float lamp) {
    return aKind < 0.5 ? red : (aKind < 1.5 ? white : lamp);
  }

  void main() {
    float drive = uMorph.x * (1.0 - uMorph.y);
    // The response act holds still: content wins, and a settled frame is
    // deterministic (the screenshot baseline depends on it).
    float live = 1.0 - uMorph.w;
    float phase = aSeed * 6.2832;

    vec3 seal = aSeal;
    seal.y += sin(uTime * 0.3 + phase) * 0.06;
    seal.xy += normalize(seal.xy + 0.0001) * uSealBreak * (0.8 + aSeed) * 1.6;

    // Traffic flows toward the camera and wraps back into the fog.
    float speed = byKind(3.0, 14.0, 8.0);
    vec3 road = aDrive;
    road.z = -ROAD + mod(aDrive.z + ROAD + uTime * speed, ROAD);

    vec3 evening = aEvening;
    evening.y += sin(uTime * 0.8 + phase) * 0.03;

    vec3 p = mix(seal, road, uMorph.x);
    p = mix(p, evening, uMorph.y);
    p = mix(p, aSeat, uMorph.z);
    p.y += sin(uTime * 0.5 + phase) * 0.04 * live * uMorph.z;

    // Billboard in view space; in the drive, stretch each quad away from the
    // vanishing point so lights smear into streaks.
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec2 away = normalize(mv.xy + vec2(0.0001));
    // (side, away) must stay right-handed: the mirrored basis flips the
    // quad's winding and back-face culling silently drops every particle.
    vec2 side = vec2(away.y, -away.x);
    float size = uSize * (0.6 + aSeed * 0.8);
    float stretch = 1.0 + drive * (3.0 + aSeed * 7.0);
    mv.xy += (side * position.x + away * position.y * stretch) * size;
    gl_Position = projectionMatrix * mv;
    vUv = uv;

    // Nothing may come near enough to the lens to fill the screen, and the
    // far end dissolves into fog instead of popping out.
    float depth = -mv.z;
    float fade = smoothstep(0.8, 2.5, depth) * (1.0 - smoothstep(22.0, 40.0, depth));

    vec3 sealColour = byKind(RED, GOLD, GOLD);
    vec3 driveColour = byKind(RED, WHITE, GOLD);
    vec3 eveningColour = mix(GOLD, WHITE, aSeed * 0.6);
    float mine = aHighlight * uHighlight;
    vec3 seatColour = mix(NAVY, RED, mine);

    vec3 colour = mix(sealColour, driveColour, uMorph.x);
    colour = mix(colour, eveningColour, uMorph.y);
    colour = mix(colour, seatColour, uMorph.z);
    vColor = mix(colour, colour * 0.5, uLight);

    float twinkle = 0.8 + 0.2 * sin(uTime * 2.0 + aSeed * 40.0) * live;
    float base = (0.35 + aSeed * 0.65) * twinkle;
    float seatBoost = 1.0 + mine * uMorph.z * 1.5;
    // Each act's own strength: the lights and the chandelier are the
    // brightest things here, so they give the most back to the text.
    float act = mix(mix(mix(0.8, 0.8, uMorph.x), 0.6, uMorph.y), 1.0, uMorph.z) * mix(1.0, 0.45, uMorph.w);
    // A streak covers stretch-times the pixels; without this the trails
    // read as solid bars.
    float streak = pow(stretch, -0.25);
    float ndcX = abs(gl_Position.x / gl_Position.w);
    float column = mix(COLUMN_DIM, 1.0, smoothstep(uColumn, uColumn + 0.15, ndcX));
    vAlpha = base * fade * seatBoost * act * streak * column * uAlphaScale;
  }
`

const FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    // Soft disc; the quad's own stretch turns it into a streak.
    float d = length(vUv - 0.5) * 2.0;
    if (d > 1.0) discard;
    float edge = 1.0 - smoothstep(0.2, 1.0, d);
    gl_FragColor = vec4(vColor, vAlpha * edge);
  }
`

export type StageUniforms = {
  uTime: { value: number }
  uSealBreak: { value: number }
  uMorph: { value: Vector4 }
  uHighlight: { value: number }
  uLight: { value: number }
  uAlphaScale: { value: number }
  uSize: { value: number }
  uColumn: { value: number }
}

function instanced(values: Float32Array, size: number): InstancedBufferAttribute {
  return new InstancedBufferAttribute(values, size)
}

export function createParticles(layout: StageLayout): { mesh: Mesh; material: ShaderMaterial; uniforms: StageUniforms } {
  const quad = new PlaneGeometry(1, 1)
  const geometry = new InstancedBufferGeometry()
  geometry.index = quad.index
  geometry.setAttribute('position', quad.getAttribute('position'))
  geometry.setAttribute('uv', quad.getAttribute('uv'))
  geometry.instanceCount = layout.count
  geometry.setAttribute('aSeed', instanced(layout.seeds, 1))
  geometry.setAttribute('aKind', instanced(layout.kinds, 1))
  geometry.setAttribute('aHighlight', instanced(layout.highlight, 1))
  geometry.setAttribute('aSeal', instanced(layout.seal, 3))
  geometry.setAttribute('aDrive', instanced(layout.drive, 3))
  geometry.setAttribute('aEvening', instanced(layout.evening, 3))
  geometry.setAttribute('aSeat', instanced(layout.seat, 3))

  const uniforms: StageUniforms = {
    uTime: { value: 0 },
    uSealBreak: { value: 0 },
    uMorph: { value: new Vector4() },
    uHighlight: { value: 0 },
    uLight: { value: 0 },
    uAlphaScale: { value: 1 },
    uSize: { value: FLECK_SIZE },
    uColumn: { value: 1 },
  }
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })

  const mesh = new Mesh(geometry, material)
  // Positions come from the shader, so three's bounding sphere means nothing.
  mesh.frustumCulled = false
  return { mesh, material, uniforms }
}

/**
 * Additive blending is what makes flecks glow on the navy ground; on a light
 * ground the same blend sums light-on-light into a smear, so the light scheme
 * switches to normal blending with darker, fainter flecks.
 */
export function applyScheme(material: ShaderMaterial, uniforms: StageUniforms, scheme: ColorScheme): void {
  const isLight = scheme === 'light'
  material.blending = isLight ? NormalBlending : AdditiveBlending
  uniforms.uLight.value = isLight ? 1 : 0
  uniforms.uAlphaScale.value = isLight ? LIGHT_ALPHA_SCALE : 1
  material.needsUpdate = true
}
