// Production origin server: Next.js behind TLS on 443.
//
// The certificate in ssl/ is a Cloudflare Origin CA certificate for
// *.chaselab.org, which browsers do not trust directly - Cloudflare's edge
// terminates the public connection and re-encrypts to this origin. So this
// server only ever needs to satisfy Cloudflare (SSL mode "Full (strict)"),
// and there is no HTTP listener here: "Always Use HTTPS" at the edge does
// the redirect, and port 80 on this host belongs to Windows anyway.
//
// Plain Node, not bundled by Next (see node_modules/next/dist/docs/01-app/
// 02-guides/custom-server.md): keep it dependency-free and Node 20+ only.

process.env.NODE_ENV ??= 'production'

import { createServer } from 'node:https'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const PORT = Number(process.env.PORT ?? 443)
const HOSTNAME = process.env.HOSTNAME ?? 'gala2026.chaselab.org'
const SSL_DIR = resolve(process.env.SSL_DIR ?? 'ssl')
const CERT = resolve(SSL_DIR, 'cert.pem')
const KEY = resolve(SSL_DIR, 'key.pem')

for (const file of [CERT, KEY]) {
  if (!existsSync(file)) {
    console.error(`TLS material missing: ${file}. Put the origin certificate and key in ${SSL_DIR}/ (never in git).`)
    process.exit(1)
  }
}
if (!existsSync(resolve('.next/BUILD_ID'))) {
  console.error('No production build found. Run `npm run build` first.')
  process.exit(1)
}

// Imported after NODE_ENV is settled: Next reads it at import time to pick
// production behaviour (and the app's session cookie is `secure` only then).
const { default: next } = await import('next')

const app = next({ dev: false, hostname: HOSTNAME, port: PORT })
const handle = app.getRequestHandler()
await app.prepare()

const server = createServer({ key: readFileSync(KEY), cert: readFileSync(CERT) }, (req, res) => {
  handle(req, res).catch((error) => {
    console.error('Unhandled request error', error)
    if (!res.headersSent) res.statusCode = 500
    res.end()
  })
})

server.listen(PORT, () => {
  console.log(`> Gala origin listening on https://0.0.0.0:${PORT} for ${HOSTNAME} (${process.env.NODE_ENV})`)
})

const shutdown = (signal) => {
  console.log(`> ${signal} received, closing`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
