import { defineConfig, devices } from '@playwright/test';

/**
 * Motion Pro e2e config
 * - baseURL points at the production backend (read-only stub tests by default)
 * - timeout 60s to tolerate Vercel cold starts
 * - workers=1 to avoid Vercel free-tier rate limit pressure
 * - retries=1 to absorb single transient flake
 * - chromium only project
 */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 1,
  workers: 1,
  fullyParallel: false,
  reporter: [
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.MV_BASE_URL || 'https://motionpro.vercel.app',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  outputDir: 'test-results',
});
