import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The app compiles the library from source, so a change in packages/shaping shows up without a separate build.
const lib = (p: string) => fileURLToPath(new URL(`../packages/shaping/src/${p}`, import.meta.url));

// The platform serves the app under a prefix (/shaping/); the deployer passes it as VITE_PUBLIC_BASE.
export default defineConfig({
  base: process.env.VITE_PUBLIC_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^shaping$/, replacement: lib('index.ts') },
      { find: /^shaping\/(export|imaging|animate|fonts)$/, replacement: lib('$1/index.ts') },
    ],
  },
  worker: { format: 'es' },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 2500 },
  optimizeDeps: { exclude: ['manifold-3d'] },
});
