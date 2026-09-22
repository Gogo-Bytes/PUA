import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  resolve: { alias: { '@': fileURLToPath(new URL('./src/renderer', import.meta.url)) } },
  plugins: [react(), tailwindcss()],
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
});
