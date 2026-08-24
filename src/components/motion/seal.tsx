interface SealProps {
  /** One guest-name character, set as a pressed monogram at the seal's
   * centre. Optional — most seals (e.g. the terminal one on BrassLine) carry
   * no monogram. Another component supplies this from the guest's name. */
  initial?: string
  /** "lg" renders the seal ~1.6x — the hero's opening seal, which needs to
   * read as the page's one large object. "md" (default) is every other
   * use, including the terminal seal glyph. */
  size?: 'md' | 'lg'
}

/** Tailwind size classes per `size`. "lg" is ~1.6x "md" (96px -> 153.6px),
 * matched on both axes so the viewBox's 1:1 aspect never distorts. */
const SIZE_CLASSES: Record<NonNullable<SealProps['size']>, string> = {
  md: 'h-24 w-24',
  lg: 'h-[9.6rem] w-[9.6rem]',
}

/**
 * A wax seal as two SVG paths. The intact disc is visible; the broken shape
 * is a morph target kept in the DOM but hidden, so morphTo() has real
 * geometry to read. Both paths are built from the same twelve hand-pressed
 * anchors, run through a closed Catmull-Rom spline (deterministic — fixed
 * numbers, no runtime randomness) so morphTo can interpolate point-for-point
 * instead of guessing a correspondence.
 *
 * The outline is organic on purpose: uneven radii and a closed spline
 * instead of straight edges, so it reads as pressed wax — soft, rounded,
 * slightly lopsided lumps — not a polygon badge. The inner ring is embossed
 * and deliberately off-centre from the outer disc, so together they read as
 * a stamped object rather than two concentric circles (a "balloon").
 *
 * Does not centre itself — the caller positions the seal (e.g. inside the
 * brass line's channel), so no `mx-auto` here.
 */
export function Seal({ initial, size = 'md' }: SealProps) {
  const monogram = initial?.trim().slice(0, 1).toUpperCase()

  return (
    <svg
      data-seal
      aria-hidden="true"
      viewBox="0 0 120 120"
      className={`block ${SIZE_CLASSES[size]}`}
    >
      <defs>
        <radialGradient id="seal-wax" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#FF6B6B" />
          <stop offset="60%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="var(--accent-dim)" />
        </radialGradient>
      </defs>

      {/* Hand-pressed outline: twelve anchors, uneven radii, closed
          Catmull-Rom spline — soft rounded lumps, not a lathe-turned disc
          or a polygon. */}
      <path
        data-seal-intact
        fill="url(#seal-wax)"
        d="M 60.0 16.8 C 66.8 16.8, 73.7 22.5, 80.5 25.9 C 87.3 29.4, 97.5 31.8, 100.7 37.4 C 104.0 43.1, 100.1 52.6, 100.0 60.0 C 99.9 67.4, 103.0 76.3, 99.8 82.1 C 96.7 87.9, 87.6 90.9, 81.0 94.9 C 74.4 98.9, 66.8 106.5, 60.0 106.1 C 53.3 105.7, 46.9 96.6, 40.5 92.4 C 34.1 88.3, 25.8 86.5, 21.9 81.1 C 18.0 75.7, 17.4 67.3, 17.0 60.0 C 16.6 52.7, 15.5 43.1, 19.3 37.4 C 23.0 31.8, 32.7 29.4, 39.5 25.9 C 46.3 22.5, 53.2 16.8, 60.0 16.8 Z"
      />
      {/* Same twelve-anchor structure with a chip pulled in near the lower
          left — the point that keeps morphTo's correspondence exact. */}
      <path
        data-seal-broken
        fill="url(#seal-wax)"
        className="hidden"
        d="M 60.0 16.8 C 66.8 16.8, 73.7 22.5, 80.5 25.9 C 87.3 29.4, 97.5 31.8, 100.7 37.4 C 104.0 43.1, 100.1 52.6, 100.0 60.0 C 99.9 67.4, 103.0 76.3, 99.8 82.1 C 96.7 87.9, 87.6 90.9, 81.0 94.9 C 74.4 98.9, 66.8 106.5, 60.0 106.1 C 53.3 105.7, 44.4 97.9, 40.5 92.4 C 36.6 86.9, 38.4 78.5, 36.4 73.1 C 34.3 67.7, 31.0 65.9, 28.2 60.0 C 25.3 54.1, 17.4 43.1, 19.3 37.4 C 21.2 31.8, 32.7 29.4, 39.5 25.9 C 46.3 22.5, 53.2 16.8, 60.0 16.8 Z"
      />

      {/* Embossed inner ring — off-centre from the disc's own (60,60), so it
          reads as a stamped die mark rather than a concentric second circle. */}
      <circle cx="52" cy="66" r="19" fill="none" stroke="var(--ink)" strokeOpacity="0.32" strokeWidth="2" />
      <circle cx="53" cy="65" r="19" fill="none" stroke="#FFD1D1" strokeOpacity="0.3" strokeWidth="1" />

      {monogram ? (
        <text
          x="52"
          y="66"
          textAnchor="middle"
          dominantBaseline="central"
          style={{ font: '600 30px var(--font-display, serif)', fill: 'var(--ink)', fillOpacity: 0.72 }}
        >
          {monogram}
        </text>
      ) : null}
    </svg>
  )
}
