import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const target = process.env.API_TARGET || 'http://localhost:8080';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true, port: 5173,
    proxy: { '/api': target, '/healthz': target, '/socket.io': { target, ws: true } },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1500 },
});
