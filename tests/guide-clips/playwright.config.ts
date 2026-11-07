import { defineConfig, devices } from '@playwright/test';

// The user guide's clips, each a real flow through the app. Run them with
// `make guide-clips`, which starts a scratch instance. See helpers.ts.
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.clip\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: '../../test-results/guide-clips',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5198',
    actionTimeout: 15_000,
    navigationTimeout: 30_000
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
