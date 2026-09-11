import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const hosts = vi.hoisted(() => [] as Array<EventEmitter & { postMessage: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> }>);
vi.mock('electron', () => ({ utilityProcess: { fork: () => {
  const host = Object.assign(new EventEmitter(), { postMessage: vi.fn(), kill: vi.fn() }); hosts.push(host); return host;
} } }));
vi.mock('../src/platform/process/process-tree', () => ({ terminateProcessTree: vi.fn().mockResolvedValue(undefined) }));
import { composeMain } from '../src/app/main/composition';
import { applySessionStartResult, unwrapSessionResult } from '../src/app/main/session-mapper';
import { conversationError, extensionResponse, sendIntent } from '../src/app/main/conversation-mapper';
let cwd: string;
const runtime = { executable: process.execPath, source: process.execPath, args: [] };
const options = () => ({ cwd, kind: 'chat' as const, startMode: 'new' as const, projectTrust: 'default' as const });
beforeEach(async () => { cwd = await mkdtemp(path.join(os.tmpdir(), 'pua-sessions-')); hosts.length = 0; });
afterEach(async () => { await rm(cwd, { recursive: true, force: true }); });

describe('session ownership', () => {
  it('closes admission before awaiting shutdown, including creates already validating cwd', async () => {
    const sessions = composeMain(() => {});
    const chat = await sessions.createSession(runtime, options()); applySessionStartResult(sessions.session.start(chat.id));
    const inFlight = sessions.createSession(runtime, options());
    const closed = sessions.session.closeAll().then(unwrapSessionResult);
    await expect(inFlight).rejects.toThrow('正在关闭');
    await expect(sessions.createSession(runtime, options())).rejects.toThrow('正在关闭');
    expect(() => applySessionStartResult(sessions.session.start(chat.id))).toThrow('正在关闭');
    hosts[0].emit('exit', 0); await closed;
  });
  it('allows startup dialog responses but not prompts before handshake readiness', async () => {
    const sessions = composeMain(() => {}); const chat = await sessions.createSession(runtime, options()); applySessionStartResult(sessions.session.start(chat.id));
    await expect(sessions.conversation.send(chat.id, sendIntent('not ready', [], 'prompt')).catch(conversationError)).rejects.toThrow('尚未运行');
    const answer = sessions.conversation.respond(chat.id, extensionResponse({ id: 'startup', cancelled: true }));
    const request = hosts[0].postMessage.mock.calls.at(-1)![0];
    expect(request.type).toBe('extension-response');
    hosts[0].emit('message', { type: 'response', requestId: request.requestId, success: true }); await answer;
    const closed = sessions.session.closeAll().then(unwrapSessionResult); hosts[0].emit('exit', 0); await closed;
  });

  it('allows concurrent new chats but waits for restoration to finish before creating new history', async () => {
    const sessions = composeMain(() => {});
    const restored = await sessions.createSession(runtime, { ...options(), startMode: 'continue' });
    await expect(sessions.createSession(runtime, options())).rejects.toThrow('恢复就绪');
    await sessions.session.close(restored.id).then(unwrapSessionResult);
    const created = await Promise.all([sessions.createSession(runtime, options()), sessions.createSession(runtime, options())]);
    expect(created).toHaveLength(2); await sessions.session.closeAll().then(unwrapSessionResult);
  });
  it('reserves restoration atomically after async path validation', async () => {
    const sessions = composeMain(() => {});
    const results = await Promise.allSettled([sessions.createSession(runtime, { ...options(), startMode: 'continue' }), sessions.createSession(runtime, { ...options(), startMode: 'continue' })]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    await sessions.session.closeAll().then(unwrapSessionResult);
  });
  it('keeps closing ownership until host termination and excludes all terminals', async () => {
    const sessions = composeMain(() => {}); const chat = await sessions.createSession(runtime, options());
    applySessionStartResult(sessions.session.start(chat.id)); hosts[0].emit('spawn');
    hosts[0].emit('message', { type: 'event', event: { type: 'session-info', id: chat.id, processStatus: 'running' } });
    await expect(sessions.createSession(runtime, { ...options(), kind: 'terminal', cols: 80, rows: 24 })).rejects.toThrow('兼容终端');
    const closing = sessions.session.close(chat.id).then(unwrapSessionResult);
    await expect(sessions.createSession(runtime, { ...options(), startMode: 'continue' })).rejects.toThrow('避免');
    hosts[0].emit('exit', 0); await closing;
    const terminal = await sessions.createSession(runtime, { ...options(), kind: 'terminal', cols: 80, rows: 24 });
    await expect(sessions.createSession(runtime, options())).rejects.toThrow('兼容终端');
    await sessions.session.close(terminal.id).then(unwrapSessionResult);
  });
});
describe('attachment ownership and composer routing', () => {
  it('serializes selection budgets, revokes ids, and consumes only submitted ids', async () => {
    const sessions = composeMain(() => {}); const session = await sessions.createSession(runtime, options());
    const file = path.join(cwd, 'test.png'); await writeFile(file, 'tiny fixture');
    const results = await Promise.allSettled([sessions.registerChatAttachments(session.id, [file, file, file]), sessions.registerChatAttachments(session.id, [file, file])]);
    expect(results[0].status).toBe('fulfilled'); expect(results[1].status).toBe('rejected');
    const selected = results[0].status === 'fulfilled' ? results[0].value : [];
    for (const item of selected.slice(1)) sessions.conversation.removeAttachment(session.id, item.id);
    applySessionStartResult(sessions.session.start(session.id)); hosts[0].emit('spawn');
    hosts[0].emit('message', { type: 'event', event: { type: 'session-info', id: session.id, processStatus: 'running' } });
    const sending = sessions.conversation.send(session.id, sendIntent('/extension', [selected[0].id], 'steer')).catch(conversationError);
    const request = hosts[0].postMessage.mock.calls.at(-1)![0];
    expect(request).toMatchObject({ type: 'send', queuePreference: 'steer' });
    const added = await sessions.registerChatAttachments(session.id, [file]);
    hosts[0].emit('message', { type: 'response', requestId: request.requestId, success: true }); await sending;
    await expect(sessions.conversation.send(session.id, sendIntent('used', [selected[0].id], 'prompt')).catch(conversationError)).rejects.toThrow('附件已失效');
    const nextSend = sessions.conversation.send(session.id, sendIntent('new attachment', [added[0].id], 'prompt')).catch(conversationError);
    const nextRequest = hosts[0].postMessage.mock.calls.at(-1)![0];
    hosts[0].emit('message', { type: 'response', requestId: nextRequest.requestId, success: true }); await nextSend;
    hosts[0].emit('exit', 0); await sessions.session.closeAll().then(unwrapSessionResult);
  });
});
