import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';

const fixture = path.resolve('tests/fixtures/lifecycle-pi.mjs');
interface RecordRow { pid?: number; descendant?: number; detached?: boolean; event?: string }
const readRecords = async (log: string): Promise<RecordRow[]> => (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
interface FixtureContext {
  child: ChildProcessWithoutNullStreams;
  log: string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  stderr: () => string;
}

async function withFixture(env: NodeJS.ProcessEnv, check: (context: FixtureContext) => Promise<void>) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'pua-fixture-test-'));
  const log = path.join(temporary, 'pids.jsonl');
  const child = spawn(process.execPath, [fixture], {
    env: { ...process.env, PUA_LIFECYCLE_LOG: log, PUA_LIFECYCLE_CASE: 'handshake', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited: FixtureContext['exited'] = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  try {
    await check({ child, log, exited, stderr: () => stderr });
  } finally {
    // Only PIDs recorded by this isolated fixture, including not-yet-ready children.
    let records: RecordRow[] = [];
    const deadline = Date.now() + 1000;
    do {
      records = await readRecords(log).catch(() => []);
      if (records.length === 3 || child.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    const events = await readRecords(`${log}.events`).catch(() => []);
    for (const pid of new Set([child.pid, ...records.map(row => row.pid ?? row.descendant), ...events.filter(row => row.event === 'spawn').map(row => row.pid)])) {
      if (pid) try { process.kill(pid, 'SIGKILL'); } catch {}
    }
    await exited;
    await rm(temporary, { recursive: true, force: true });
  }
}

test('lifecycle-pi: incompatible handshake waits for both descendant readiness acknowledgements', async () => {
  await withFixture({ PUA_LIFECYCLE_READY_DELAY_MS: '600' }, async ({ child, log }) => {
    const response = new Promise(resolve => child.stdout.once('data', resolve));
    for (const type of ['get_state', 'get_messages', 'get_commands']) child.stdin.write(`${JSON.stringify({ id: type, type })}\n`);
    await response;
    const records = await readRecords(log);
    expect(records, 'Pi and both descendant fixtures started before an incompatible response').toHaveLength(3);
    expect(new Set(records.map(row => row.pid ?? row.descendant)).size).toBe(3);
    expect(records.slice(1).map(row => row.detached).sort()).toEqual([false, true]);
    const events = await readRecords(`${log}.events`);
    expect(events.filter(row => row.event === 'ready')).toHaveLength(2);
    expect(events.findIndex(row => row.event === 'response')).toBeGreaterThan(events.findLastIndex(row => row.event === 'ready'));
  });
}, 10000);

test('lifecycle-pi: missing descendant readiness is an explicit failure, not a handshake pass', async () => {
  await withFixture({ PUA_LIFECYCLE_FAULT: 'missing-ready' }, async ({ child, exited, stderr }) => {
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stdin.write(`${JSON.stringify({ id: 'state', type: 'get_state' })}\n`);
    expect((await exited).code).toBe(1);
    expect(stderr()).toContain('descendant readiness deadline');
    expect(output).toBe('');
  });
}, 10000);
