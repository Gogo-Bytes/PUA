import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  root: 'tests/component-preview',
  cacheDir: '../../node_modules/.vite-component-preview',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('../../src/renderer', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 4182, strictPort: true },
  build: { outDir: '../../dist-component-preview', rollupOptions: { input: ['tests/component-preview/index.html', 'tests/component-preview/shadcn.html'] } },
});
