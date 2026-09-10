import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OutputFlow } from '../src/main/flow-control';
import { validatePreferences } from '../src/shared/ipc/schemas';
import { defaults, JsonPreferencesStorage } from '../src/platform/filesystem/preferences-storage';
import { expandHome } from '../src/platform/filesystem/expand-home';
import { resolveRuntime } from '../src/platform/pi/runtime/discovery';
import { terminalEnvironment } from '../src/platform/pi/process/environment';
import { modifiedEnter, referencePaths } from '../src/renderer/terminal-keys';
import { removeSession, type SessionWorkspace } from '../src/renderer/features/workspace';
import type { SessionInfo } from '../src/shared/contracts';

describe('terminal transport', () => {
  it('pauses until xterm has consumed the high-water backlog', () => {
    const calls: string[] = [];
    const flow = new OutputFlow(() => calls.push('pause'), () => calls.push('resume'), 100, 20);
    flow.sent(70); flow.sent(40); flow.sent(20);
    expect(calls).toEqual(['pause']);
    flow.acknowledge(NaN); flow.acknowledge(-100); flow.acknowledge(100);
    expect(calls).toEqual(['pause']);
    flow.acknowledge(10);
    expect(calls).toEqual(['pause', 'resume']);
    flow.sent(100);
    expect(calls).toEqual(['pause', 'resume', 'pause']);
  });
  it('encodes modified Enter without changing ordinary shortcuts', () => {
    const base = { key: 'Enter', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
    expect(modifiedEnter(base)).toBeUndefined();
    expect(modifiedEnter({ ...base, shiftKey: true })).toBe('\x1b[13;2u');
    expect(modifiedEnter({ ...base, altKey: true })).toBe('\x1b[13;3u');
    expect(modifiedEnter({ ...base, ctrlKey: true, shiftKey: true })).toBe('\x1b[13;6u');
    expect(modifiedEnter({ ...base, key: 'c', ctrlKey: true })).toBeUndefined();
  });
  it('keeps spaces, quotes and newline filenames inside editor references', () => {
    expect(referencePaths(['/tmp/a b.ts', '/tmp/a"b\nc.ts'])).toBe('@"/tmp/a b.ts" @"/tmp/a\\"b\\nc.ts" ');
    expect(referencePaths([])).toBe('');
  });
});

describe('user-owned Pi runtime', () => {
  it('uses explicit CLI and Node paths with arguments as data, not shell text', () => {
    const fixture = path.resolve('tests/fixtures/mock-pi.mjs');
    const runtime = resolveRuntime({ piPath: fixture, nodePath: process.execPath, args: ['--extension', '/tmp/with spaces;$(noop).ts'] });
    expect(runtime.executable).toBe(process.execPath);
    expect(runtime.args).toEqual([fixture, '--extension', '/tmp/with spaces;$(noop).ts']);
    expect(runtime.args).not.toContain('--approve');
    expect(runtime.args).not.toContain('--no-extensions');
    expect(runtime.args).not.toContain('--tools');
    const env = terminalEnvironment(runtime);
    expect(env.TERM).toBe('xterm-256color');
    expect(env.PATH ?? env.Path).toContain(path.dirname(process.execPath));
  });
  it('reports an absent runtime rather than silently using a different Pi', () => {
    expect(() => resolveRuntime({ piPath: '/definitely/not/pi', nodePath: '', args: [] })).toThrow('未找到 Pi');
  });
  it('expands home but does not interpret shell expressions', () => {
    expect(expandHome('~/project', '/home/test')).toBe('/home/test/project');
    expect(expandHome('$(pwd)')).toBe('$(pwd)');
  });
});

describe('async session closure', () => {
  const initial: SessionWorkspace<SessionInfo> = { sessions: ['A', 'B', 'C'].map(id => ({ id, cwd: '/project', title: id, kind: 'chat', processStatus: 'running', activity: 'idle' })), activeId: 'A' };
  it('reconciles out-of-order close responses without selecting a removed tab', () => {
    const next = removeSession(removeSession(initial, 'B'), 'A');
    expect(next.sessions.map(session => session.id)).toEqual(['C']);
    expect(next.activeId).toBe('C');
    expect(removeSession(removeSession(initial, 'A'), 'B').activeId).toBe('C');
  });
  it('preserves a newer user selection and handles duplicate responses', () => {
    const selected = { ...initial, activeId: 'C' };
    expect(removeSession(selected, 'A').activeId).toBe('C');
    expect(removeSession(removeSession(selected, 'A'), 'A').activeId).toBe('C');
    expect(removeSession(removeSession(removeSession(selected, 'A'), 'B'), 'C').activeId).toBeNull();
  });
});

describe('desktop preferences, separate from Pi config', () => {
  it('validates the IPC boundary and preserves user-selected CLI args', () => {
    expect(() => validatePreferences({ ...defaults, args: '--no-tools' })).toThrow();
    expect(() => validatePreferences({ ...defaults, fontSize: Infinity })).toThrow();
    expect(() => validatePreferences({ ...defaults, piPath: 'pi\0.exe' })).toThrow();
    expect(validatePreferences({ ...defaults, args: ['--tools', 'read,bash'] }).args).toEqual(['--tools', 'read,bash']);
  });
  it('serializes atomic saves and restores defaults only for a missing file', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pi-desktop-test-'));
    const file = path.join(directory, 'settings.json');
    try {
      const store = new JsonPreferencesStorage(file);
      expect(await store.read()).toEqual(defaults);
      await Promise.all([store.write({ ...defaults, fontSize: 16 }), store.write({ ...defaults, fontSize: 18 })]);
      expect((await store.read()).fontSize).toBe(18);
      expect(JSON.parse(await readFile(file, 'utf8'))).not.toHaveProperty('auth');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
