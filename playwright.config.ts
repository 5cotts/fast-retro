import { defineConfig, devices } from '@playwright/test';

// E2E tests only run against a locally-running fast-retro instance — never
// a public deployment. Hitting a public *.zocomputer.io URL from this
// sandboxed browser adds proxy/CDN latency severe enough to make even the
// golden-path smoke test flaky (fails waiting on basic UI interactions that
// pass instantly against localhost). E2E_BASE_URL exists only to point at a
// different local port (e.g. the two-terminal dev loop's Vite server on
// 5173), not to opt back into testing a remote deployment.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5102';

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
