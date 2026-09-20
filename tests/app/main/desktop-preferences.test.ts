import { PreferencesApplication } from '../../../src/modules/preferences/index';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createDesktopPreferences, validateChatArguments } from '../../../src/app/main/desktop-preferences';
import type { Preferences, SessionInfo } from '../../../src/shared/ipc/desktop-api';
import { deferred, failure, fakeCapabilities, sessionInfo, snapshot, success } from './main-fakes';
import type { NativePiSessionIdentity } from '../../../src/shared/ipc/pi-session';
import { JsonWorkspaceSessionStore } from '../../../src/app/main/workspace-session-store';

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
    const store = { read: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), archive: vi.fn().mockResolvedValue(undefined), setPinned: vi.fn().mockResolvedValue(undefined), rename: vi.fn().mockResolvedValue(undefined) };
    const runtime = { executable: '/fake/pi', args: [], source: '/fake/pi' };
    const preferences = createDesktopPreferences({ application: new PreferencesApplication(initial(), { write: vi.fn().mockResolvedValue(undefined) }), resolveRuntime: () => runtime, validateChatArguments: vi.fn(), home: '/fake', platform: 'fake', sessionStore: store });
    const capabilities = fakeCapabilities();
    await preferences.createSession(options, capabilities);
    expect(store.upsert).not.toHaveBeenCalled();
    const identity: NativePiSessionIdentity = { sessionId: 'pi-1', sessionFile: '/home/pi/session.jsonl' };
    await preferences.recordChatMessage('id', identity);
    expect(store.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'id', cwd: '/fake/project', title: 'project', piSessionId: 'pi-1', sessionFile: '/home/pi/session.jsonl', archived: false, pinned: false }));
    await preferences.updateChatIdentity('id', { sessionId: 'pi-fork', sessionFile: '/home/pi/fork.jsonl' });
    expect(store.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'id', cwd: '/fake/project', title: 'project', piSessionId: 'pi-fork', sessionFile: '/home/pi/fork.jsonl', archived: false, pinned: false }));

    const ephemeral = createDesktopPreferences({ application: new PreferencesApplication(initial(), { write: vi.fn().mockResolvedValue(undefined) }), resolveRuntime: () => ({ ...runtime, args: ['--no-session'] }), validateChatArguments: vi.fn(), home: '/fake', platform: 'fake', sessionStore: store });
    await ephemeral.createSession(options, capabilities);
    await ephemeral.recordChatMessage('id', identity);
    expect(store.upsert).toHaveBeenCalledTimes(2);
  });
  it('creates a durable Pi-native clone as a distinct task without duplicating an empty source', async () => {
    const store = { read: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), archive: vi.fn().mockResolvedValue(undefined), setPinned: vi.fn().mockResolvedValue(undefined), rename: vi.fn().mockResolvedValue(undefined) };
    const runtime = { executable: '/fake/pi', args: [], source: '/fake/pi' };
    const preferences = createDesktopPreferences({ application: new PreferencesApplication(initial(), { write: vi.fn().mockResolvedValue(undefined) }), resolveRuntime: () => runtime, validateChatArguments: vi.fn(), home: '/fake', platform: 'fake', sessionStore: store });
    const capabilities = fakeCapabilities();
    const clone = (capabilities.conversation as unknown as { clone: ReturnType<typeof vi.fn> }).clone;
    const restored = await preferences.cloneSession('id', capabilities);
    expect(clone).toHaveBeenCalledWith(expect.any(String));
    expect(capabilities.session.start).toHaveBeenCalledTimes(1);
    expect(capabilities.session.close).toHaveBeenCalledWith(expect.any(String));
    expect(restored).toEqual(expect.objectContaining({ kind: 'chat', title: 'project · 副本', archived: false, pinned: false }));
    expect(store.upsert).toHaveBeenCalledWith(expect.objectContaining({ title: 'project · 副本', piSessionId: 'pi-clone', sessionFile: '/fake/pi-clone.jsonl', archived: false, pinned: false }));
    expect(preferences.getBootstrap().restoredSessions).toEqual([expect.objectContaining({ id: restored.id, title: 'project · 副本' })]);
  });
  it('archives by default, restores from Pi identity, pins metadata, and permanently deletes only after Pi cleanup succeeds', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pua-preferences-'));
    try {
      const sessionFile = path.join(directory, 'pi-session.jsonl');
      await writeFile(sessionFile, [
        JSON.stringify({ type: 'session', id: 'pi-1', cwd: '/fake/project' }),
        JSON.stringify({ type: 'message', id: 'entry-1', timestamp: '2026-09-18T10:00:00.000Z', message: { role: 'user', content: '检查归档搜索' } }),
      ].join('\n'));
      const store = new JsonWorkspaceSessionStore(path.join(directory, 'workspace-sessions.json'));
      const runtime = { executable: '/fake/pi', args: [], source: '/fake/pi' };
      const preferences = createDesktopPreferences({ application: new PreferencesApplication(initial(), { write: vi.fn().mockResolvedValue(undefined) }), resolveRuntime: () => runtime, validateChatArguments: vi.fn(), home: '/fake', platform: 'fake', sessionStore: store });
      const capabilities = fakeCapabilities();
      await preferences.createSession(options, capabilities);
      await preferences.recordChatMessage('id', { sessionId: 'pi-1', sessionFile });
      await expect(preferences.searchHistory({ query: '归档' })).resolves.toEqual([expect.objectContaining({ taskId: 'id', entryId: 'entry-1', query: '归档', archived: false })]);
      await preferences.setSessionPinned('id', true);
      const restored = { ...sessionInfo, processStatus: 'exited' as const, activity: 'idle' as const };
      await preferences.restoreSessions({ restoreChatSession: vi.fn().mockResolvedValue(restored), session: { close: capabilities.session.close } });
      await preferences.archiveSession('id');
      expect(preferences.getBootstrap().restoredSessions).toBeUndefined();
      expect(preferences.getBootstrap().archivedSessions).toEqual([expect.objectContaining({ id: 'id', archived: true, pinned: true })]);
      const next = await preferences.restoreArchivedSession('id');
      expect(next).toEqual(expect.objectContaining({ id: 'id', archived: false, pinned: true }));
      await preferences.archiveSession('id');
      await preferences.deleteArchivedSession('id');
      expect(preferences.getBootstrap().archivedSessions).toBeUndefined();
      await expect(store.read()).resolves.toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('waits for first-message indexing before archiving the just-closed task', async () => {
    const persisted = deferred<void>();
    const store = { read: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockReturnValue(persisted.promise), remove: vi.fn().mockResolvedValue(undefined), archive: vi.fn().mockResolvedValue(undefined), setPinned: vi.fn().mockResolvedValue(undefined), rename: vi.fn().mockResolvedValue(undefined) };
    const runtime = { executable: '/fake/pi', args: [], source: '/fake/pi' };
    const preferences = createDesktopPreferences({ application: new PreferencesApplication(initial(), { write: vi.fn().mockResolvedValue(undefined) }), resolveRuntime: () => runtime, validateChatArguments: vi.fn(), home: '/fake', platform: 'fake', sessionStore: store });
    await preferences.createSession(options, fakeCapabilities());
    const indexing = preferences.recordChatMessage('id', { sessionId: 'pi-1', sessionFile: '/home/pi/session.jsonl' });
    const archiving = preferences.archiveSession('id');
    await Promise.resolve(); expect(store.archive).not.toHaveBeenCalled();
    persisted.resolve(); await indexing; await archiving;
    expect(store.archive).toHaveBeenCalledExactlyOnceWith('id', true);
    expect(preferences.getBootstrap().archivedSessions).toEqual([expect.objectContaining({ id: 'id', archived: true })]);
  });

  it('retries first-message indexing in the background without requiring a second prompt', async () => {
    vi.useFakeTimers();
    try {
      const store = { read: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), archive: vi.fn().mockResolvedValue(undefined), setPinned: vi.fn().mockResolvedValue(undefined), rename: vi.fn().mockResolvedValue(undefined) };
      const runtime = { executable: '/fake/pi', args: [], source: '/fake/pi' };
      const preferences = createDesktopPreferences({ application: new PreferencesApplication(initial(), { write: vi.fn().mockResolvedValue(undefined) }), resolveRuntime: () => runtime, validateChatArguments: vi.fn(), home: '/fake', platform: 'fake', sessionStore: store });
      await preferences.createSession(options, fakeCapabilities());
      await expect(preferences.recordChatMessage('id', { sessionId: 'pi-1', sessionFile: '/home/pi/session.jsonl' })).rejects.toThrow('temporary');
      await vi.advanceTimersByTimeAsync(1_000);
      expect(store.upsert).toHaveBeenCalledTimes(2);
      await preferences.archiveSession('id');
      expect(store.archive).toHaveBeenCalledWith('id', true);
    } finally { vi.useRealTimers(); }
  });
  it('bounds persistent first-message indexing failures with exponential background retries', async () => {
    vi.useFakeTimers();
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const store = { read: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockRejectedValue(new Error('disk offline')), remove: vi.fn().mockResolvedValue(undefined), archive: vi.fn().mockResolvedValue(undefined), setPinned: vi.fn().mockResolvedValue(undefined), rename: vi.fn().mockResolvedValue(undefined) };
      const preferences = createDesktopPreferences({ application: new PreferencesApplication(initial(), { write: vi.fn().mockResolvedValue(undefined) }), resolveRuntime: () => ({ executable: '/fake/pi', args: [], source: '/fake/pi' }), validateChatArguments: vi.fn(), home: '/fake', platform: 'fake', sessionStore: store });
      await preferences.createSession(options, fakeCapabilities());
      await expect(preferences.recordChatMessage('id', { sessionId: 'pi-1', sessionFile: '/home/pi/session.jsonl' })).rejects.toThrow('disk offline');
      await vi.runAllTimersAsync();
      expect(store.upsert).toHaveBeenCalledTimes(9);
      expect(vi.getTimerCount()).toBe(0);
      expect(report).toHaveBeenCalledWith(expect.stringContaining('连续 8 次'));
    } finally { report.mockRestore(); vi.useRealTimers(); }
  });
  it('serializes overlapping accepted-message indexing without a stale completion deleting the newest record', async () => {
    const first = deferred<void>(); const second = deferred<void>();
    const store = { read: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise), remove: vi.fn().mockResolvedValue(undefined), archive: vi.fn().mockResolvedValue(undefined), setPinned: vi.fn().mockResolvedValue(undefined), rename: vi.fn().mockResolvedValue(undefined) };
    const runtime = { executable: '/fake/pi', args: [], source: '/fake/pi' };
    const preferences = createDesktopPreferences({ application: new PreferencesApplication(initial(), { write: vi.fn().mockResolvedValue(undefined) }), resolveRuntime: () => runtime, validateChatArguments: vi.fn(), home: '/fake', platform: 'fake', sessionStore: store });
    await preferences.createSession(options, fakeCapabilities());
    const older = preferences.recordChatMessage('id', { sessionId: 'pi-1', sessionFile: '/home/pi/one.jsonl' });
    const newer = preferences.recordChatMessage('id', { sessionId: 'pi-2', sessionFile: '/home/pi/two.jsonl' });
    await Promise.resolve();
    expect(store.upsert).toHaveBeenCalledTimes(1);
    first.resolve(); await older; await Promise.resolve();
    expect(store.upsert).toHaveBeenCalledTimes(2);
    expect(store.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ piSessionId: 'pi-2', sessionFile: '/home/pi/two.jsonl' }));
    second.resolve(); await newer;
    expect(store.remove).not.toHaveBeenCalled();
    await preferences.archiveSession('id');
    expect(store.archive).toHaveBeenCalledExactlyOnceWith('id', true);
  });

  it('serializes activity, pin, and automatic title writes without restoring stale metadata', async () => {
    const activity = deferred<void>();
    const store = { read: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), archive: vi.fn().mockResolvedValue(undefined), setPinned: vi.fn().mockResolvedValue(undefined), rename: vi.fn().mockResolvedValue(undefined) };
    const runtime = { executable: '/fake/pi', args: [], source: '/fake/pi' };
    const preferences = createDesktopPreferences({ application: new PreferencesApplication(initial(), { write: vi.fn().mockResolvedValue(undefined) }), resolveRuntime: () => runtime, validateChatArguments: vi.fn(), home: '/fake', platform: 'fake', sessionStore: store });
    await preferences.createSession(options, fakeCapabilities());
    await preferences.recordChatMessage('id', { sessionId: 'pi-1', sessionFile: '/home/pi/one.jsonl' });
    store.upsert.mockReturnValueOnce(activity.promise);
    const recording = preferences.recordChatMessage('id', { sessionId: 'pi-2', sessionFile: '/home/pi/two.jsonl' });
    const pinning = preferences.setSessionPinned('id', true);
    preferences.syncSession({ ...snapshot, id: 'id', title: 'renamed', kind: 'chat' });
    await Promise.resolve();
    expect(store.setPinned).not.toHaveBeenCalled();
    expect(store.rename).not.toHaveBeenCalled();
    activity.resolve(); await recording; await pinning;
    await vi.waitFor(() => expect(store.rename).toHaveBeenCalledWith('id', 'renamed'));
    await preferences.recordChatMessage('id', { sessionId: 'pi-3', sessionFile: '/home/pi/three.jsonl' });
    expect(store.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'renamed', pinned: true, piSessionId: 'pi-3' }));
  });

  it('revalidates a dormant Pi session file immediately before start', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pua-start-verify-'));
    try {
      const sessionFile = path.join(directory, 'session.jsonl');
      await writeFile(sessionFile, `${JSON.stringify({ type: 'session', id: 'pi-1', cwd: '/fake/project' })}\n`);
      const record = { id: 'dormant', cwd: '/fake/project', title: 'Dormant', piSessionId: 'pi-1', sessionFile, archived: false, pinned: false, lastActivityAt: 1 };
      const store = { read: vi.fn().mockResolvedValue([record]), upsert: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), archive: vi.fn().mockResolvedValue(undefined), setPinned: vi.fn().mockResolvedValue(undefined), rename: vi.fn().mockResolvedValue(undefined) };
      const preferences = createDesktopPreferences({ application: new PreferencesApplication(initial(), { write: vi.fn().mockResolvedValue(undefined) }), resolveRuntime: () => ({ executable: '/fake/pi', args: [], source: '/fake/pi' }), validateChatArguments: vi.fn(), home: '/fake', platform: 'fake', sessionStore: store });
      await preferences.restoreSessions(fakeCapabilities() as never);
      await writeFile(sessionFile, `${JSON.stringify({ type: 'session', id: 'replaced', cwd: '/fake/project' })}\n`);
      await expect(preferences.verifySessionForStart('dormant')).rejects.toThrow('任务索引不匹配');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('closes a restored dormant resource when unarchive metadata cannot commit', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pua-restore-'));
    try {
      const sessionFile = path.join(directory, 'session.jsonl');
      await writeFile(sessionFile, `${JSON.stringify({ type: 'session', id: 'pi-1', cwd: '/fake/project' })}\n`);
      const record = { id: 'archived', cwd: '/fake/project', title: '已归档', piSessionId: 'pi-1', sessionFile, archived: true, pinned: false, lastActivityAt: 1 };
      const store = { read: vi.fn().mockResolvedValue([record]), upsert: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), archive: vi.fn().mockRejectedValue(new Error('index denied')), setPinned: vi.fn().mockResolvedValue(undefined), rename: vi.fn().mockResolvedValue(undefined) };
      const runtime = { executable: '/fake/pi', args: [], source: '/fake/pi' };
      const preferences = createDesktopPreferences({ application: new PreferencesApplication(initial(), { write: vi.fn().mockResolvedValue(undefined) }), resolveRuntime: () => runtime, validateChatArguments: vi.fn(), home: '/fake', platform: 'fake', sessionStore: store });
      const capabilities = fakeCapabilities();
      await preferences.restoreSessions(capabilities as never);
      await expect(preferences.restoreArchivedSession('archived')).rejects.toThrow('index denied');
      expect(capabilities.session.close).toHaveBeenCalledWith('archived');
      expect(preferences.getBootstrap().archivedSessions).toEqual([expect.objectContaining({ id: 'archived' })]);
    } finally { await rm(directory, { recursive: true, force: true }); }
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
