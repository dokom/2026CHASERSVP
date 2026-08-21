// Placeholder Vitest setup file, referenced by vitest.config.ts `test.setupFiles`.
// Task 1 only needs this module to exist so the test harness can boot; it must
// stay a no-op here since `src/lib/env.ts` (a later task) is the sole reader of
// `process.env`. A later task (env/config validation) will populate this with
// real test-environment setup (e.g. loading `.env.test` via dotenv).
export {}
