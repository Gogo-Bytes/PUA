import { defineConfig } from 'vite';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// tsc retains outputs of deleted sources. Retire only the explicit removed sources, not other build files.
export function removeRetiredMainOutputs(): void {
  for (const filename of ['sessions.js', 'sessions.js.map', 'extension-dialogs.js', 'extension-dialogs.js.map', 'main.js', 'main.js.map', 'ipc.js', 'ipc.js.map', 'git.js', 'git.js.map', 'preferences.js', 'preferences.js.map', 'runtime.js', 'runtime.js.map', 'project-resources.js', 'project-resources.js.map', 'session-preparation.js', 'session-preparation.js.map']) {
    rmSync(fileURLToPath(new URL(`./dist/main/${filename}`, import.meta.url)), { force: true });
  }
}

// Sandbox preload can require Electron, but not arbitrary local CommonJS modules.
export default defineConfig({
  plugins: [{ name: 'retire-main-outputs', buildStart: removeRetiredMainOutputs }],
  esbuild: { include: /\.[cm]?tsx?$/, loader: 'ts' },
  build: {
    outDir: 'dist/main',
    emptyOutDir: false,
    lib: { entry: 'src/main/preload.cts', formats: ['cjs'], fileName: () => 'preload.cjs' },
    rollupOptions: { external: ['electron'], output: { inlineDynamicImports: true } },
  },
});
