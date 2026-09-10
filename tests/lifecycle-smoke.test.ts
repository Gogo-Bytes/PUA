import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';

const smokeURL = pathToFileURL(path.resolve('scripts/smoke-lifecycle.mjs')).href;

function runProbe(source: string) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 5000 });
}

test('smoke-lifecycle: a real surviving descendant fails the production cleanup assertion', async () => {
  const child = spawn(process.execPath, ['-e', "console.log('ready'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.once('exit', resolve));
  try {
    await new Promise(resolve => child.stdout.once('data', resolve));
    const result = runProbe(`const { assertStopped } = await import(${JSON.stringify(smokeURL)}); await assertStopped([${child.pid}], 'deliberate leaked descendant', 100);`);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('deliberate leaked descendant: no orphan Pi or descendant');
  } finally {
    child.kill('SIGKILL');
    await exited;
  }
  const result = runProbe(`const { assertStopped } = await import(${JSON.stringify(smokeURL)}); await assertStopped([${child.pid}], 'terminated descendant', 100);`);
  expect(result.status, result.stderr).toBe(0);
});

test.each(['win32', 'linux'])('smoke-lifecycle: unsupported %s is an explicit release blocker, never a silent skip', platform => {
  const result = runProbe(`Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} }); const { main } = await import(${JSON.stringify(smokeURL)}); await main([]);`);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`Lifecycle release gate unsupported on ${platform}`);
  expect(result.stderr).toContain('package/dist blocked');
});
