// Loads `.env` so integration tests see the same configuration the app does,
// without any test hardcoding secrets. `tests/helpers/*` is test
// infrastructure and is permitted to read `process.env` directly — the
// restriction to `src/lib/env.ts` as the sole reader applies to app code.
import { config } from 'dotenv'

config({ path: '.env' })

process.env.SESSION_SECRET ??= 'test-session-secret-at-least-32-chars'
process.env.APP_URL ??= 'http://localhost:3000'
