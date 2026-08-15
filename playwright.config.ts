import { defineConfig, devices } from '@playwright/test';

// E2E tests only run against a locally-running fast-retro instance — never
// a public deployment. Hitting a public deployment through a proxy/CDN adds
// latency severe enough to make even the golden-path smoke test flaky (fails
// waiting on basic UI interactions that pass instantly against localhost).
// E2E_BASE_URL exists only to point at a different local port (e.g. the
// two-terminal dev loop's Vite server on 5173), not to opt back into testing
// a remote deployment.
//
// Default port is 5199, NOT the app's default PORT (5102) from .env.example.
// On environments that also run a deployed fast-retro instance locally
// (e.g. a supervised production service bound to the app's default port),
// 5102 may not be "local dev" at all — it can be a live, shared deployment.
// Running the suite against it would mutate real board data. Start your
// local test instance on 5199 explicitly (see tests/README.md) so this
// default can never collide with a deployment.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5199';

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 1,
  workers: 1,
  reporter: 'list',
  expect: {
    timeout: 15_000
  },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
