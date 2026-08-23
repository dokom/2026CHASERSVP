import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    setupFiles: ['./tests/helpers/setup-env.ts'],
    // Integration tests share one MongoDB database and reset it in beforeEach.
    // Running files in parallel would let one file's reset wipe another's fixtures
    // mid-test, producing flakes that look like real failures.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/lib/**'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
