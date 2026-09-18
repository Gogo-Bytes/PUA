import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { composeMain, type CompositionDependencies } from '../../../src/app/main/composition';
import { SessionCoordinator, type SessionProcessEvent, type SessionSnapshot } from '../../../src/modules/sessions';
import { ConversationApplication, type AttachmentSourceId } from '../../../src/modules/conversation';
import type { SessionProcessContext } from '../../../src/platform/electron/utility/session-process-adapter';
import { applySessionStartResult, isSessionBusy, requireSessionSnapshot, sessionInfo, unwrapSessionResult } from '../../../src/app/main/session-mapper';

// Composition uses an entirely in-memory Adapter. Even accidentally constructing the default fails.
vi.mock('../../../src/platform/electron/utility/session-process-adapter', () => ({ SessionProcessAdapter: class { constructor() { throw new Error('Real adapter forbidden'); } } }));
vi.mock('../../../src/platform/filesystem/session-preparation', () => ({ prepareProject: () => { throw new Error('Real fs forbidden'); } }));
const runtime = { executable: '/fake/pi', source: '/fake/pi', args: ['--model', 'fake'] };
const options = { cwd: '/input', kind: 'chat' as const, startMode: 'new' as const, projectTrust: 'default' as const };
type ProcessAdapter = ReturnType<NonNullable<CompositionDependencies['createAdapter']>>;
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function harness(emit = vi.fn(), overrides: Omit<CompositionDependencies, 'createAdapter'> = {}) {
  let context!: SessionProcessContext;
  let observer!: (event: SessionProcessEvent) => void;
  let next = 0;
  const adapter = {
    observe: vi.fn((listener: typeof observer) => { observer = listener; }),
    register: vi.fn<ProcessAdapter['register']>(), forget: vi.fn<ProcessAdapter['forget']>(), activity: vi.fn(() => 'idle' as const),
    start: vi.fn(), close: vi.fn(async (id: string) => { context.invalidateConversation(id); return { exitCode: 0 }; }),
    send: vi.fn<ProcessAdapter['send']>().mockResolvedValue(undefined), stop: vi.fn<ProcessAdapter['stop']>().mockResolvedValue(undefined),
    respond: vi.fn<ProcessAdapter['respond']>().mockResolvedValue(undefined), rename: vi.fn<ProcessAdapter['rename']>().mockResolvedValue(undefined),
    fork: vi.fn<ProcessAdapter['fork']>().mockResolvedValue({ text: 'forked', cancelled: false }),
    write: vi.fn<ProcessAdapter['write']>(), resize: vi.fn<ProcessAdapter['resize']>(), acknowledge: vi.fn<ProcessAdapter['acknowledge']>(), assertAvailable: vi.fn<ProcessAdapter['assertAvailable']>(),
    read: vi.fn<ProcessAdapter['read']>().mockResolvedValue({ id: 'token', name: 'fake.txt', kind: 'file', size: 4 }),
    release: vi.fn<ProcessAdapter['release']>(), discardSources: vi.fn<ProcessAdapter['discardSources']>(), stageSources: vi.fn(() => ['source' as AttachmentSourceId]),
    attachmentView: vi.fn(() => ({ id: 'token', name: 'fake.txt', kind: 'file' as const, size: 4, path: '/fake.txt' })),
  };
  const prepareProject = vi.fn(async () => ({ cwd: '/prepared', title: 'Project' }));
  const capabilities = composeMain(emit, { prepareProject, createId: () => `id-${++next}`, ...overrides, createAdapter: value => { context = value; return adapter; } });
  return { capabilities, adapter, prepareProject, context, event: (event: SessionProcessEvent) => observer(event), emit };
}
afterEach(() => vi.restoreAllMocks());

describe('main composition and prepared create', () => {
  it('returns actual typed core instances and injects absolute workers from the worker boundary', () => {
    const h = harness();
    expect(h.capabilities.session).toBeInstanceOf(SessionCoordinator);
    expect(h.capabilities.conversation).toBeInstanceOf(ConversationApplication);
    expect(h.capabilities.terminal).toBe(h.adapter);
    expect(h.context.workerPaths).toEqual({ chat: fileURLToPath(new URL('../../../src/app/workers/pi-rpc.worker.js', import.meta.url)), terminal: fileURLToPath(new URL('../../../src/app/workers/pty.worker.js', import.meta.url)) });
    if (false) {
      // @ts-expect-error main cannot bypass preparation with core create
      h.capabilities.session.create({});
      // @ts-expect-error Conversation operation identities belong to composition
      h.capabilities.conversation.open('id');
      // @ts-expect-error no resource owner leaks to main
      h.capabilities.adapter;
    }
  });
  it('checks shutdown before preparation and again after deferred preparation without registration/open/start', async () => {
    const project = deferred<{ cwd: string; title: string }>();
    const prepareProject = vi.fn(() => project.promise);
    const open = vi.spyOn(ConversationApplication.prototype, 'open');
    const h = harness(undefined, { prepareProject });
    const creating = h.capabilities.createSession(runtime, options);
    await h.capabilities.session.closeAll();
    project.resolve({ cwd: '/fake', title: 'Fake' });
    await expect(creating).rejects.toThrow('应用正在关闭，不能创建会话');
    await expect(h.capabilities.createSession(runtime, { ...options, cwd: '' })).rejects.toThrow('应用正在关闭，不能创建会话');
    expect(prepareProject).toHaveBeenCalledTimes(1);
    expect(h.adapter.register).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(h.adapter.start).not.toHaveBeenCalled();
    expect(() => applySessionStartResult(h.capabilities.session.start('missing'))).toThrow('应用正在关闭，不能启动会话');
  });
  it('allocates UUID only after preparation, including the original closing rejection sequence', async () => {
    const project = deferred<{ cwd: string; title: string }>();
    const order: string[] = [];
    const h = harness(undefined, { prepareProject: () => { order.push('prepare'); return project.promise; }, createId: () => { order.push('uuid'); return 'prepared-id'; } });
    h.adapter.register.mockImplementation(() => { order.push('register'); });
    const creating = h.capabilities.createSession(runtime, options);
    expect(order).toEqual(['prepare']);
    await h.capabilities.session.closeAll();
    project.resolve({ cwd: '/fake', title: 'Fake' });
    await expect(creating).rejects.toThrow('应用正在关闭，不能创建会话');
    expect(order).toEqual(['prepare', 'uuid']);
    expect(h.adapter.register).not.toHaveBeenCalled();
  });
  it('reserves then registers then opens with no notification; real Conversation send and attachment operations are installed', async () => {
    const order: string[] = [];
    const create = SessionCoordinator.prototype.create;
    vi.spyOn(SessionCoordinator.prototype, 'create').mockImplementation(function (this: SessionCoordinator, command) { order.push('reserve'); return create.call(this, command); });
    const open = ConversationApplication.prototype.open;
    vi.spyOn(ConversationApplication.prototype, 'open').mockImplementation(function (this: ConversationApplication, id) { order.push('open'); open.call(this, id); });
    const h = harness(vi.fn(() => { order.push('observer'); }));
    h.adapter.register.mockImplementation(id => { expect(h.context.snapshot(id)?.lifecycle.phase).toBe('reserved'); order.push('register'); });
    const dto = await h.capabilities.createSession(runtime, options);
    expect(order).toEqual(['reserve', 'register', 'open']);
    expect(dto).toEqual({ id: 'id-1', cwd: '/prepared', title: 'Project', kind: 'chat', processStatus: 'starting', activity: 'idle' });
    expect(h.adapter.register).toHaveBeenCalledWith(dto.id, runtime, expect.objectContaining(options), { mode: 'create', piSessionId: dto.id });
    const attachments = await h.capabilities.registerChatAttachments(dto.id, ['/fake.txt']);
    expect(attachments[0].path).toBe('/fake.txt');
    await h.capabilities.conversation.send(dto.id, { text: 'send', attachmentIds: ['token'], delivery: 'prompt' });
    expect(h.adapter.send).toHaveBeenCalledWith(dto.id, { text: 'send', attachmentIds: ['token'], queuePreference: 'steer' });
    expect(h.adapter.release).toHaveBeenCalledWith(dto.id, ['token']);
  });
  it('keeps reserved/starting continuation exclusivity, permits new parallel chats after ready, and never opens terminal Conversation', async () => {
    const h = harness(); const open = vi.spyOn(ConversationApplication.prototype, 'open');
    const results = await Promise.allSettled([1, 2].map(() => h.capabilities.createSession(runtime, { ...options, startMode: 'continue' })));
    expect(results.map(item => item.status).sort()).toEqual(['fulfilled', 'rejected']);
    const id = h.capabilities.session.list()[0].id;
    await expect(h.capabilities.createSession(runtime, options)).rejects.toThrow('恢复就绪');
    applySessionStartResult(h.capabilities.session.start(id));
    await expect(h.capabilities.createSession(runtime, options)).rejects.toThrow('恢复就绪');
    h.event({ type: 'ready', id });
    expect(await Promise.all([1, 2].map(() => h.capabilities.createSession(runtime, options)))).toHaveLength(2);
    await expect(h.capabilities.createSession(runtime, { ...options, kind: 'terminal', cols: 80, rows: 24 })).rejects.toThrow('兼容终端');
    for (const snapshot of h.capabilities.session.list()) unwrapSessionResult(await h.capabilities.session.close(snapshot.id));
    open.mockClear();
    const terminal = await h.capabilities.createSession(runtime, { ...options, kind: 'terminal', cols: 80, rows: 24 });
    expect(open).not.toHaveBeenCalled();
    await expect(h.capabilities.createSession(runtime, options)).rejects.toThrow('兼容终端');
    expect(h.context.snapshot(terminal.id)?.lifecycle.phase).toBe('reserved');
  });
  it('restored dormant chats do not block a terminal, but cannot start after terminal ownership begins', async () => {
    const h = harness();
    const restored = await h.capabilities.restoreChatSession(runtime, { id: 'restored', cwd: '/input', title: 'Recovered', piSessionId: 'restored', sessionFile: '/home/user/restored.jsonl' });
    const terminal = await h.capabilities.createSession(runtime, { ...options, kind: 'terminal', cols: 80, rows: 24 });
    applySessionStartResult(h.capabilities.session.start(terminal.id));
    expect(() => applySessionStartResult(h.capabilities.session.start(restored.id))).toThrow('兼容终端');
    expect(h.adapter.start).toHaveBeenCalledTimes(1);
  });
  it.each(['register-before', 'register-after', 'open'] as const)('compensates %s synchronously, retains reservation until confirmed cleanup, then forgets once', async where => {
    const h = harness(); const cleanup = deferred<{ exitCode: number }>(); const original = new Error(where);
    h.adapter.close.mockImplementation(id => { h.context.invalidateConversation(id); return cleanup.promise; });
    let installed = false;
    h.adapter.register.mockImplementation(() => { if (where === 'register-before') throw original; installed = true; if (where === 'register-after') throw original; });
    if (where === 'open') {
      const open = ConversationApplication.prototype.open;
      vi.spyOn(ConversationApplication.prototype, 'open').mockImplementation(function (this: ConversationApplication, id) { open.call(this, id); throw original; });
    }
    const creating = h.capabilities.createSession(runtime, { ...options, startMode: 'continue' });
    const rejection = expect(creating).rejects.toBe(original);
    await Promise.resolve();
    expect(installed).toBe(where !== 'register-before');
    expect(h.context.snapshot('id-1')?.lifecycle.phase).toBe('closing');
    expect(h.adapter.close).toHaveBeenCalledTimes(1); expect(h.adapter.forget).not.toHaveBeenCalled();
    applySessionStartResult(h.capabilities.session.start('id-1')); expect(h.adapter.start).not.toHaveBeenCalled();
    await expect(h.capabilities.createSession(runtime, options)).rejects.toThrow('恢复就绪');
    cleanup.resolve({ exitCode: 0 }); await rejection;
    expect(h.context.snapshot('id-1')).toBeUndefined(); expect(h.adapter.forget).toHaveBeenCalledExactlyOnceWith('id-1');
  });
  it('cleanup failure overrides registration failure and is sticky across close/closeAll/context close without forget or retry', async () => {
    const h = harness(); const cleanup = deferred<{ exitCode: number }>();
    h.adapter.register.mockImplementation(() => { throw new Error('register'); });
    h.adapter.close.mockReturnValue(cleanup.promise);
    const creating = h.capabilities.createSession(runtime, options);
    const rejection = expect(creating).rejects.toThrow('进程清理失败，仍保留会话占用：Error: tree alive');
    await Promise.resolve(); cleanup.reject(new Error('tree alive')); await rejection;
    expect(h.context.snapshot('id-1')?.lifecycle.phase).toBe('cleanup-failed');
    await expect(h.context.close('id-1')).rejects.toThrow('仍保留');
    await expect(h.capabilities.session.closeAll().then(unwrapSessionResult)).rejects.toThrow('仍保留');
    expect(h.adapter.close).toHaveBeenCalledTimes(1); expect(h.adapter.forget).not.toHaveBeenCalled();
  });
  it('duplicate ID create fails without compensating the existing reservation', async () => {
    const h = harness(undefined, { createId: () => 'same' });
    await h.capabilities.createSession(runtime, options);
    await expect(h.capabilities.createSession(runtime, options)).rejects.toThrow('会话不能再次启动：Duplicate session ID');
    expect(h.adapter.register).toHaveBeenCalledTimes(1); expect(h.adapter.close).not.toHaveBeenCalled();
  });
  it('shares repeated/reentrant close and start work; throwing observers cannot block removal/invalidation/forget', async () => {
    const h = harness(vi.fn(() => { throw new Error('observer'); }));
    const dto = await h.capabilities.createSession(runtime, options);
    applySessionStartResult(h.capabilities.session.start(dto.id)); applySessionStartResult(h.capabilities.session.start(dto.id));
    expect(h.adapter.start).toHaveBeenCalledTimes(1);
    const cleanup = deferred<{ exitCode: number }>(); let reentrant: ReturnType<SessionCoordinator['close']> | undefined;
    h.adapter.close.mockImplementation(id => { reentrant = h.capabilities.session.close(id); h.context.invalidateConversation(id); return cleanup.promise; });
    const closing = h.capabilities.session.close(dto.id);
    expect(reentrant).toBe(closing); expect(h.capabilities.session.close(dto.id)).toBe(closing);
    cleanup.resolve({ exitCode: 9 }); unwrapSessionResult(await closing);
    expect(h.adapter.close).toHaveBeenCalledTimes(1); expect(h.adapter.forget).toHaveBeenCalledTimes(1);
    expect(h.adapter.release).toHaveBeenCalled();
    expect(() => requireSessionSnapshot(h.capabilities.session.get(dto.id))).toThrow('会话不存在');
    expect(() => applySessionStartResult(h.capabilities.session.start(dto.id))).toThrow('会话不存在');
    await expect(h.capabilities.session.close(dto.id).then(unwrapSessionResult)).rejects.toThrow('会话不存在');
  });
  it('unexpected exit cleans up but retains detached exited snapshot until explicit removal', async () => {
    const h = harness(); const dto = await h.capabilities.createSession(runtime, options);
    h.event({ type: 'transport-ended', id: dto.id }); await Promise.resolve();
    const snapshot = requireSessionSnapshot(h.capabilities.session.get(dto.id));
    expect(snapshot.lifecycle).toEqual({ phase: 'exited', exitCode: 0 }); expect(h.adapter.forget).not.toHaveBeenCalled();
    Object.assign(snapshot, { title: 'tamper' }); Object.assign(snapshot.lifecycle, { exitCode: 99 });
    const list = h.capabilities.session.list(); list[0].title = 'tamper'; list.pop();
    expect(sessionInfo(requireSessionSnapshot(h.capabilities.session.get(dto.id)), 'responding')).toMatchObject({ title: 'Project', activity: 'idle', exitCode: 0 });
    await h.capabilities.session.close(dto.id); expect(h.adapter.forget).toHaveBeenCalledTimes(1);
  });
});

describe('session snapshot mapper', () => {
  const phases: SessionSnapshot['lifecycle'][] = [{ phase: 'reserved' }, { phase: 'starting' }, { phase: 'running' }, { phase: 'closing', previous: 'starting' }, { phase: 'closing', previous: 'running' }, { phase: 'cleanup-failed', previous: 'starting' }, { phase: 'cleanup-failed', previous: 'running' }, { phase: 'exited', exitCode: 7 }];
  it.each(phases)('preserves busy and exitCode for $phase / $previous', lifecycle => {
    for (const kind of ['chat', 'terminal'] as const) for (const activity of ['idle', 'responding', 'waiting-input', 'compacting', 'retrying'] as const) {
      const snapshot: SessionSnapshot = { id: 'id', cwd: '/', title: '/', kind, startMode: 'new', lifecycle };
      const status = lifecycle.phase === 'exited' ? 'exited' : lifecycle.phase === 'running' || ('previous' in lifecycle && lifecycle.previous === 'running') ? 'running' : 'starting';
      expect(isSessionBusy(snapshot, activity)).toBe(kind === 'terminal' ? status === 'running' : status !== 'exited' && activity !== 'idle');
      const dto = sessionInfo(snapshot, activity);
      expect(dto.processStatus).toBe(status); expect(dto.activity).toBe(status === 'exited' ? 'idle' : activity);
      expect('exitCode' in dto).toBe(status === 'exited');
      dto.title = 'tamper'; expect(snapshot.title).toBe('/');
    }
  });
});
