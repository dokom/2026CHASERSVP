/**
 * Where every particle of the stage stands in each act, and where the camera
 * stands to see it. Pure data: the WebGL layer uploads these arrays once and
 * the vertex shader morphs between them, so nothing here runs per frame.
 *
 * Seeded, not Math.random: the same layout on every visit, which keeps the
 * full-motion screenshot baseline deterministic.
 */

export type Vec3 = readonly [number, number, number]

/** Particle roles. The same fleck is foil in the seal, a light on the road,
 * a crystal in the chandelier, a place at a table. */
export const KIND_RED = 0
export const KIND_WHITE = 1
export const KIND_LAMP = 2

export const PARTICLE_COUNT = 3000
export const LAYOUT_SEED = 20261

/** Share of particles per kind: red tail-lights, white oncoming headlights,
 * the rest overhead street lamps. */
const RED_SHARE = 0.45
const WHITE_SHARE = 0.35

/** Act 1. A loose slab of foil, wide enough for a desktop, deep enough that
 * a phone's narrow slice of it still reads as depth. */
const SEAL_HALF: Vec3 = [4, 3.2, 1.5]

/** Act 2. A two-lane road running from the camera into the fog. Traffic
 * keeps right: our lane's tail-lights at +x, oncoming headlights at -x. */
export const ROAD_LENGTH = 60
const LANE_INNER = 0.5
const LANE_OUTER = 1.7
const LIGHT_HEIGHT: readonly [number, number] = [-1.0, -0.8]
const LAMP_OFFSET: readonly [number, number] = [3.2, 3.6]
const LAMP_HEIGHT: readonly [number, number] = [2.4, 2.8]

/** Act 3. Three tiers of crystal rings with strands hanging off them. */
export const CHANDELIER_CENTRE: Vec3 = [0, 3.4, -6]
const CHANDELIER_TIERS: readonly { y: number; radius: number }[] = [
  { y: 0.9, radius: 0.7 },
  { y: 0, radius: 1.3 },
  { y: -0.9, radius: 1.9 },
]
const STRAND_SHARE = 0.3
const STRAND_DROP = 0.6
const RING_JITTER = 0.05

/** Act 4. Round tables in a 3×4 grid on the floor. */
export const FLOOR_CENTRE: Vec3 = [0, -2, -6]
const TABLE_COLUMNS = [-2.6, 0, 2.6] as const
const TABLE_ROWS = [-3.9, -1.3, 1.3, 3.9] as const
export const TABLE_RADIUS = 0.75
export const CHAIR_RADIUS = 1.15
const CHAIRS_PER_TABLE = 8
const CHAIR_SHARE = 0.3
const CHAIR_JITTER = 0.08
/**
 * The table that glows for a seated guest: centre column, the row just in
 * front of the camera's look target. The side columns fall outside a phone's
 * portrait frame, so the highlight must never be one of them.
 */
export const HIGHLIGHT_TABLE = 1 + 2 * TABLE_COLUMNS.length

export const TABLE_CENTRES: readonly Vec3[] = TABLE_ROWS.flatMap((z) =>
  TABLE_COLUMNS.map((x): Vec3 => [FLOOR_CENTRE[0] + x, FLOOR_CENTRE[1], FLOOR_CENTRE[2] + z]),
)

/** One camera key per act: where it stands and what it looks at. */
export const CAMERA_POSITIONS: readonly Vec3[] = [
  [0, 0, 6],
  [0, 0.1, 4.5],
  [0, 0.3, 1.5],
  [0, 5.5, 1],
  [0, 7.5, 3.5],
]
export const CAMERA_TARGETS: readonly Vec3[] = [
  [0, 0, 0],
  [0, -0.4, -30],
  [0, 3.2, -6],
  FLOOR_CENTRE,
  FLOOR_CENTRE,
]

export type StageLayout = {
  count: number
  seeds: Float32Array
  kinds: Float32Array
  seal: Float32Array
  drive: Float32Array
  evening: Float32Array
  seat: Float32Array
  /** 1 for particles belonging to HIGHLIGHT_TABLE, else 0. */
  highlight: Float32Array
}

/** mulberry32: tiny, fast, and good enough for scattering particles. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Random = () => number

const between = (random: Random, [min, max]: readonly [number, number]) => min + random() * (max - min)
const spread = (random: Random, half: number) => (random() * 2 - 1) * half

function pickKind(random: Random): number {
  const roll = random()
  if (roll < RED_SHARE) return KIND_RED
  if (roll < RED_SHARE + WHITE_SHARE) return KIND_WHITE
  return KIND_LAMP
}

function sealPoint(random: Random): Vec3 {
  return [spread(random, SEAL_HALF[0]), spread(random, SEAL_HALF[1]), spread(random, SEAL_HALF[2])]
}

function drivePoint(random: Random, kind: number): Vec3 {
  const z = -random() * ROAD_LENGTH
  if (kind === KIND_LAMP) {
    const side = random() < 0.5 ? -1 : 1
    return [side * between(random, LAMP_OFFSET), between(random, LAMP_HEIGHT), z]
  }
  const side = kind === KIND_RED ? 1 : -1
  return [side * between(random, [LANE_INNER, LANE_OUTER]), between(random, LIGHT_HEIGHT), z]
}

function eveningPoint(random: Random): Vec3 {
  const tier = CHANDELIER_TIERS[Math.floor(random() * CHANDELIER_TIERS.length)]!
  const angle = random() * Math.PI * 2
  const radius = tier.radius + spread(random, RING_JITTER)
  const drop = random() < STRAND_SHARE ? random() * STRAND_DROP : 0
  return [
    CHANDELIER_CENTRE[0] + Math.cos(angle) * radius,
    CHANDELIER_CENTRE[1] + tier.y - drop,
    CHANDELIER_CENTRE[2] + Math.sin(angle) * radius,
  ]
}

function seatPoint(random: Random, table: number): Vec3 {
  const [cx, cy, cz] = TABLE_CENTRES[table]!
  if (random() < CHAIR_SHARE) {
    const chair = Math.floor(random() * CHAIRS_PER_TABLE)
    const angle = (chair / CHAIRS_PER_TABLE) * Math.PI * 2
    return [
      cx + Math.cos(angle) * CHAIR_RADIUS + spread(random, CHAIR_JITTER),
      cy,
      cz + Math.sin(angle) * CHAIR_RADIUS + spread(random, CHAIR_JITTER),
    ]
  }
  const angle = random() * Math.PI * 2
  const radius = TABLE_RADIUS + spread(random, RING_JITTER)
  return [cx + Math.cos(angle) * radius, cy, cz + Math.sin(angle) * radius]
}

function write(target: Float32Array, index: number, [x, y, z]: Vec3): void {
  target[index * 3] = x
  target[index * 3 + 1] = y
  target[index * 3 + 2] = z
}

export function buildStageLayout(count = PARTICLE_COUNT, seed = LAYOUT_SEED): StageLayout {
  const random = createRandom(seed)
  const layout: StageLayout = {
    count,
    seeds: new Float32Array(count),
    kinds: new Float32Array(count),
    seal: new Float32Array(count * 3),
    drive: new Float32Array(count * 3),
    evening: new Float32Array(count * 3),
    seat: new Float32Array(count * 3),
    highlight: new Float32Array(count),
  }

  for (let i = 0; i < count; i++) {
    const kind = pickKind(random)
    // Round-robin, so every table gets the same share of particles.
    const table = i % TABLE_CENTRES.length
    layout.seeds[i] = random()
    layout.kinds[i] = kind
    layout.highlight[i] = table === HIGHLIGHT_TABLE ? 1 : 0
    write(layout.seal, i, sealPoint(random))
    write(layout.drive, i, drivePoint(random, kind))
    write(layout.evening, i, eveningPoint(random))
    write(layout.seat, i, seatPoint(random, table))
  }
  return layout
}
