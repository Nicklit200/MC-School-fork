import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: 'group1-readiness.spec.mjs',
  timeout: 90000, workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4175', browserName: 'chromium',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined },
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node e2e/start-group1-vite.mjs',
    url: 'http://127.0.0.1:4175/e2e/fixtures/board-pages.html',
    reuseExistingServer: !process.env.CI, timeout: 60000,
  },
});
