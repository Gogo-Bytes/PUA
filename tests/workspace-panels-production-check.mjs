import { build } from 'vite';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Build only the isolated Fake Desktop entry, then exercise it under production CSP.
const output = await mkdtemp(path.join(tmpdir(), 'pua-panels-build-'));
const html = await readFile('src/renderer/index.html', 'utf8');
const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
let server;
try {
  await build({ configFile: 'tests/workspace-preview.config.ts', logLevel: 'error', build: { outDir: output, emptyOutDir: true, rollupOptions: { input: path.resolve('tests/workspace-preview.html') } } });
  server = createServer(async (request, response) => {
    const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '');
    const filename = path.resolve(output, relative);
    if (!filename.startsWith(output + path.sep)) { response.writeHead(403).end(); return; }
    try {
      const data = await readFile(filename);
      response.writeHead(200, { 'Content-Security-Policy': csp, 'Content-Type': filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html' }).end(data);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath, ['tests/workspace-panels-check.mjs'], { stdio: 'inherit', env: { ...process.env, PUA_PREVIEW_URL: `http://127.0.0.1:${server.address().port}` } });
    child.once('exit', resolve);
  });
  if (code !== 0) throw new Error(`Built fixture check failed: ${code}`);
  console.log('PASS production-built isolated UI with unchanged production CSP');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(output, { recursive: true, force: true });
}
