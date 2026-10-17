import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = process.env.VITE_API_TARGET ?? 'http://localhost:8000';

// Dev: Vite on :5173 proxies API calls to the Express server.
// Prod: `vite build` → dist/, served by the Express server itself (same origin, no proxy needed).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/auth': { target: API, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
