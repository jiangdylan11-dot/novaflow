import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// A plain static SPA: no server runtime, no framework adapter, so it deploys
// to any static host (spec 23) rather than binding the product to one vendor.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900
  },
  server: { host: '127.0.0.1', port: 4891, strictPort: true }
});
