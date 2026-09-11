import { defineConfig } from 'vite';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// tsc retains outputs of moved and deleted sources. The legacy main output tree is fully retired.
export function removeRetiredMainOutputs(): void {
  rmSync(fileURLToPath(new URL('./dist/main/', import.meta.url)), { recursive: true, force: true });
}

// Sandbox preload can require Electron, but not arbitrary local CommonJS modules.
export default defineConfig({
  plugins: [{ name: 'retire-main-outputs', buildStart: removeRetiredMainOutputs }],
  esbuild: { include: /\.[cm]?tsx?$/, loader: 'ts' },
  build: {
    outDir: 'dist/app/preload',
    emptyOutDir: false,
    lib: { entry: 'src/app/preload/desktop-api.cts', formats: ['cjs'], fileName: () => 'preload.cjs' },
    rollupOptions: { external: ['electron'], output: { inlineDynamicImports: true } },
  },
});
