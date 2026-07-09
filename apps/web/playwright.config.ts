import { defineConfig, devices } from '@playwright/test'

const PORT = 3210
const BASE_URL = `http://localhost:${PORT}`

// e2e config. Boots the Next dev server on a dedicated port and runs the
// accessibility suite against it. Kept single-worker so the shared mock
// data-layer state (localStorage) stays deterministic across specs.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
})
