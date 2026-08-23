import type { NextConfig } from 'next'

/**
 * This app renders up to 1000 guests' names, employers, emails, phone
 * numbers, dietary restrictions, and accessibility needs, and its admin
 * pages carry bearer session tokens — hence a full security-header set on
 * every route rather than just the admin surface.
 *
 * Content-Security-Policy is NOT set here: it needs a fresh nonce per
 * request, which a static `headers()` entry can't produce. `src/proxy.ts`
 * builds it per-request (via `buildCsp` in `src/lib/security/csp.ts`) and
 * sets it directly on the response.
 */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  // camera is `self`, not `()`, because a later phase adds a QR check-in scanner.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
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
