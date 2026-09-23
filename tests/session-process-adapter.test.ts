import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Every platform effect is fake: no Electron instance, process, Pi, or filesystem work.
const fake = vi.hoisted(() => ({ hosts: [] as Array<EventEmitter & { postMessage: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> }>, fork: vi.fn(), tree: vi.fn(), stat: vi.fn(), open: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: { fork: fake.fork } }));
vi.mock('../src/platform/process/process-tree', () => ({ terminateProcessTree: fake.tree }));
vi.mock('node:fs/promises', () => ({ stat: fake.stat, open: fake.open }));
// Environment discovery otherwise probes the user's optional NVM directory on fake spawn.
vi.mock('../src/platform/pi/process/environment', () => ({
  runtimeEnvironment: () => ({}),
  terminalEnvironment: () => ({ TERM: 'xterm-256color' }),
}));
import { composeMain } from '../src/app/main/composition';
import { applySessionStartResult, requireSessionSnapshot, sessionInfo, unwrapSessionResult } from '../src/app/main/session-mapper';
import { conversationError, extensionResponse, sendIntent } from '../src/app/main/conversation-mapper';
import { SessionProcessAdapter } from '../src/platform/electron/utility/session-process-adapter';
import type { ExtensionUIRequest, SessionEvent } from '../src/shared/ipc/conversation';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const runtime = { executable: '/fake/pi', source: '/fake/pi', args: [] };
const options = { cwd: '/fake/project', kind: 'chat' as const, startMode: 'new' as const, projectTrust: 'default' as const };
const prepareProject = async () => ({ cwd: '/fake/project', title: 'Project' });
const stats = { isFile: () => true, size: 4 };
beforeEach(() => {
  vi.useFakeTimers(); fake.hosts.length = 0;
  fake.fork.mockReset().mockImplementation(() => { const host = Object.assign(new EventEmitter(), { postMessage: vi.fn(), kill: vi.fn() }); fake.hosts.push(host); return host; });
  fake.tree.mockReset().mockResolvedValue(undefined); fake.stat.mockReset().mockResolvedValue(stats); fake.open.mockReset();
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
async function running(emit: (event: SessionEvent) => void = () => {}) {
  const sessions = composeMain(emit, { prepareProject }); const chat = await sessions.createSession(runtime, options); applySessionStartResult(sessions.session.start(chat.id));
  const host = fake.hosts[0]; host.emit('spawn'); host.emit('message', { type: 'event', event: { type: 'session-info', id: chat.id, processStatus: 'running' } });
  return { sessions, id: chat.id, host };
}
function reply(host: typeof fake.hosts[number]) { const request = host.postMessage.mock.calls.at(-1)![0]; host.emit('message', { type: 'response', requestId: request.requestId, success: true }); }

describe('SessionProcessAdapter resource contract through main composition', () => {
  it('uses a Pi session identity for new chats and records every accepted prompt activity', async () => {
    const accepted = vi.fn();
    const sessions = composeMain(() => {}, { prepareProject, onChatMessageAccepted: accepted });
    const chat = await sessions.createSession(runtime, options); applySessionStartResult(sessions.session.start(chat.id));
    const host = fake.hosts[0]; host.emit('spawn'); host.emit('message', { type: 'event', event: { type: 'session-info', id: chat.id, processStatus: 'running' } });
    host.emit('message', { type: 'session-identity', sessionId: chat.id, sessionFile: '/home/pi/created.jsonl' });
    expect(host.postMessage.mock.calls[0][0]).toMatchObject({ type: 'start', args: ['--session-id', chat.id] });
    const sending = sessions.conversation.send(chat.id, sendIntent('first', [], 'prompt')); reply(host); await sending;
    expect(accepted).toHaveBeenCalledExactlyOnceWith(chat.id, { sessionId: chat.id, sessionFile: '/home/pi/created.jsonl' });
    const second = sessions.conversation.send(chat.id, sendIntent('second', [], 'prompt')); reply(host); await second;
    expect(accepted).toHaveBeenCalledTimes(2);
    const closed = sessions.session.close(chat.id).then(unwrapSessionResult); host.emit('exit', 0); await closed;
  });

  it('does not keep Conversation sending while durable activity metadata is still writing', async () => {
    const persistence = deferred<void>();
    const accepted = vi.fn().mockReturnValue(persistence.promise);
    const sessions = composeMain(() => {}, { prepareProject, onChatMessageAccepted: accepted });
    const chat = await sessions.createSession(runtime, options); applySessionStartResult(sessions.session.start(chat.id));
    const host = fake.hosts[0]; host.emit('spawn');
    host.emit('message', { type: 'event', event: { type: 'session-info', id: chat.id, processStatus: 'running' } });
    host.emit('message', { type: 'session-identity', sessionId: chat.id, sessionFile: '/home/pi/created.jsonl' });
    const first = sessions.conversation.send(chat.id, sendIntent('first', [], 'prompt')); reply(host); await first;
    expect(accepted).toHaveBeenCalledOnce();
    const second = sessions.conversation.send(chat.id, sendIntent('second', [], 'prompt')); reply(host); await second;
    expect(accepted).toHaveBeenCalledTimes(2);
    persistence.resolve(); await Promise.resolve();
    const closed = sessions.session.close(chat.id).then(unwrapSessionResult); host.emit('exit', 0); await closed;
  });

  it('restores by the exact session file and rejects a mismatched Pi handshake', async () => {
    const sessions = composeMain(() => {}, { prepareProject });
    const chat = await sessions.restoreChatSession(runtime, { id: 'pua-restore', cwd: '/fake/project', title: 'Recovered', piSessionId: 'pi-restore', sessionFile: '/home/pi/recovered.jsonl' });
    applySessionStartResult(sessions.session.start(chat.id)); const host = fake.hosts[0]; host.emit('spawn');
    expect(host.postMessage.mock.calls[0][0]).toMatchObject({ type: 'start', args: ['--session', '/home/pi/recovered.jsonl'] });
    host.emit('message', { type: 'session-identity', sessionId: 'wrong', sessionFile: '/home/pi/recovered.jsonl' });
    const closing = sessions.session.close(chat.id).then(unwrapSessionResult); host.emit('exit', 0); await expect(closing).resolves.toBeUndefined();
  });

  it('refreshes durable identity when Pi switches to a native fork branch', async () => {
    const changed = vi.fn();
    const sessions = composeMain(() => {}, { prepareProject, onChatIdentityChanged: changed });
    const chat = await sessions.createSession(runtime, options); applySessionStartResult(sessions.session.start(chat.id));
    const host = fake.hosts[0]; host.emit('spawn');
    host.emit('message', { type: 'session-identity', sessionId: chat.id, sessionFile: '/home/pi/original.jsonl' });
    host.emit('message', { type: 'session-identity', sessionId: 'forked', sessionFile: '/home/pi/forked.jsonl' });
    expect(changed).toHaveBeenCalledExactlyOnceWith(chat.id, { sessionId: 'forked', sessionFile: '/home/pi/forked.jsonl' });
    const closing = sessions.session.close(chat.id).then(unwrapSessionResult); host.emit('exit', 0); await closing;
  });

  it('keeps Pi --no-session ephemeral and does not inject a PUA selector', async () => {
    const sessions = composeMain(() => {}, { prepareProject });
    const chat = await sessions.createSession({ ...runtime, args: ['--no-session'] }, options); applySessionStartResult(sessions.session.start(chat.id));
    const host = fake.hosts[0]; host.emit('spawn'); expect(host.postMessage.mock.calls[0][0]).toMatchObject({ type: 'start', args: ['--no-session'] });
    const closed = sessions.session.close(chat.id).then(unwrapSessionResult); host.emit('exit', 0); await closed;
  });
  it('rechecks admission after a deliberately delayed cwd and never registers or forks', async () => {
    const project = deferred<{ cwd: string; title: string }>();
    const sessions = composeMain(() => {}, { prepareProject: () => project.promise });
    const creating = sessions.createSession(runtime, options); await sessions.session.closeAll().then(unwrapSessionResult); project.resolve({ cwd: '/fake', title: 'Fake' });
    await expect(creating).rejects.toThrow('正在关闭'); expect(fake.fork).not.toHaveBeenCalled();
  });
  it('compensates registration failure without a leaked reservation', async () => {
    let fail = true;
    const sessions = composeMain(() => {}, { prepareProject, createAdapter: context => {
      const adapter = new SessionProcessAdapter(context); const register = adapter.register.bind(adapter);
      vi.spyOn(adapter, 'register').mockImplementation((...args) => { if (fail) { fail = false; throw new Error('registration'); } register(...args); }); return adapter;
    } });
    await expect(sessions.createSession(runtime, { ...options, startMode: 'continue' })).rejects.toThrow('registration');
    await expect(sessions.createSession(runtime, { ...options, kind: 'terminal', cols: 80, rows: 24 })).resolves.toBeDefined();
    await sessions.session.closeAll().then(unwrapSessionResult); expect(fake.fork).not.toHaveBeenCalled();
  });
  it('close before spawn prevents late start messages and keeps the host until actual exit', async () => {
    const sessions = composeMain(() => {}, { prepareProject }); const chat = await sessions.createSession(runtime, options); applySessionStartResult(sessions.session.start(chat.id));
    const host = fake.hosts[0]; const closed = sessions.session.close(chat.id).then(unwrapSessionResult); host.emit('spawn'); applySessionStartResult(sessions.session.start(chat.id));
    expect(host.postMessage.mock.calls.map(call => call[0].type)).toEqual(['close']); expect(fake.fork).toHaveBeenCalledTimes(1);
    host.emit('exit', 0); await closed; expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['before', 'during'] as const)('host exit %s close shares deferred tree cleanup and blocks resurrection', async timing => {
    const events: SessionEvent[] = []; const { sessions, host, id } = await running(event => events.push(event));
    const tree = deferred<void>(); fake.tree.mockReturnValue(tree.promise); host.emit('message', { type: 'child-pid', pid: 123 });
    if (timing === 'before') host.emit('exit', 9);
    const closed = sessions.session.close(id).then(unwrapSessionResult); host.emit('exit', 9); host.emit('exit', 9);
    host.emit('message', { type: 'event', event: { type: 'session-info', id, processStatus: 'running', title: 'late' } });
    applySessionStartResult(sessions.session.start(id)); expect(fake.fork).toHaveBeenCalledTimes(1);
    await expect(sessions.createSession(runtime, { ...options, kind: 'terminal', cols: 80, rows: 24 })).rejects.toThrow('兼容终端');
    expect(events.filter(event => event.type === 'exit')).toEqual([]); expect(sessionInfo(requireSessionSnapshot(sessions.session.get(id)), sessions.activity(id)).title).toBe('Project');
    tree.resolve(); await closed; expect(fake.tree).toHaveBeenCalledTimes(1); expect(events.filter(event => event.type === 'exit')).toHaveLength(1);
    await expect(sessions.createSession(runtime, { ...options, kind: 'terminal', cols: 80, rows: 24 })).resolves.toBeDefined(); await sessions.session.closeAll().then(unwrapSessionResult);
  });
  it('rejects pending immediately on transport exit even when cleanup fails and emit throws', async () => {
    const { sessions, host, id } = await running(() => { throw new Error('listener'); });
    const pending = sessions.conversation.stop(id); const rejected = expect(pending).rejects.toThrow('已退出');
    host.emit('message', { type: 'child-pid', pid: 123 }); fake.tree.mockRejectedValue(new Error('tree alive'));
    host.emit('exit', 1); await rejected; await expect(sessions.session.close(id).then(unwrapSessionResult)).rejects.toThrow('仍保留');
    expect(sessionInfo(requireSessionSnapshot(sessions.session.get(id)), sessions.activity(id)).processStatus).toBe('running'); expect(vi.getTimerCount()).toBe(0);
    await expect(sessions.createSession(runtime, { ...options, kind: 'terminal', cols: 80, rows: 24 })).rejects.toThrow('兼容终端');
    applySessionStartResult(sessions.session.start(id)); expect(fake.fork).toHaveBeenCalledTimes(1);
  });
  it('successful cleanup and deletion survive a throwing exit observer', async () => {
    const { sessions, host, id } = await running(() => { throw new Error('listener'); });
    const closed = sessions.session.close(id).then(unwrapSessionResult); host.emit('exit', 0); await closed;
    expect(() => sessionInfo(requireSessionSnapshot(sessions.session.get(id)), sessions.activity(id))).toThrow('会话不存在');
  });
  it('close postMessage throw cannot bypass fallback; kill is not exit confirmation', async () => {
    const { sessions, host, id } = await running(() => { throw new Error('listener'); });
    host.postMessage.mockImplementation(() => { throw new Error('post'); });
    const closed = sessions.session.close(id).then(unwrapSessionResult); let done = false; void closed.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(2000); expect(host.kill).toHaveBeenCalledTimes(1); expect(done).toBe(false);
    host.emit('exit', 0); await closed; expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['throws', 'no-exit'] as const)('failed host kill (%s) retains ownership and does not retry cleanup', async mode => {
    const { sessions, host, id } = await running();
    if (mode === 'throws') host.kill.mockImplementation(() => { throw new Error('kill failed'); });
    const closed = sessions.session.close(id).then(unwrapSessionResult); const rejected = expect(closed).rejects.toThrow('仍保留');
    await vi.advanceTimersByTimeAsync(4000); await rejected;
    await expect(sessions.createSession(runtime, { ...options, startMode: 'continue' })).rejects.toThrow('避免');
    host.emit('exit', 0); applySessionStartResult(sessions.session.start(id)); await expect(sessions.session.close(id).then(unwrapSessionResult)).rejects.toThrow('仍保留');
    expect(fake.fork).toHaveBeenCalledTimes(1); expect(host.kill).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('fallback and host exit share the same pending tree cleanup before final release', async () => {
    const { sessions, host, id } = await running(); const tree = deferred<void>(); fake.tree.mockReturnValue(tree.promise);
    host.emit('message', { type: 'child-pid', pid: 123 }); const closed = sessions.session.close(id).then(unwrapSessionResult);
    await vi.advanceTimersByTimeAsync(2000); expect(fake.tree).toHaveBeenCalledTimes(1); expect(host.kill).not.toHaveBeenCalled();
    host.emit('exit', 0); await expect(sessions.createSession(runtime, { ...options, kind: 'terminal', cols: 80, rows: 24 })).rejects.toThrow('兼容终端');
    tree.resolve(); await closed; expect(fake.tree).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('failed fallback tree cleanup still kills the host but cannot publish exit or release', async () => {
    const events: SessionEvent[] = []; const { sessions, host, id } = await running(event => events.push(event));
    host.emit('message', { type: 'child-pid', pid: 123 }); fake.tree.mockRejectedValue(new Error('tree alive'));
    host.kill.mockImplementation(() => { host.emit('exit', 0); });
    const closed = sessions.session.close(id).then(unwrapSessionResult); const rejected = expect(closed).rejects.toThrow('仍保留');
    await vi.advanceTimersByTimeAsync(2000); await rejected;
    expect(host.kill).toHaveBeenCalledTimes(1); expect(fake.tree).toHaveBeenCalledTimes(1);
    expect(events.filter(event => event.type === 'exit')).toEqual([]);
    await expect(sessions.createSession(runtime, { ...options, kind: 'terminal', cols: 80, rows: 24 })).rejects.toThrow('兼容终端');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('main-facing info is detached from both lifecycle and activity projection', async () => {
    const { sessions, host, id } = await running();
    const info = sessionInfo(requireSessionSnapshot(sessions.session.get(id)), sessions.activity(id));
    Object.assign(info, { title: 'tampered', processStatus: 'exited', activity: 'waiting-input' });
    expect(sessionInfo(requireSessionSnapshot(sessions.session.get(id)), sessions.activity(id))).toMatchObject({ title: 'Project', processStatus: 'running', activity: 'idle' });
    const closed = sessions.session.close(id).then(unwrapSessionResult); host.emit('exit', 0); await closed;
  });
  it('worker exit events do not release ownership before utility exit and cleanup', async () => {
    const { sessions, host, id } = await running();
    host.emit('message', { type: 'event', event: { type: 'exit', id, exitCode: 0 } });
    expect(sessionInfo(requireSessionSnapshot(sessions.session.get(id)), sessions.activity(id)).processStatus).toBe('running');
    await expect(sessions.createSession(runtime, { ...options, kind: 'terminal', cols: 80, rows: 24 })).rejects.toThrow('兼容终端');
    const closed = sessions.session.close(id).then(unwrapSessionResult); host.emit('exit', 0); await closed;
  });
  it('postMessage failure settles every pending slot and timer (no replay or hidden limit leak)', async () => {
    const { sessions, host, id } = await running(); host.postMessage.mockImplementation(() => { throw new Error('send failed'); });
    for (let i = 0; i < 40; i++) await expect(sessions.conversation.stop(id)).rejects.toThrow('send failed');
    expect(vi.getTimerCount()).toBe(0); expect(host.postMessage).toHaveBeenCalledTimes(41);
    host.postMessage.mockReset(); const request = sessions.conversation.stop(id); reply(host); await request;
    const closed = sessions.session.close(id).then(unwrapSessionResult); host.emit('exit', 0); await closed;
  });
  it('enforces 32 pending, pauses watchdog for waiting input, times out without replay and closes', async () => {
    const { sessions, host, id } = await running();
    const pending = Array.from({ length: 32 }, () => sessions.conversation.stop(id).catch(error => error as Error));
    await expect(sessions.conversation.stop(id)).rejects.toThrow('请求过多');
    host.emit('message', { type: 'event', event: { type: 'chat-state', id, state: { activity: 'waiting-input' } } });
    await vi.advanceTimersByTimeAsync(360_000); expect(host.postMessage.mock.calls.filter(call => call[0].type === 'stop')).toHaveLength(32);
    host.emit('message', { type: 'event', event: { type: 'chat-state', id, state: { activity: 'idle' } } });
    await vi.advanceTimersByTimeAsync(360_000); host.emit('exit', 0);
    const errors = await Promise.all(pending); expect(errors.every(error => error instanceof Error)).toBe(true);
    expect(String(errors[0])).toContain('不会自动重发'); expect(host.postMessage.mock.calls.filter(call => call[0].type === 'stop')).toHaveLength(32);
    await sessions.session.closeAll().then(unwrapSessionResult); expect(vi.getTimerCount()).toBe(0);
  });
  it('attachment tokens stay session-scoped and revoked tokens cannot send', async () => {
    const { sessions, host, id } = await running(); const other = await sessions.createSession(runtime, options);
    const [attachment] = await sessions.registerChatAttachments(id, ['/fake/file.txt']);
    await expect(sessions.conversation.send(other.id, sendIntent('cross', [attachment.id], 'prompt')).catch(conversationError)).rejects.toThrow('附件已失效');
    sessions.conversation.removeAttachment(id, attachment.id); await expect(sessions.conversation.send(id, sendIntent('revoked', [attachment.id], 'prompt')).catch(conversationError)).rejects.toThrow('附件已失效');
    const closed = sessions.session.closeAll().then(unwrapSessionResult); host.emit('exit', 0); await closed;
  });
  it('closing during image read closes the file handle but cannot register new tokens', async () => {
    const { sessions, host, id } = await running(); const reading = deferred<{ bytesRead: number }>();
    const handle = { stat: vi.fn().mockResolvedValue(stats), read: vi.fn().mockReturnValue(reading.promise), close: vi.fn().mockResolvedValue(undefined) }; fake.open.mockResolvedValue(handle);
    const selected = sessions.registerChatAttachments(id, ['/fake/test.png']); const rejected = expect(selected).rejects.toThrow('已关闭');
    await vi.advanceTimersByTimeAsync(0); expect(handle.read).toHaveBeenCalledTimes(1);
    const closed = sessions.session.close(id).then(unwrapSessionResult); reading.resolve({ bytesRead: 4 }); await rejected; expect(handle.close).toHaveBeenCalledTimes(1);
    host.emit('exit', 0); await closed;
  });
  it('allows extension responses during startup while prompt still requires the original handshake', async () => {
    const sessions = composeMain(() => {}, { prepareProject });
    const chat = await sessions.createSession(runtime, options); applySessionStartResult(sessions.session.start(chat.id));
    const host = fake.hosts[0];
    await expect(sessions.conversation.send(chat.id, sendIntent('not ready', [], 'prompt')).catch(conversationError)).rejects.toThrow('尚未运行');
    const answer = sessions.conversation.respond(chat.id, extensionResponse({ id: 'startup', cancelled: true }));
    expect(host.postMessage.mock.calls.at(-1)![0]).toMatchObject({ type: 'extension-response', response: { id: 'startup', cancelled: true } });
    reply(host); await answer;
    const closed = sessions.session.close(chat.id).then(unwrapSessionResult); host.emit('exit', 0); await closed;
  });
  it.each(['prompt', 'steer', 'followUp'] as const)('encodes %s with unchanged file path/image payloads and acknowledgement consumption', async delivery => {
    const { sessions, host, id } = await running();
    const handle = {
      stat: vi.fn().mockResolvedValue(stats),
      read: vi.fn().mockImplementation(async (bytes: Buffer) => { bytes.write('tiny'); return { bytesRead: 4 }; }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    fake.open.mockResolvedValue(handle);
    const attachments = await sessions.registerChatAttachments(id, ['/fake/a"b.txt', '/fake/test.png']);
    expect(attachments[0]).toMatchObject({ path: '/fake/a"b.txt', kind: 'file', size: 4 });
    expect(attachments[1]).toMatchObject({ path: '/fake/test.png', kind: 'image', previewUrl: 'data:image/png;base64,dGlueQ==' });
    const sending = sessions.conversation.send(id, sendIntent('/extension', attachments.map(item => item.id), delivery)).catch(conversationError);
    const request = host.postMessage.mock.calls.at(-1)![0];
    expect(request).toEqual({
      type: 'send', requestId: expect.any(String), text: '/extension', filePaths: ['/fake/a"b.txt'],
      images: [{ data: 'dGlueQ==', mimeType: 'image/png' }],
      queuePreference: delivery === 'followUp' ? 'followUp' : 'steer',
    });
    sessions.conversation.removeAttachment(id, attachments[0].id);
    const [fresh] = await sessions.registerChatAttachments(id, ['/fake/fresh.txt']);
    reply(host); await sending;
    await expect(sessions.conversation.send(id, sendIntent('consumed', [attachments[1].id], 'prompt')).catch(conversationError)).rejects.toThrow('附件已失效');
    const next = sessions.conversation.send(id, sendIntent('fresh', [fresh.id], 'prompt')).catch(conversationError); reply(host); await next;
    expect(handle.close).toHaveBeenCalledTimes(1);
    const closed = sessions.session.close(id).then(unwrapSessionResult); host.emit('exit', 0); await closed;
  });
  it('rejects oversized image after stat but before Buffer allocation/read and always closes its handle', async () => {
    const { sessions, host, id } = await running();
    const handle = { stat: vi.fn().mockResolvedValue({ ...stats, size: 5 * 1024 * 1024 + 1 }), read: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
    fake.open.mockResolvedValue(handle);
    const allocate = vi.spyOn(Buffer, 'alloc');
    await expect(sessions.registerChatAttachments(id, ['/fake/large.png'])).rejects.toThrow('large.png 超过 5 MiB');
    expect(handle.read).not.toHaveBeenCalled();
    expect(allocate).not.toHaveBeenCalledWith(5 * 1024 * 1024 + 1);
    expect(handle.close).toHaveBeenCalledTimes(1);
    const closed = sessions.session.close(id).then(unwrapSessionResult); host.emit('exit', 0); await closed;
  });
  it('send postMessage throw releases slot, timer and business lock while preserving retryable attachments', async () => {
    const { sessions, host, id } = await running();
    const [item] = await sessions.registerChatAttachments(id, ['/fake/retry.txt']);
    host.postMessage.mockImplementationOnce(() => { throw new Error('post failed'); });
    await expect(sessions.conversation.send(id, sendIntent('first', [item.id], 'prompt')).catch(conversationError)).rejects.toThrow('post failed');
    expect(vi.getTimerCount()).toBe(0);
    const retry = sessions.conversation.send(id, sendIntent('retry', [item.id], 'prompt')).catch(conversationError); reply(host); await retry;
    expect(host.postMessage.mock.calls.filter(call => call[0].type === 'send')).toHaveLength(2);
    const closed = sessions.session.close(id).then(unwrapSessionResult); host.emit('exit', 0); await closed;
  });
  it('send timeout invalidates attachments immediately and never replays an unknown accepted request', async () => {
    const { sessions, host, id } = await running();
    const [item] = await sessions.registerChatAttachments(id, ['/fake/unknown.txt']);
    const sending = sessions.conversation.send(id, sendIntent('unknown', [item.id], 'prompt')).catch(conversationError);
    const rejection = expect(sending).rejects.toThrow('不会自动重发');
    await vi.advanceTimersByTimeAsync(360_000); await rejection;
    await expect(sessions.conversation.send(id, sendIntent('retry', [item.id], 'prompt')).catch(conversationError)).rejects.toThrow('已关闭');
    expect(host.postMessage.mock.calls.filter(call => call[0].type === 'send')).toHaveLength(1);
    host.emit('exit', 0); await sessions.session.closeAll().then(unwrapSessionResult); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['open', 'stat', 'close'] as const)('invalidates across an awaited image %s without late registration or handle leak', async pauseAt => {
    const { sessions, host, id } = await running();
    const pause = deferred<unknown>();
    const handle = {
      stat: vi.fn().mockImplementation(() => pauseAt === 'stat' ? pause.promise : Promise.resolve(stats)),
      read: vi.fn().mockResolvedValue({ bytesRead: 4 }),
      close: vi.fn().mockImplementation(() => pauseAt === 'close' ? pause.promise : Promise.resolve()),
    };
    fake.open.mockImplementation(() => pauseAt === 'open' ? pause.promise : Promise.resolve(handle));
    const selecting = sessions.registerChatAttachments(id, ['/fake/test.png']);
    const rejected = expect(selecting).rejects.toThrow('已关闭');
    await vi.advanceTimersByTimeAsync(0);
    const closed = sessions.session.close(id).then(unwrapSessionResult);
    pause.resolve(pauseAt === 'open' ? handle : pauseAt === 'stat' ? stats : undefined);
    await rejected; expect(handle.close).toHaveBeenCalledTimes(1);
    host.emit('exit', 0); await closed;
  });
  it('old reads and host events cannot pollute a reused session ID after host cleanup', async () => {
    const sessions = composeMain(() => {}, { prepareProject, createId: () => 'reused' });
    const first = await sessions.createSession(runtime, options); applySessionStartResult(sessions.session.start(first.id));
    const oldHost = fake.hosts[0];
    oldHost.emit('message', { type: 'event', event: { type: 'session-info', id: first.id, processStatus: 'running' } });
    const reading = deferred<typeof stats>(); fake.stat.mockReturnValueOnce(reading.promise);
    const selection = sessions.registerChatAttachments(first.id, ['/fake/late.txt']);
    const rejection = expect(selection).rejects.toThrow('已关闭');
    await vi.advanceTimersByTimeAsync(0);
    const closed = sessions.session.close(first.id).then(unwrapSessionResult); oldHost.emit('exit', 0); await closed;
    const second = await sessions.createSession(runtime, options); applySessionStartResult(sessions.session.start(second.id));
    const newHost = fake.hosts[1];
    newHost.emit('message', { type: 'event', event: { type: 'session-info', id: second.id, processStatus: 'running' } });
    const [fresh] = await sessions.registerChatAttachments(second.id, ['/fake/fresh.txt']);
    reading.resolve(stats); await rejection;
    oldHost.emit('message', { type: 'event', event: { type: 'session-info', id: first.id, title: 'late title', activity: 'waiting-input' } });
    expect(sessionInfo(requireSessionSnapshot(sessions.session.get(second.id)), sessions.activity(second.id))).toMatchObject({ title: 'Project', activity: 'idle' });
    const sending = sessions.conversation.send(second.id, sendIntent('fresh', [fresh.id], 'prompt')).catch(conversationError); reply(newHost); await sending;
    const ended = sessions.session.close(second.id).then(unwrapSessionResult); newHost.emit('exit', 0); await ended;
  });
  it('late successful rename cannot resurrect or update a closing session', async () => {
    const { sessions, host, id } = await running(); const rename = sessions.conversation.rename(id, 'late'); reply(host);
    const closed = sessions.session.close(id).then(unwrapSessionResult); await rename; expect(sessionInfo(requireSessionSnapshot(sessions.session.get(id)), sessions.activity(id)).title).toBe('Project');
    host.emit('exit', 0); await closed;
  });
  it('keeps absolute sibling worker paths, terminal spawn readiness and PTY control bytes', async () => {
    const { sessions, host, id } = await running();
    expect(fake.fork.mock.calls[0][0]).toBe(fileURLToPath(new URL('../src/app/workers/pi-rpc.worker.js', import.meta.url)));
    const closed = sessions.session.close(id).then(unwrapSessionResult); host.emit('exit', 0); await closed;
    const terminal = await sessions.createSession(runtime, { ...options, kind: 'terminal', startMode: 'resume', cols: 80, rows: 24 });
    applySessionStartResult(sessions.session.start(terminal.id)); const pty = fake.hosts[1];
    expect(sessionInfo(requireSessionSnapshot(sessions.session.get(terminal.id)), sessions.activity(terminal.id)).processStatus).toBe('starting');
    expect(fake.fork.mock.calls[1][0]).toBe(fileURLToPath(new URL('../src/app/workers/pty.worker.js', import.meta.url)));
    pty.emit('spawn'); expect(sessionInfo(requireSessionSnapshot(sessions.session.get(terminal.id)), sessions.activity(terminal.id)).processStatus).toBe('running');
    expect(pty.postMessage.mock.calls[0][0]).toMatchObject({ type: 'start', args: ['--resume'], cols: 80, rows: 24 });
    sessions.terminal.write(terminal.id, '\0\x1b[31m'); sessions.terminal.resize(terminal.id, 100, 30); sessions.terminal.acknowledge(terminal.id, 9);
    expect(pty.postMessage.mock.calls.slice(1).map(call => call[0])).toEqual([{ type: 'write', data: '\0\x1b[31m' }, { type: 'resize', cols: 100, rows: 30 }, { type: 'ack', size: 9 }]);
    const ended = sessions.session.closeAll().then(unwrapSessionResult); pty.emit('exit', 0); await ended;
  });
  it('fork failure takes cleanup path and spawn-post failure also locks before reporting', async () => {
    const sessions = composeMain(() => { throw new Error('listener'); }, { prepareProject });
    const first = await sessions.createSession(runtime, options); fake.fork.mockImplementationOnce(() => { throw new Error('fork'); });
    expect(() => applySessionStartResult(sessions.session.start(first.id))).toThrow('启动失败'); await sessions.session.close(first.id).then(unwrapSessionResult);
    const second = await sessions.createSession(runtime, options); applySessionStartResult(sessions.session.start(second.id)); const host = fake.hosts[0];
    host.postMessage.mockImplementationOnce(() => { throw new Error('start post'); }); host.emit('spawn');
    applySessionStartResult(sessions.session.start(second.id)); expect(fake.fork).toHaveBeenCalledTimes(2); const closed = sessions.session.close(second.id).then(unwrapSessionResult); host.emit('exit', 0); await closed;
  });
});

it('worker protocol binds events to the resource and rejects malformed replies without pending/timer leaks', async () => {
  const events: SessionEvent[] = []; const { sessions, host, id } = await running(event => events.push(event));
  const before = events.length;
  for (const raw of [null, [], { type: 'data', data: 'PTY only' },
    { type: 'event', event: { type: 'session-info', id: 'other', title: 'injected', activity: 'waiting-input' } },
    { type: 'event', event: { type: 'chat-state', id, state: null } },
    { type: 'event', event: { type: 'session-info', id, processStatus: ['running'] } },
    { type: 'response', requestId: 'expired', success: true }]) host.emit('message', raw);
  expect(events).toHaveLength(before); expect(sessionInfo(requireSessionSnapshot(sessions.session.get(id)), sessions.activity(id))).toMatchObject({ title: 'Project', activity: 'idle' });
  for (const body of [{ success: 'true' }, { success: false }, { success: true, data: {} }, { type: 'stop' }]) {
    const stopping = sessions.conversation.stop(id); const rejected = expect(stopping).rejects.toThrow('Invalid RPC worker response');
    const requestId = host.postMessage.mock.calls.at(-1)![0].requestId;
    host.emit('message', { type: 'response', requestId, ...body }); await rejected;
    expect(vi.getTimerCount()).toBe(0);
    host.emit('message', { type: 'response', requestId, success: true });
  }
  const retry = sessions.conversation.stop(id); reply(host); await retry;
  const closed = sessions.session.close(id).then(unwrapSessionResult); host.emit('exit', 0); await closed;
});
it('worker protocol drops malformed extension-ui before observers or activity/dialog projections', async () => {
  const events: SessionEvent[] = [];
  const dialogs = new Map<string, ExtensionUIRequest>();
  const { sessions, host, id } = await running(event => {
    events.push(event);
    if (event.type === 'extension-ui') dialogs.set(event.request.id, event.request);
  });
  const kept: ExtensionUIRequest = { id: 'dialog', method: 'input', title: 'Keep', placeholder: '' };
  host.emit('message', { type: 'event', event: { type: 'extension-ui', id, request: kept } });
  host.emit('message', { type: 'event', event: { type: 'chat-state', id, state: { activity: 'responding' } } });
  const before = [...events];
  const common = { id: kept.id, title: 'Must not replace' };
  const malformed: unknown[] = [
    null, undefined, [], 'request', 1, true,
    { ...common, method: 'select' }, { ...common, method: 'confirm' },
    ...[null, 1, true, 'options', {}, ['a', 1], ['a', null], [['a']], Array(1), ['a', , 'b']]
      .map(options => ({ ...common, method: 'select', options })),
    ...[null, 1, true, [], {}].map(message => ({ ...common, method: 'confirm', message })),
    ...[null, 1, true, [], {}].flatMap(value => [
      { ...common, method: 'input', placeholder: value }, { ...common, method: 'editor', prefill: value },
    ]),
    ...(['select', 'confirm', 'input', 'editor'] as const).flatMap(method => [null, NaN, Infinity, -Infinity, '0', [], {}, true]
      .map(expiresAt => ({ ...common, method, options: [], message: '', expiresAt }))),
    ...[undefined, null, 1, true, [], {}].flatMap(value => [
      { ...common, method: 'input', id: value }, { ...common, method: 'input', title: value },
      { ...common, method: value },
    ]),
    { ...common, method: 'input', id: '' }, { ...common, method: 'custom' },
  ];
  for (const request of malformed) {
    for (const sessionId of [id, 'other']) {
      host.emit('message', { type: 'event', event: { type: 'extension-ui', id: sessionId, request } });
      expect(events).toEqual(before);
      expect([...dialogs.values()]).toEqual([kept]);
      expect(sessionInfo(requireSessionSnapshot(sessions.session.get(id)), sessions.activity(id)).activity).toBe('responding');
      expect(vi.getTimerCount()).toBe(0);
    }
  }
  const closed = sessions.session.close(id).then(unwrapSessionResult); host.emit('exit', 0); await closed;
});
it('worker protocol forwards all valid extension-ui branches only to their bound session', async () => {
  const events: SessionEvent[] = []; const { sessions, host, id } = await running(event => events.push(event));
  const common = { id: 'dialog', title: '' };
  const requests: ExtensionUIRequest[] = [
    { ...common, method: 'select', options: [] }, { ...common, method: 'select', options: ['', '文\0'], expiresAt: 0 },
    { ...common, method: 'confirm', message: '', expiresAt: 123.5 },
    { ...common, method: 'input' }, { ...common, method: 'input', placeholder: '', expiresAt: undefined },
    { ...common, method: 'editor' }, { ...common, method: 'editor', prefill: '文\0', expiresAt: -1 },
  ];
  for (const request of requests) {
    const before = events.length;
    host.emit('message', { type: 'event', event: { type: 'extension-ui', id: 'other', request } });
    expect(events).toHaveLength(before);
    const event: SessionEvent = { type: 'extension-ui', id, request };
    host.emit('message', { type: 'event', event });
    expect(events.slice(before)).toEqual([event]);
    expect(sessionInfo(requireSessionSnapshot(sessions.session.get(id)), sessions.activity(id)).activity).toBe('idle');
  }
  const closed = sessions.session.close(id).then(unwrapSessionResult); host.emit('exit', 0); await closed;
});

it('worker protocol accepts valid PID during close but never treats a wire exit as cleanup confirmation', async () => {
  const { sessions, host, id } = await running(); const closed = sessions.session.close(id).then(unwrapSessionResult);
  for (const pid of [-1, 0, 1.5, '123']) host.emit('message', { type: 'child-pid', pid });
  host.emit('message', { type: 'child-pid', pid: 123 });
  host.emit('message', { type: 'event', event: { type: 'exit', id, exitCode: 0 } });
  expect(fake.tree).not.toHaveBeenCalled();
  host.emit('exit', 0); await closed; expect(fake.tree).toHaveBeenCalledExactlyOnceWith(123);
});
it('Terminal Interface caches valid pre-running sizes, drops early input and retains missing-ID policies', async () => {
  const sessions = composeMain(() => {}, { prepareProject });
  const session = await sessions.createSession(runtime, { ...options, kind: 'terminal', cols: 80, rows: 24 });
  sessions.terminal.write(session.id, 'early'); sessions.terminal.resize(session.id, 120, 40);
  sessions.terminal.resize(session.id, 1, 1); applySessionStartResult(sessions.session.start(session.id));
  const host = fake.hosts[0]; sessions.terminal.write(session.id, 'still early'); host.emit('spawn');
  expect(host.postMessage.mock.calls.map(call => call[0])).toEqual([{ type: 'start', executable: runtime.executable, args: [], cwd: '/fake/project', env: { TERM: 'xterm-256color' }, cols: 120, rows: 40 }]);
  expect(() => sessions.terminal.write('missing', '')).toThrow('会话不存在');
  expect(() => sessions.terminal.resize('missing', 80, 24)).toThrow('会话不存在');
  expect(() => sessions.terminal.resize('missing', 1, 1)).not.toThrow();
  expect(() => sessions.terminal.acknowledge('missing', 1)).not.toThrow();
  const closed = sessions.session.close(session.id).then(unwrapSessionResult); host.emit('exit', 0); await closed;
});
it('uncorrelated malformed response cannot synthesize success; a later valid ack still settles once', async () => {
  const { sessions, host, id } = await running();
  const sending = sessions.conversation.send(id, sendIntent('text', [], 'prompt')).catch(conversationError); let settled = false;
  void sending.then(() => { settled = true; });
  host.emit('message', { type: 'response', success: true }); await Promise.resolve();
  expect(settled).toBe(false); expect(vi.getTimerCount()).toBe(1);
  reply(host); await sending; expect(vi.getTimerCount()).toBe(0);
  const closed = sessions.session.close(id).then(unwrapSessionResult); host.emit('exit', 0); await closed;
});

it.each(['default', 'approve', 'decline'] as const)('composition preserves runtime args and chat continue/trust %s without mutating caller material', async projectTrust => {
  const sessions = composeMain(() => {}, { prepareProject });
  const material = { ...runtime, args: ['--model', 'fake-model'] };
  const chat = await sessions.createSession(material, { ...options, startMode: 'continue', projectTrust });
  applySessionStartResult(sessions.session.start(chat.id)); const host = fake.hosts[0]; host.emit('spawn');
  expect(host.postMessage.mock.calls[0][0]).toMatchObject({ type: 'start', executable: '/fake/pi', cwd: '/fake/project', args: ['--model', 'fake-model', '--continue', ...(projectTrust === 'approve' ? ['--approve'] : projectTrust === 'decline' ? ['--no-approve'] : [])] });
  expect(material.args).toEqual(['--model', 'fake-model']);
  const closed = sessions.session.close(chat.id).then(unwrapSessionResult); host.emit('exit', 0); await closed;
});
it('applies pre-session model and thinking selection to the first Chat process using argv values', async () => {
  const sessions = composeMain(() => {}, { prepareProject });
  const chat = await sessions.createSession(runtime, { ...options, initialModel: { provider: 'openai-codex', id: 'gpt-5.5' }, initialThinkingLevel: 'high' });
  applySessionStartResult(sessions.session.start(chat.id)); const host = fake.hosts[0]; host.emit('spawn');
  expect(host.postMessage.mock.calls[0][0]).toMatchObject({ type: 'start', args: ['--session-id', chat.id, '--model', 'openai-codex/gpt-5.5', '--thinking', 'high'] });
  const closed = sessions.session.close(chat.id).then(unwrapSessionResult); host.emit('exit', 0); await closed;
});
