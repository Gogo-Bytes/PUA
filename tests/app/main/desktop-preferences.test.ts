import { PreferencesApplication } from '../../../src/modules/preferences/index';
import { describe, expect, it, vi } from 'vitest';
import { createDesktopPreferences, validateChatArguments } from '../../../src/app/main/desktop-preferences';
import type { Preferences, SessionInfo } from '../../../src/shared/ipc/desktop-api';
import { deferred, failure, fakeCapabilities, sessionInfo, success } from './main-fakes';
import type { NativePiSessionIdentity } from '../../../src/shared/ipc/pi-session';

const options = { cwd: '/fake/project', kind: 'chat', startMode: 'new', projectTrust: 'default' } as const;
const initial = (): Preferences => ({ piPath: '', nodePath: '', args: ['--fake'], fontSize: 14, recentProjects: ['/old'] });
function harness() {
  const store = { write: vi.fn<(value: Preferences) => Promise<void>>().mockResolvedValue(undefined) };
  const runtime = { executable: '/fake/pi', args: [], source: '/fake/pi' };
  const resolveRuntime = vi.fn(() => runtime); const validateChatArguments = vi.fn();
  const preferences = createDesktopPreferences({ application: new PreferencesApplication(initial(), store), resolveRuntime, validateChatArguments, home: '/fake/home', platform: 'fake' });
  return { preferences, store, resolveRuntime, validateChatArguments, runtime, capabilities: fakeCapabilities() };
}
describe('desktop preferences workflow with real PreferencesApplication and Fake runtime/storage/Session', () => {
  it('indexes a chat only after Pi accepts its first message, while preserving --no-session as ephemeral', async () => {
    const store = { read: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), rename: vi.fn().mockResolvedValue(undefined) };
    const runtime = { executable: '/fake/pi', args: [], source: '/fake/pi' };
    const preferences = createDesktopPreferences({ application: new PreferencesApplication(initial(), { write: vi.fn().mockResolvedValue(undefined) }), resolveRuntime: () => runtime, validateChatArguments: vi.fn(), home: '/fake', platform: 'fake', sessionStore: store });
    const capabilities = fakeCapabilities();
    await preferences.createSession(options, capabilities);
    expect(store.upsert).not.toHaveBeenCalled();
    const identity: NativePiSessionIdentity = { sessionId: 'pi-1', sessionFile: '/home/pi/session.jsonl' };
    await preferences.recordChatMessage('id', identity);
    expect(store.upsert).toHaveBeenCalledWith({ id: 'id', cwd: '/fake/project', title: 'project', piSessionId: 'pi-1', sessionFile: '/home/pi/session.jsonl' });
    await preferences.updateChatIdentity('id', { sessionId: 'pi-fork', sessionFile: '/home/pi/fork.jsonl' });
    expect(store.upsert).toHaveBeenLastCalledWith({ id: 'id', cwd: '/fake/project', title: 'project', piSessionId: 'pi-fork', sessionFile: '/home/pi/fork.jsonl' });

    const ephemeral = createDesktopPreferences({ application: new PreferencesApplication(initial(), { write: vi.fn().mockResolvedValue(undefined) }), resolveRuntime: () => ({ ...runtime, args: ['--no-session'] }), validateChatArguments: vi.fn(), home: '/fake', platform: 'fake', sessionStore: store });
    await ephemeral.createSession(options, capabilities);
    await ephemeral.recordChatMessage('id', identity);
    expect(store.upsert).toHaveBeenCalledTimes(2);
  });
  it('publishes and resolves bootstrap in the write continuation, preserving returned references', async () => {
    const h = harness(); const write = deferred<void>(); const trace: string[] = [];
    h.store.write.mockReturnValueOnce(write.promise); h.resolveRuntime.mockImplementation(() => { trace.push('runtime'); return h.runtime; });
    const next = { ...initial(), fontSize: 18 }; const pending = h.preferences.savePreferences(next);
    const observer = write.promise.then(() => { trace.push('write observer'); });
    next.args.push('late'); write.resolve(); const result = await pending; await observer;
    expect(trace).toEqual(['runtime', 'write observer']); expect(result.preferences).toBe(next);
    result.preferences.fontSize = 20; expect(h.preferences.getBootstrap().preferences.fontSize).toBe(20);
  });
  it('runtime or create failure never writes recents or closes a non-created Session', async () => {
    const h = harness(); const runtimeError = new Error('runtime'); h.resolveRuntime.mockImplementationOnce(() => { throw runtimeError; });
    await expect(h.preferences.createSession(options, h.capabilities)).rejects.toBe(runtimeError);
    expect(h.validateChatArguments).toHaveBeenCalledOnce(); expect(h.capabilities.createSession).not.toHaveBeenCalled();
    const createError = new Error('create'); h.capabilities.createSession.mockRejectedValueOnce(createError);
    await expect(h.preferences.createSession(options, h.capabilities)).rejects.toBe(createError);
    expect(h.store.write).not.toHaveBeenCalled(); expect(h.capabilities.session.close).not.toHaveBeenCalled();
  });
  it('synchronous storage validation failure immediately initiates original Session compensation', async () => {
    const h = harness(); const error = new Error('invalid settings'); const trace: string[] = [];
    h.store.write.mockImplementation(() => { trace.push('write'); throw error; });
    h.capabilities.session.close.mockImplementation(async () => { trace.push('close'); return success; });
    await expect(h.preferences.createSession(options, h.capabilities)).rejects.toBe(error);
    expect(trace).toEqual(['write', 'close']); expect(h.preferences.getBootstrap().preferences.recentProjects).toEqual(['/old']);
  });
  it('bootstrap reports runtime failure without throwing or writing', () => {
    const h = harness(); h.resolveRuntime.mockImplementation(() => { throw new Error('not installed'); });
    expect(h.preferences.getBootstrap()).toEqual({ preferences: initial(), home: '/fake/home', platform: 'fake', runtime: null, runtimeError: 'not installed' }); expect(h.store.write).not.toHaveBeenCalled();
  });
  it('server owns recentProjects, publishes only after write, and does not publish failed settings', async () => {
    const h = harness(); const write = deferred<void>(); h.store.write.mockReturnValueOnce(write.promise);
    const next = { ...initial(), fontSize: 18, recentProjects: ['/client'] }; const save = h.preferences.savePreferences(next);
    expect(h.store.write).toHaveBeenCalledWith({ ...next, recentProjects: ['/old'] }); expect(h.preferences.getBootstrap().preferences.fontSize).toBe(14);
    write.resolve(); await save; expect(h.preferences.getBootstrap().preferences.fontSize).toBe(18);
    h.store.write.mockRejectedValueOnce(new Error('write')); await expect(h.preferences.savePreferences({ ...initial(), fontSize: 20 })).rejects.toThrow('write'); expect(h.preferences.getBootstrap().preferences.fontSize).toBe(18);
  });
  it('validates chat args before runtime resolution or create; terminal retains arbitrary args', async () => {
    const h = harness(); h.validateChatArguments.mockImplementation(() => { throw new Error('invalid chat args'); });
    await expect(h.preferences.createSession(options, h.capabilities)).rejects.toThrow('invalid chat args'); expect(h.resolveRuntime).not.toHaveBeenCalled(); expect(h.capabilities.createSession).not.toHaveBeenCalled();
    await h.preferences.createSession({ ...options, kind: 'terminal', cols: 80, rows: 24 }, h.capabilities);
    expect(h.validateChatArguments).toHaveBeenCalledOnce(); expect(h.capabilities.createSession).toHaveBeenCalledWith(h.runtime, expect.objectContaining({ kind: 'terminal' }));
  });
  it('chat validate → resolve → create → write order and recent dedup/20 use preferences current at completion', async () => {
    const h = harness(); const order: string[] = []; const create = deferred<SessionInfo>();
    h.validateChatArguments.mockImplementation(() => { order.push('validate'); }); h.resolveRuntime.mockImplementation(() => { order.push('resolve'); return h.runtime; });
    h.capabilities.createSession.mockImplementation(() => { order.push('create'); return create.promise; }); h.store.write.mockImplementation(async () => { order.push('write'); });
    const pending = h.preferences.createSession(options, h.capabilities); expect(order).toEqual(['validate', 'resolve', 'create']);
    await h.preferences.savePreferences({ ...initial(), fontSize: 20 }); create.resolve(sessionInfo); await pending;
    expect(h.preferences.getBootstrap().preferences).toMatchObject({ fontSize: 20, recentProjects: ['/fake/project', '/old'] });
    await h.preferences.createSession(options, { ...h.capabilities, createSession: vi.fn().mockResolvedValue(sessionInfo) });
    expect(h.preferences.getBootstrap().preferences.recentProjects).toEqual(['/fake/project', '/old']);
    const seed = { ...initial(), recentProjects: Array.from({ length: 25 }, (_, i) => `/p${i}`) };
    const preferences = createDesktopPreferences({ application: new PreferencesApplication(seed, h.store), resolveRuntime: h.resolveRuntime, validateChatArguments: h.validateChatArguments, home: '/fake', platform: 'fake' });
    await preferences.createSession(options, { ...h.capabilities, createSession: vi.fn().mockResolvedValue(sessionInfo) }); expect(preferences.getBootstrap().preferences.recentProjects).toHaveLength(20);
  });
  it.each(['success', 'false', 'reject'] as const)('write failure waits for %s cleanup, which has error priority and never publishes recent', async mode => {
    const h = harness(); const writeError = new Error('write denied'); const cleanup = deferred<Awaited<ReturnType<typeof h.capabilities.session.close>>>();
    const closeEntered = deferred<void>();
    h.store.write.mockRejectedValue(writeError); h.capabilities.session.close.mockImplementation(() => { closeEntered.resolve(); return cleanup.promise; });
    const pending = h.preferences.createSession(options, h.capabilities); const assertion = expect(pending).rejects.toThrow(mode === 'success' ? 'write denied' : 'cleanup');
    let completed = false; void pending.then(() => { completed = true; }, () => { completed = true; });
    await closeEntered.promise; expect(h.capabilities.session.close).toHaveBeenCalledExactlyOnceWith('id'); expect(completed).toBe(false);
    if (mode === 'reject') cleanup.reject(new Error('cleanup rejected')); else cleanup.resolve(mode === 'success' ? success : failure);
    await assertion; expect(h.preferences.getBootstrap().preferences.recentProjects).toEqual(['/old']);
  });
});


describe('Chat creation edge argument ownership', () => {
  it.each(['--', '--mode', '--print', '-p', '--session', '--session-id', '--fork', '--continue', '-c', '--resume', '-r', '--approve', '-a', '--no-approve', '-na', '--mode=rpc', '--session=x', '--session-id=x', '--fork=x'])('rejects %s synchronously with unchanged first-conflict text', flag => {
    expect(() => validateChatArguments(['--model', 'fake', flag, '--mode'])).toThrow(`聊天模式不能使用附加参数 ${flag}。请通过桌面会话与信任选项控制；兼容终端仍可使用原生参数。`);
  });
  it.each(['--continue=x', '--resume=x', '--approve=x', '--no-session', '--Mode', '--model', ';', '--extension=x'])('does not invent ownership for %s', flag => {
    expect(() => validateChatArguments([flag])).not.toThrow();
  });
  it('real validator rejects before synchronous resolve/create, while terminal skips it', async () => {
    const h = harness(); const seed = { ...initial(), args: ['--mode=rpc'] };
    const preferences = createDesktopPreferences({ application: new PreferencesApplication(seed, h.store), resolveRuntime: h.resolveRuntime, validateChatArguments, home: '/fake', platform: 'fake' });
    const pending = preferences.createSession(options, h.capabilities);
    expect(h.resolveRuntime).not.toHaveBeenCalled(); expect(h.capabilities.createSession).not.toHaveBeenCalled();
    await expect(pending).rejects.toThrow('附加参数 --mode=rpc');
    await preferences.createSession({ ...options, kind: 'terminal', cols: 80, rows: 24 }, h.capabilities);
    expect(h.resolveRuntime).toHaveBeenCalledOnce(); expect(h.capabilities.createSession).toHaveBeenCalledOnce();
  });
});
