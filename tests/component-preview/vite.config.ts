import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ root: 'tests/component-preview', plugins: [react()], server: { host: '127.0.0.1', port: 4182, strictPort: true }, build: { outDir: '../../dist-component-preview' } });
