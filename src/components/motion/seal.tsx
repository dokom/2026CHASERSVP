interface SealProps {
  /** One guest-name character, set as a pressed monogram at the seal's
   * centre. Optional — most seals (e.g. the terminal one on BrassLine) carry
   * no monogram. Another component supplies this from the guest's name. */
  initial?: string
}

/**
 * A wax seal as two SVG paths. The intact disc is visible; the broken shape
 * is a morph target kept in the DOM but hidden, so morphTo() has real
 * geometry to read. Both paths are built from the same point count (ten
 * hand-pressed anchors around the disc, deterministically perturbed — no
 * runtime randomness) so morphTo can interpolate point-for-point instead of
 * guessing a correspondence.
 *
 * The outline is irregular on purpose: a real wax seal is pressed, not
 * turned on a lathe. The inner ring is embossed and deliberately off-centre
 * from the outer disc, so together they read as a stamped object rather
 * than two concentric circles (a "balloon").
 */
export function Seal({ initial }: SealProps) {
  const monogram = initial?.trim().slice(0, 1).toUpperCase()

  return (
    <svg
      data-seal
      aria-hidden="true"
      viewBox="0 0 120 120"
      className="mx-auto block h-24 w-24"
    >
      <defs>
        <radialGradient id="seal-wax" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#E0BC6A" />
          <stop offset="60%" stopColor="var(--brass)" />
          <stop offset="100%" stopColor="var(--brass-dim)" />
        </radialGradient>
      </defs>

      {/* Hand-pressed outline: ten anchors, uneven radii, closed Catmull-Rom
          curve. Not a lathe-turned disc. */}
      <path
        data-seal-intact
        fill="url(#seal-wax)"
        d="M60 10 C68.8 10.3, 77.6 18.7, 85.9 24.4 C94.1 30.1, 106.9 35.8, 109.5 43.9 C112 52.1, 104.3 64, 100.9 73.3 C97.5 82.6, 95.6 94.4, 88.8 99.6 C82 104.9, 69.8 104.7, 60 105 C50.2 105.3, 36.7 106.6, 30 101.3 C23.4 95.9, 22.7 82.3, 20.1 73 C17.4 63.6, 12.2 53.5, 14.3 45.2 C16.5 36.8, 25.4 28.6, 33 22.8 C40.6 16.9, 51.2 9.7, 60 10 Z"
      />
      {/* Same ten-anchor structure with a chip pulled in near the lower
          right — the point that keeps morphTo's correspondence exact. */}
      <path
        data-seal-broken
        fill="url(#seal-wax)"
        className="hidden"
        d="M60 10 C68.8 10.3, 77.6 18.7, 85.9 24.4 C94.1 30.1, 110.9 37.1, 109.5 43.9 C108 50.8, 83.4 60.1, 77.2 65.6 C70.9 71, 75 70.1, 72.1 76.6 C69.2 83.2, 67 100.9, 60 105 C53 109.1, 36.7 106.6, 30 101.3 C23.4 95.9, 22.7 82.3, 20.1 73 C17.4 63.6, 12.2 53.5, 14.3 45.2 C16.5 36.8, 25.4 28.6, 33 22.8 C40.6 16.9, 51.2 9.7, 60 10 Z"
      />

      {/* Embossed inner ring — off-centre from the disc's own (60,60), so it
          reads as a stamped die mark rather than a concentric second circle. */}
      <circle cx="52" cy="66" r="19" fill="none" stroke="var(--ink)" strokeOpacity="0.32" strokeWidth="2" />
      <circle cx="53" cy="65" r="19" fill="none" stroke="#F4E4B8" strokeOpacity="0.3" strokeWidth="1" />

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
