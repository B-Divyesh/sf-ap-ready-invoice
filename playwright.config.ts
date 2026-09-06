import { defineConfig, devices } from '@playwright/test';

// Playwright loads this file in the runner and in each worker. Preserve the
// runner's directory so browser tests inspect the same isolated database the
// server is using.
const testDataDir = process.env.AP_READY_TEST_DATA_DIR || `.test-data-playwright-${process.pid}`;
process.env.AP_READY_TEST_DATA_DIR = testDataDir;

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `AP_READY_DATA_DIR=${testDataDir} PORT=4173 STATIC_DIR=frontend/dist cargo run`,
    url: 'http://127.0.0.1:4173/health',
    reuseExistingServer: false,
    timeout: 120_000
  }
});
