import { defineConfig, devices } from '@playwright/test'

// Dedicated database for the E2E suite so it never touches DATABASE_URL
// (the developer's local/dev database). Wiped and re-seeded from scratch
// by tests/e2e/global-setup.ts on every run — see that file for details.
export const DEFAULT_E2E_DATABASE_URL = 'mongodb://127.0.0.1:27018/gala_e2e?replicaSet=rs0'
export const E2E_DATABASE_URL = process.env.DATABASE_URL_E2E ?? DEFAULT_E2E_DATABASE_URL

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: process.env.APP_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run build && npm start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // Playwright merges this over process.env for the spawned command, so
    // the app under test reads the e2e database and never the dev one.
    env: { DATABASE_URL: E2E_DATABASE_URL },
  },
})
