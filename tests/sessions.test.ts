import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const hosts = vi.hoisted(() => [] as Array<EventEmitter & { postMessage: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> }>);
vi.mock('electron', () => ({ utilityProcess: { fork: () => {
  const host = Object.assign(new EventEmitter(), { postMessage: vi.fn(), kill: vi.fn() }); hosts.push(host); return host;
} } }));
vi.mock('../src/main/process-tree', () => ({ terminateProcessTree: vi.fn().mockResolvedValue(undefined) }));
import { Sessions } from '../src/main/sessions';
let cwd: string;
const runtime = { executable: process.execPath, source: process.execPath, args: [] };
const options = () => ({ cwd, kind: 'chat' as const, startMode: 'new' as const, projectTrust: 'default' as const });
beforeEach(async () => { cwd = await mkdtemp(path.join(os.tmpdir(), 'pua-sessions-')); hosts.length = 0; });
afterEach(async () => { await rm(cwd, { recursive: true, force: true }); });

describe('session ownership', () => {
  it('closes admission before awaiting shutdown, including creates already validating cwd', async () => {
    const sessions = new Sessions(() => {});
    const chat = await sessions.create(runtime, options()); sessions.start(chat.id);
    const inFlight = sessions.create(runtime, options());
    const closed = sessions.closeAll();
    await expect(inFlight).rejects.toThrow('正在关闭');
    await expect(sessions.create(runtime, options())).rejects.toThrow('正在关闭');
    expect(() => sessions.start(chat.id)).toThrow('正在关闭');
    hosts[0].emit('exit', 0); await closed;
  });
  it('allows startup dialog responses but not prompts before handshake readiness', async () => {
    const sessions = new Sessions(() => {}); const chat = await sessions.create(runtime, options()); sessions.start(chat.id);
    await expect(sessions.sendChatMessage(chat.id, 'not ready', [], 'prompt')).rejects.toThrow('尚未运行');
    const answer = sessions.respondToExtensionUI(chat.id, { id: 'startup', cancelled: true });
    const request = hosts[0].postMessage.mock.calls.at(-1)![0];
    expect(request.type).toBe('extension-response');
    hosts[0].emit('message', { type: 'response', requestId: request.requestId, success: true }); await answer;
    const closed = sessions.closeAll(); hosts[0].emit('exit', 0); await closed;
  });

  it('allows concurrent new chats but waits for restoration to finish before creating new history', async () => {
    const sessions = new Sessions(() => {});
    const restored = await sessions.create(runtime, { ...options(), startMode: 'continue' });
    await expect(sessions.create(runtime, options())).rejects.toThrow('恢复就绪');
    await sessions.close(restored.id);
    const created = await Promise.all([sessions.create(runtime, options()), sessions.create(runtime, options())]);
    expect(created).toHaveLength(2); await sessions.closeAll();
  });
  it('reserves restoration atomically after async path validation', async () => {
    const sessions = new Sessions(() => {});
    const results = await Promise.allSettled([sessions.create(runtime, { ...options(), startMode: 'continue' }), sessions.create(runtime, { ...options(), startMode: 'continue' })]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    await sessions.closeAll();
  });
  it('keeps closing ownership until host termination and excludes all terminals', async () => {
    const sessions = new Sessions(() => {}); const chat = await sessions.create(runtime, options());
    sessions.start(chat.id); hosts[0].emit('spawn');
    hosts[0].emit('message', { type: 'event', event: { type: 'session-info', id: chat.id, processStatus: 'running' } });
    await expect(sessions.create(runtime, { ...options(), kind: 'terminal', cols: 80, rows: 24 })).rejects.toThrow('兼容终端');
    const closing = sessions.close(chat.id);
    await expect(sessions.create(runtime, { ...options(), startMode: 'continue' })).rejects.toThrow('避免');
    hosts[0].emit('exit', 0); await closing;
    const terminal = await sessions.create(runtime, { ...options(), kind: 'terminal', cols: 80, rows: 24 });
    await expect(sessions.create(runtime, options())).rejects.toThrow('兼容终端');
    await sessions.close(terminal.id);
  });
});
describe('attachment ownership and composer routing', () => {
  it('serializes selection budgets, revokes ids, and consumes only submitted ids', async () => {
    const sessions = new Sessions(() => {}); const session = await sessions.create(runtime, options());
    const file = path.join(cwd, 'test.png'); await writeFile(file, 'tiny fixture');
    const results = await Promise.allSettled([sessions.registerAttachments(session.id, [file, file, file]), sessions.registerAttachments(session.id, [file, file])]);
    expect(results[0].status).toBe('fulfilled'); expect(results[1].status).toBe('rejected');
    const selected = results[0].status === 'fulfilled' ? results[0].value : [];
    for (const item of selected.slice(1)) sessions.removeAttachment(session.id, item.id);
    sessions.start(session.id); hosts[0].emit('spawn');
    hosts[0].emit('message', { type: 'event', event: { type: 'session-info', id: session.id, processStatus: 'running' } });
    const sending = sessions.sendChatMessage(session.id, '/extension', [selected[0].id], 'steer');
    const request = hosts[0].postMessage.mock.calls.at(-1)![0];
    expect(request.command).toMatchObject({ type: 'prompt', streamingBehavior: 'steer' });
    const added = await sessions.registerAttachments(session.id, [file]);
    hosts[0].emit('message', { type: 'response', requestId: request.requestId, success: true }); await sending;
    expect(sessions.get(session.id).attachments.has(selected[0].id)).toBe(false);
    expect(sessions.get(session.id).attachments.has(added[0].id)).toBe(true);
    hosts[0].emit('exit', 0); await sessions.closeAll();
  });
});
