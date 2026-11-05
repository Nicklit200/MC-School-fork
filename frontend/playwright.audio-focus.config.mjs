import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'audio-focus.spec.mjs', workers: 1, timeout: 120000,
  use: { baseURL: 'http://127.0.0.1:4177', browserName: 'chromium',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
      args: ['--autoplay-policy=no-user-gesture-required'] }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node e2e/start-audio-focus-vite.mjs', url: 'http://127.0.0.1:4177/e2e/fixtures/audio-focus.html',
    timeout: 60000, reuseExistingServer: !process.env.CI },
});
