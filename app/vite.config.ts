import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// The app compiles the library from source, so a change in packages/shaping shows up without a separate build.
const lib = (p: string) => fileURLToPath(new URL(`../packages/shaping/src/${p}`, import.meta.url));

/** Stamps the service worker with this build's id, so each build installs a new worker and drops the old caches. */
const stampServiceWorker = (): Plugin => {
  let outDir = 'dist';
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    configResolved: (c) => void (outDir = c.build.outDir),
    closeBundle() {
      const file = `${outDir}/sw.js`;
      writeFileSync(file, readFileSync(file, 'utf8').replace('__BUILD_ID__', Date.now().toString(36)));
    },
  };
};

// The platform serves the app under a prefix (/shaping/); the deployer passes it as VITE_PUBLIC_BASE.
export default defineConfig({
  base: process.env.VITE_PUBLIC_BASE ?? '/',
  plugins: [react(), tailwindcss(), stampServiceWorker()],
  resolve: {
    alias: [
      { find: /^shaping$/, replacement: lib('index.ts') },
      { find: /^shaping\/(export|imaging|animate)$/, replacement: lib('$1/index.ts') },
    ],
  },
  worker: { format: 'es' },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 2500 },
  optimizeDeps: { exclude: ['manifold-3d'] },
});
