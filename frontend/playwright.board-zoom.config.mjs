import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  testMatch: ['board-zoom.spec.mjs', 'board-pages.spec.mjs', 'answers-panel.spec.mjs'],
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:4174', browserName: 'chromium', hasTouch: true,
    viewport: { width: 1000, height: 900 }, trace: 'retain-on-failure', screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174/e2e/fixtures/board-zoom.html',
    reuseExistingServer: !process.env.CI, timeout: 60000,
  },
});
