import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({ plugins: [react()], resolve: command === 'serve' ? { alias: [
  { find: '@pua/components/styles.css', replacement: decodeURIComponent(new URL('../../packages/components/src/styles.css', import.meta.url).pathname) },
  { find: /^@pua\/components$/, replacement: decodeURIComponent(new URL('../../packages/components/src/index.ts', import.meta.url).pathname) },
] } : undefined }));
