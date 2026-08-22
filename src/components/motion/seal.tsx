/**
 * A wax seal as two SVG paths. The intact disc is visible; the broken shape
 * is a morph target kept in the DOM but hidden, so morphTo() has real
 * geometry to read. Both paths have the same number of points — morphTo
 * needs that to interpolate cleanly.
 */
export function Seal() {
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
      <path
        data-seal-intact
        fill="url(#seal-wax)"
        d="M60 8 C84 6 104 22 110 44 C116 66 108 92 86 106 C64 120 36 114 20 96 C4 78 4 50 18 30 C30 14 44 10 60 8 Z"
      />
      <path
        data-seal-broken
        fill="url(#seal-wax)"
        className="hidden"
        d="M60 8 C84 6 104 22 110 44 C116 66 104 78 86 70 C64 60 52 84 36 96 C20 108 6 92 8 72 C10 52 4 50 18 30 C30 14 44 10 60 8 Z"
      />
      <circle cx="60" cy="60" r="22" fill="none" stroke="var(--ink)" strokeOpacity="0.35" strokeWidth="1.5" />
    </svg>
  )
}
