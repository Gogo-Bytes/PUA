import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
const platform = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork: platform.fork } }));
vi.mock('../src/main/process-tree', () => ({ terminateProcessTree: vi.fn().mockResolvedValue(undefined) }));
vi.mock('node:fs/promises', () => ({ stat: () => { throw new Error('No filesystem'); }, open: () => { throw new Error('No filesystem'); } }));
vi.mock('../src/platform/pi/process/environment', () => ({ runtimeEnvironment: () => ({ KEEP: 'Pi-value', PUA_MISSING_ASSISTANT_DIAGNOSTICS: 'next-chat' }), terminalEnvironment: () => ({ KEEP: 'terminal-value', PUA_MISSING_ASSISTANT_DIAGNOSTICS: 'next-chat' }) }));
import { composeMain } from '../src/app/main/composition';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('real registration/fork path binds the first chat, not terminal or first-started chat; failure never rebinds', async () => {
  vi.stubGlobal('process', Object.create(process, { env: { value: { KEEP: 'utility-value', PUA_MISSING_ASSISTANT_DIAGNOSTICS: 'next-chat' } } }));
  vi.spyOn(console, 'info').mockImplementation(() => {});
  const hosts: Array<EventEmitter & { postMessage: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> }> = [];
  const environments: Array<Record<string, string>> = [];
  let failNext = false;
  platform.fork.mockImplementation((_file, _args, options) => {
    environments.push(options.env);
    if (failNext) { failNext = false; throw new Error('fake fork failure'); }
    const host = Object.assign(new EventEmitter(), { postMessage: vi.fn(), kill: vi.fn() }); hosts.push(host); return host;
  });
  let sequence = 0;
  const main = composeMain(() => {}, { createId: () => `session-${++sequence}`, prepareProject: async () => ({ cwd: '/fake', title: 'Fake' }) });
  const runtime = { executable: '/fake/pi', source: '/fake/pi', args: [] };
  const options = { cwd: '/fake', kind: 'chat' as const, startMode: 'new' as const, projectTrust: 'default' as const };
  const terminal = await main.createSession(runtime, { ...options, kind: 'terminal', cols: 80, rows: 24 });
  expect(main.session.start(terminal.id).ok).toBe(true); hosts[0].emit('spawn');
  expect(environments[0]).toEqual({ KEEP: 'utility-value' });
  expect(hosts[0].postMessage.mock.calls[0][0].env).toEqual({ KEEP: 'terminal-value' });
  const terminalClose = main.session.close(terminal.id); hosts[0].emit('exit', 0); expect((await terminalClose).ok).toBe(true);
  const first = await main.createSession(runtime, options);
  const second = await main.createSession(runtime, options);
  expect(main.session.start(second.id).ok).toBe(true); hosts[1].emit('spawn');
  expect(environments[1]).toEqual({ KEEP: 'utility-value' });
  expect(hosts[1].postMessage.mock.calls[0][0].env).toEqual({ KEEP: 'Pi-value' });
  failNext = true;
  expect(main.session.start(first.id).ok).toBe(false);
  expect(environments[2]).toEqual({ KEEP: 'utility-value', PUA_MISSING_ASSISTANT_DIAGNOSTIC_SESSION: first.id });
  expect((await main.session.close(first.id)).ok).toBe(true);
  const third = await main.createSession(runtime, options);
  expect(main.session.start(third.id).ok).toBe(true); expect(environments[3]).toEqual({ KEEP: 'utility-value' });
  const closing = main.session.closeAll(); hosts[1].emit('exit', 0); hosts[2].emit('exit', 0);
  expect((await closing).ok).toBe(true);
});
