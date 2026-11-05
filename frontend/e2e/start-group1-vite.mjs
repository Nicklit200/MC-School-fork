import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, '../../group1-browser-dist');
// Production bundling also avoids the development optimizer's parent-directory
// lookup in restricted Windows environments. The fixture remains test-only.
await build({
  root, configFile: false, plugins: [react()],
  build: { outDir, emptyOutDir: false, rollupOptions: { input: resolve(root, 'e2e/fixtures/board-pages.html') } },
});
const server = await preview({
  root, configFile: false, build: { outDir },
  preview: { host: '127.0.0.1', port: 4175, strictPort: true },
});
server.printUrls();
