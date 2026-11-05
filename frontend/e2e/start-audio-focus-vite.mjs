import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, '../../audio-focus-browser-dist');
await build({ root, configFile: false, plugins: [react()], build: {
  outDir, emptyOutDir: false, rollupOptions: { input: resolve(root, 'e2e/fixtures/audio-focus.html') },
} });
await preview({ root, configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 4177, strictPort: true } });
