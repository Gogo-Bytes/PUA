import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Explicit opt-in, test-only server. The production Vite entry never imports this graph.
export default defineConfig({ root: 'tests', plugins: [react()], server: { host: '127.0.0.1', port: 4181, strictPort: true } });
