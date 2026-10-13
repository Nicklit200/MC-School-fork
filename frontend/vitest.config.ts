import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Kept separate from vite.config.ts so the production build config stays
// untouched by test-only settings.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
    // The unit suite must never depend on a real browser media stack or on
    // external services; anything that needs those belongs in an E2E suite.
    restoreMocks: true,
  },
});
