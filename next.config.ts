import type { NextConfig } from 'next'

/**
 * This app renders up to 1000 guests' names, employers, emails, phone
 * numbers, dietary restrictions, and accessibility needs, and its admin
 * pages carry bearer session tokens — hence a full security-header set on
 * every route rather than just the admin surface.
 *
 * No Content-Security-Policy header is set here. Next.js's inline bootstrap
 * scripts require either `'unsafe-inline'` (which defeats most of what a
 * script-src is for) or a per-request nonce threaded through
 * `next.config.ts` -> middleware -> every root layout that renders
 * `<script>`/inline styles. This app has no nonce plumbing yet (see
 * src/middleware.ts, which only issues the CSRF cookie), and shipping a
 * CSP that has not been verified against the real, built pages risks
 * breaking the app in a way that is worse than having no CSP at all. A
 * commented-out starting point is left below for when that work is done —
 * do not uncomment it without wiring a nonce and testing every admin page.
 */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  // camera is `self`, not `()`, because a later phase adds a QR check-in scanner.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
  // {
  //   key: 'Content-Security-Policy',
  //   value: [
  //     "default-src 'self'",
  //     // Requires a per-request nonce (see note above) instead of 'unsafe-inline'
  //     // before this can be enabled: "script-src 'self' 'nonce-{RANDOM}'",
  //     "style-src 'self' 'unsafe-inline'",
  //     "img-src 'self' data:",
  //     "connect-src 'self'",
  //     "frame-src 'none'",
  //     "object-src 'none'",
  //     "base-uri 'self'",
  //   ].join('; '),
  // },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@node-rs/argon2'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
}

export default nextConfig
