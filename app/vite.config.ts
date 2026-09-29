import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The platform serves the app under a prefix (/shaping/); the deployer passes it as VITE_PUBLIC_BASE.
export default defineConfig({
  base: process.env.VITE_PUBLIC_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 2500 },
  optimizeDeps: { exclude: ['manifold-3d'] },
});
