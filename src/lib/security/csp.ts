/**
 * Builds the per-request policy. Scripts are nonce-gated with strict-dynamic
 * so Next's own chunks load without listing hosts. Styles keep 'unsafe-inline'
 * because inline style ATTRIBUTES (marker positions, bar widths, transform
 * origins) are governed by style-src-attr and cannot carry a nonce — Next's
 * nonce guide covers styles too, but blocking style attributes here would
 * break the floorplan (seat marker `left`/`top`, dashboard bar widths, the
 * seal's transform-origin). This is the documented spec §11 shape and an
 * honest tradeoff: scripts get the strict policy, styles do not.
 */
export function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ')
}
