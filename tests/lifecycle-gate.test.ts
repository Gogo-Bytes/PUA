import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';

const scripts: Record<string, string> = JSON.parse(readFileSync('package.json', 'utf8')).scripts;

function expandedSteps(name: string, ancestors: string[] = []): string[] {
  if (ancestors.includes(name)) throw new Error(`recursive npm gate: ${[...ancestors, name].join(' -> ')}`);
  if (!scripts[name]) throw new Error(`missing npm script: ${name}`);
  return scripts[name].split(' && ').flatMap(command => {
    const nested = /^npm run ([\w:-]+)$/.exec(command);
    return nested ? expandedSteps(nested[1], [...ancestors, name]) : [command];
  });
}

test('lifecycle gate: verify and release entries reach both smokes after exactly one build, without recursion', () => {
  for (const name of ['verify', 'package', 'dist', 'test:lifecycle']) {
    const steps = expandedSteps(name);
    expect(
      steps.filter(step => step === 'node scripts/smoke-lifecycle.mjs'),
      name,
    ).toHaveLength(1);
    expect(
      steps.filter(step => step === 'tsc -p tsconfig.main.json'),
      name,
    ).toHaveLength(1);
    expect(steps.indexOf('node scripts/smoke-lifecycle.mjs')).toBeGreaterThan(steps.indexOf('vite build'));
    if (name !== 'test:lifecycle')
      expect(steps.indexOf('node scripts/smoke-ipc.mjs')).toBeLessThan(steps.indexOf('node scripts/smoke-lifecycle.mjs'));
    if (name === 'package' || name === 'dist') {
      expect(scripts[name]).toMatch(/^npm run verify && electron-builder(?: --dir)?$/);
      expect(steps.at(-1)).toMatch(/^electron-builder/);
    }
  }
});

test('lifecycle gate: real npm execution propagates failed substeps and never reaches the fake packager', () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'pua-gate-test-'));
  try {
    mkdirSync(path.join(temporary, 'scripts'));
    const log = path.join(temporary, 'steps.jsonl');
    const probe = `import { appendFileSync } from 'node:fs';\nconst step = process.argv[2];\nappendFileSync(process.env.GATE_LOG, JSON.stringify(step) + '\\n');\nif (process.env.GATE_FAIL === step) process.exit(37);\n`;
    writeFileSync(path.join(temporary, 'probe.mjs'), probe);
    const isolated = { ...scripts };
    // Preserve the actual npm dependency/&& graph. Stub only leaves, never run
    // real typecheck/build/smokes/package operations from this wiring test.
    const leaves = ['check:protected', 'check:boundaries', 'lint', 'format:check', 'typecheck', 'typecheck:tests', 'test', 'build'];
    for (const leaf of leaves) isolated[leaf] = `node probe.mjs ${leaf}`;
    for (const smoke of ['ipc', 'lifecycle'])
      writeFileSync(path.join(temporary, `scripts/smoke-${smoke}.mjs`), `process.argv[2] = '${smoke}'; await import('../probe.mjs');`);
    for (const entry of ['package', 'dist'])
      isolated[entry] = isolated[entry].replace(/electron-builder(?: --dir)?$/, 'node probe.mjs packager');
    writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({ type: 'module', scripts: isolated }));
    const npmExecutable = process.env.npm_execpath ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const npmArgs = process.env.npm_execpath ? [process.env.npm_execpath] : [];
    for (const entry of ['verify', 'package', 'dist']) {
      const failures = entry === 'verify' ? [...leaves, 'ipc', 'lifecycle'] : ['format:check', 'lifecycle'];
      for (const fail of ['', ...failures]) {
        writeFileSync(log, '');
        const result = spawnSync(npmExecutable, [...npmArgs, 'run', entry], {
          cwd: temporary,
          encoding: 'utf8',
          timeout: 15000,
          env: { ...process.env, GATE_LOG: log, GATE_FAIL: fail, npm_config_update_notifier: 'false' },
        });
        const steps: string[] = readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map(line => JSON.parse(line));
        expect(result.error, `${entry}/${fail}: ${result.stderr}`).toBeUndefined();
        if (fail) {
          expect(result.status, `${entry}/${fail}: ${result.stdout}\n${result.stderr}`).not.toBe(0);
          expect(steps.at(-1), `${entry}/${fail}`).toBe(fail);
          expect(steps).not.toContain('packager');
        } else {
          expect(result.status, `${entry}: ${result.stdout}\n${result.stderr}`).toBe(0);
          expect(steps).toEqual([...leaves, 'ipc', 'lifecycle', ...(entry === 'verify' ? [] : ['packager'])]);
        }
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}, 90000);
