import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Explicit opt-in, test-only server. The production Vite entry never imports this graph.
export default defineConfig({ root: 'tests', cacheDir: '../node_modules/.vite-workspace-preview', plugins: [react(), tailwindcss()], server: { host: '127.0.0.1', port: 4181, strictPort: true } });
