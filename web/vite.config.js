// web/vite.config.js
// dev: vite на 5173, прокси /api на локальный Fastify на 3000
// build: статика в web/dist/
//
// spec:08-deploy.md#q2 — web/dist/ отдаётся nginx'ом
// spec:06-ui-states.md#q8 — SDK с CDN

import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
      '/webhook': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: false,
  },
});
