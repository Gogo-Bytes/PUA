import { describe, expect, it, vi } from 'vitest';
import type { DesktopAPI, DesktopBridge } from '../src/shared/ipc/desktop-api';
import { invokeChannels, sendChannels, type InvokeMethod } from '../src/shared/ipc/channels';
import { createIPCRegistrar, checkSender } from '../src/platform/electron/ipc/registrar';
import { DesktopApplicationError, desktopFailure } from '../src/platform/electron/ipc/desktop-errors';
import { createDesktopClient, DesktopClientError } from '../src/renderer/app/desktop-client';
import { desktopSuccess, desktopVoidMethods, isDesktopSessionEvent, parseDesktopResult } from '../src/shared/ipc/desktop-result';
import { requestParsers } from '../src/shared/ipc/schemas';
import { samples, successes } from './desktop-contract-fixtures';
import { preloadFake } from './preload-fake';
import { desktopBridgeFake } from './desktop-bridge-fake';
import { desktopIPCFake } from './desktop-ipc-fake';
import { deferred, fakeWindow } from './app/main/main-fakes';
import type { IpcMainInvokeEvent } from 'electron';

function rawClient(raw: unknown) {
  return createDesktopClient(() => ({ startSession: () => Promise.resolve(raw) }) as unknown as DesktopBridge);
}
function chain() {
  const { fake, window } = fakeWindow();
  const event = { sender: fake.webContents, senderFrame: fake.webContents.mainFrame } as unknown as IpcMainInvokeEvent;
  const invokes = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  const sends = new Map<string, (...args: unknown[]) => void>();
  const listeners = new Set<(event: unknown, value: unknown) => void>();
  const registrar = createIPCRegistrar({ handle: (channel, handler) => { invokes.set(channel, handler); }, on: vi.fn((channel, handler) => { sends.set(channel, handler); }) as unknown as Parameters<typeof createIPCRegistrar>[0]['on'] }, e => checkSender(e, window.webContents, fake.webContents.mainFrame.url));
  const bridge = preloadFake({ invoke: (channel, ...args) => Promise.resolve(invokes.get(channel)!(event, ...args)), send: (channel, ...args) => sends.get(channel)!(event, ...args), on: (_channel, listener) => { listeners.add(listener); }, removeListener: (_channel, listener) => { listeners.delete(listener); } });
  return { registrar, bridge, client: createDesktopClient(() => bridge), listeners, event, invokes };
}

describe('DesktopResult complete registrar -> source preload -> client contract', () => {
  it.each(Object.keys(invokeChannels) as InvokeMethod[])('%s keeps request correlation and success/failure in both directions', async method => {
    const h = chain(); const effect = vi.fn(() => successes[method]);
    // The table is indexed by the same method for argument and result contracts.
    h.registrar.handle(method, effect);
    const call = h.client[method] as (...args: unknown[]) => Promise<unknown>;
    const result = await call(...samples[method]);
    expect(effect).toHaveBeenCalledExactlyOnceWith(...requestParsers[method](samples[method]));
    expect(result).toBe(successes[method]);
    const raw = await h.invokes.get(invokeChannels[method])!(h.event, ...samples[method]);
    expect(raw).toEqual({ ok: true, value: successes[method] === undefined ? null : successes[method] });
    expect(parseDesktopResult(method, raw)?.ok).toBe(true);
    for (const asynchronous of [false, true]) {
      const error = new DesktopApplicationError('DOMAIN_CODE', '业务失败：Error: 保留原文');
      h.registrar.handle(method, () => { if (asynchronous) return Promise.reject(error); throw error; });
      await expect(call(...samples[method])).rejects.toMatchObject({ kind: 'application', code: 'DOMAIN_CODE', message: error.message });
      expect(await h.invokes.get(invokeChannels[method])!(h.event, ...samples[method])).toEqual({ ok: false, error: { kind: 'application', code: 'DOMAIN_CODE', message: error.message } });
    }
  });
  it.each(Object.keys(sendChannels) as (keyof typeof sendChannels)[])('%s stays synchronous and preserves all arguments', method => {
    const h = chain(); const effect = vi.fn(); h.registrar.listen(method, effect);
    const result = (h.client[method] as (...args: unknown[]) => void)(...samples[method]);
    expect(result).toBeUndefined(); expect(effect).toHaveBeenCalledExactlyOnceWith(...samples[method]);
    if (method === 'write') { const paste = '\0\x1b' + 'x'.repeat(8 * 1024 * 1024 + 1); h.client.write('id', paste); expect(effect).toHaveBeenLastCalledWith('id', paste); }
  });
  it('keeps two independent response continuations correlated when completion reverses', async () => {
    const h = chain(); const a = deferred<boolean>(), b = deferred<boolean>();
    h.registrar.handle('closeSession', id => id === 'a' ? a.promise : b.promise);
    const first = h.client.closeSession('a'), second = h.client.closeSession('b');
    b.resolve(false); await expect(second).resolves.toBe(false); a.resolve(true); await expect(first).resolves.toBe(true);
  });
  it('distinguishes unrelated trust failures from exact sender refusal', () => {
    const handlers: ((...args: unknown[]) => unknown)[] = [];
    const registrar = createIPCRegistrar({ handle: (_channel, cb) => { handlers.push(cb as (...args: unknown[]) => unknown); }, on: vi.fn() }, () => { throw new Error('No current window'); });
    registrar.handle('startSession', vi.fn());
    expect(handlers[0]({})).toMatchObject({ ok: false, error: { kind: 'application', code: 'APPLICATION_FAILED', message: 'No current window' } });
  });
});

describe('Desktop client refuses mixed/malformed wire and unsafe failures', () => {
  it.each([undefined, null, false, [], 'legacy', {}, { ok: true }, { ok: 1, value: null }, { ok: 'true', value: null }, { ok: true, value: undefined }, { ok: true, value: false }, { ok: true, value: null, error: {} }, { ok: false }, { ok: false, value: null, error: { kind: 'application', code: 'X', message: 'x' } }, { ok: false, error: { kind: 'transport', code: 'X', message: 'x' } }, { ok: false, error: { kind: 'application', code: '', message: 'x' } }])('refuses %j without legacy success fallback', async raw => {
    await expect(rawClient(raw).startSession('id')).rejects.toMatchObject({ kind: 'protocol', code: 'INVALID_DESKTOP_RESULT' });
  });
  it.each(Object.keys(invokeChannels) as InvokeMethod[])('%s rejects malformed payload rather than trusting the generic envelope', async method => {
    expect(parseDesktopResult(method, { ok: true, value: { arbitrary: 'not a DTO' } })).toBeUndefined();
    expect(desktopSuccess(method, { arbitrary: 'bad host' } as never)).toMatchObject({ ok: false, error: { kind: 'internal', code: 'INVALID_HOST_RESULT' } });
  });
  it('rejects sparse/string-mixed arrays and malformed required metadata/control scalars', () => {
    for (const [method, value] of [
      ['chooseAttachments', new Array(1)], ['chooseAttachments', ['ok', 2]],
      ['chooseChatAttachments', [{ id: 'id', name: 'x', path: 'x', kind: 'file', size: '1' }]],
      ['createSession', { ...successes.createSession, processStatus: 'ready' }],
      ['bootstrap', { ...successes.bootstrap, preferences: { ...successes.bootstrap.preferences, args: [3] } }],
      ['inspectProjectResources', { hasResources: false, paths: [null] }],
      ['gitStatus', { ...successes.gitStatus, files: [null] }], ['fileDiff', { text: '', kind: 'unknown', truncated: false }],
    ] as const) expect(parseDesktopResult(method, { ok: true, value })).toBeUndefined();
  });
  it('does not read unknown message getters/toString/stack or return extra error fields', async () => {
    const toString = vi.fn(() => 'SECRET'); const message = vi.fn(() => 'SECRET');
    const unknown = { toString, get message() { return message(); } };
    expect(desktopFailure(unknown)).toEqual({ ok: false, error: { kind: 'internal', code: 'INTERNAL_FAILURE', message: '桌面操作失败' } });
    const hostError = new Error('safe message'); Object.defineProperty(hostError, 'message', { get() { throw unknown; } });
    expect(desktopFailure(hostError)).toMatchObject({ error: { kind: 'internal', message: '桌面操作失败' } });
    const client = createDesktopClient(() => ({ startSession: () => Promise.reject(unknown) }) as unknown as DesktopBridge);
    await expect(client.startSession('id')).rejects.toMatchObject({ kind: 'transport', message: '桌面连接失败' });
    expect(toString).not.toHaveBeenCalled(); expect(message).not.toHaveBeenCalled();
    const error = await rawClient({ ok: false, error: { kind: 'application', code: 'X', message: '', secret: unknown, stack: 'SECRET' } }).startSession('id').catch(e => e);
    expect(error).toBeInstanceOf(DesktopClientError); expect(String(error)).toBe('Error'); expect(error).not.toHaveProperty('secret'); expect(error.stack).not.toContain('SECRET');
    await expect(rawClient({ get ok() { throw unknown; } }).startSession('id')).rejects.toMatchObject({ kind: 'protocol' });
  });
  it('looks up latest bridge/method/this per request without asyncifying synchronous throw', async () => {
    let current: DesktopBridge | undefined;
    const client = createDesktopClient(() => current);
    expect(() => client.startSession('id')).toThrow(expect.objectContaining({ kind: 'unavailable' }));
    current = { startSession() { expect(this).toBe(current); throw new Error('sync'); } } as unknown as DesktopBridge;
    expect(() => client.startSession('id')).toThrow(expect.objectContaining({ kind: 'transport', message: 'sync' }));
    current.startSession = function () { expect(this).toBe(current); return Promise.resolve({ ok: true, value: null }); };
    await expect(client.startSession('id')).resolves.toBeUndefined();
    current = { startSession: () => Promise.reject(new Error('async')) } as unknown as DesktopBridge;
    let pending!: Promise<void>; expect(() => { pending = client.startSession('id'); }).not.toThrow();
    await expect(pending).rejects.toMatchObject({ kind: 'transport', message: 'async' });
  });
});

describe('Desktop event subscription ownership', () => {
  it('subscribes synchronously, removes exactly one original listener, is idempotent and ignores late delivery', () => {
    const h = chain(); let bridge = h.bridge; const client = createDesktopClient(() => bridge);
    const first = vi.fn(), second = vi.fn(); const off = client.onSessionEvent(first); const late = [...h.listeners][0]; const otherOff = client.onSessionEvent(second);
    const event = { type: 'terminal-data', id: 'id', data: '\0' };
    for (const listener of h.listeners) listener({ electron: 'SECRET' }, event);
    expect(first).toHaveBeenCalledExactlyOnceWith(event); expect(second).toHaveBeenCalledExactlyOnceWith(event);
    const other = chain(); bridge = other.bridge; const newOff = client.onSessionEvent(vi.fn());
    off(); off(); expect(h.listeners.size).toBe(1); expect(other.listeners.size).toBe(1);
    late({}, event); expect(first).toHaveBeenCalledTimes(1); otherOff(); newOff(); expect(h.listeners.size).toBe(0); expect(other.listeners.size).toBe(0);
  });
  it('keeps observer/remover throw identity and inactive state even when remove throws', () => {
    const problem = new Error('observer'); let deliver!: (v: unknown) => void;
    const remove = vi.fn(() => { throw problem; });
    const client = createDesktopClient(() => ({ onSessionEvent(callback: (event: unknown) => void) { deliver = callback; return remove; } }) as unknown as DesktopBridge);
    const observer = vi.fn(() => { throw problem; }); const off = client.onSessionEvent(observer);
    expect(() => deliver({ type: 'exit', id: 'id', exitCode: 0 })).toThrow(problem);
    expect(() => deliver({ type: 'exit', id: 'id', exitCode: '0' })).toThrow(expect.objectContaining({ kind: 'protocol' }));
    expect(observer).toHaveBeenCalledOnce(); expect(() => off()).toThrow(problem); expect(() => off()).not.toThrow();
    expect(() => deliver({ type: 'exit', id: 'id', exitCode: 0 })).not.toThrow(); expect(remove).toHaveBeenCalledOnce(); expect(observer).toHaveBeenCalledOnce();
  });
  it.each([
    { type: 'terminal-data', data: '\0' }, { type: 'session-info', title: '', processStatus: 'running', activity: 'idle' },
    { type: 'chat-state', state: {} }, { type: 'chat-snapshot', snapshot: { activity: 'idle', queue: { steering: [], followUp: [] }, statuses: {}, widgets: [], messages: [], commands: [] } },
    ...['chat-message-start', 'chat-message-end'].map(type => ({ type, message: { id: 'm', role: 'assistant', timestamp: 0, blocks: [] } })),
    { type: 'chat-message-delta', messageId: 'm', blockIndex: 0, blockType: 'text', delta: '' },
    { type: 'chat-tool', tool: { id: 't', name: 'read', arguments: {}, status: 'success', output: '' } },
    ...[{ method: 'select', options: [] }, { method: 'confirm', message: '' }, { method: 'input', placeholder: '' }, { method: 'editor', prefill: '' }].map(request => ({ type: 'extension-ui', request: { id: 'r', title: '', ...request } })),
    { type: 'extension-ui-closed', requestId: 'r' }, { type: 'chat-notice', level: 'info', message: '' },
    { type: 'chat-queue-recovered', requestId: 'r', queue: { steering: [], followUp: [] } }, { type: 'chat-editor-text', text: '' }, { type: 'exit', exitCode: 0 },
  ])('validates event $type without exposing ElectronEvent', body => {
    const h = chain(); const observer = vi.fn(); h.client.onSessionEvent(observer); const listener = [...h.listeners][0]; const event = { ...body, id: 'session' };
    expect(isDesktopSessionEvent(event)).toBe(true); listener({ secret: true }, event); expect(observer).toHaveBeenCalledExactlyOnceWith(event);
    expect(() => listener({}, { ...body, id: null })).toThrow(expect.objectContaining({ kind: 'protocol' })); expect(observer).toHaveBeenCalledOnce();
  });
});

it('preserves stable codes from the three real edge mappers without moving errors into domain', async () => {
  const { unwrapSessionResult } = await import('../src/main/session-mapper');
  const { conversationError } = await import('../src/main/conversation-mapper');
  const { ConversationFailure } = await import('../src/modules/conversation');
  const { reviewError } = await import('../src/platform/electron/ipc/change-review-mapper');
  const { ReviewFailure } = await import('../src/modules/change-review');
  const h = chain();
  for (const [code, effect] of [
    ['SESSION_NOT_FOUND', () => unwrapSessionResult<void>({ ok: false, code: 'SESSION_NOT_FOUND' })],
    ['SEND_PENDING', () => conversationError(new ConversationFailure('SEND_PENDING'))],
    ['STATUS_CHANGED', () => reviewError(new ReviewFailure('STATUS_CHANGED'))],
  ] as const) {
    h.registrar.handle('startSession', effect);
    await expect(h.client.startSession('id')).rejects.toMatchObject({ kind: 'application', code });
  }
});
it('rejects a non-Promise raw invoke and undefined picker host result, and reads Error.message only once', () => {
  const client = createDesktopClient(() => ({ startSession: () => ({ ok: true, value: null }) }) as unknown as DesktopBridge);
  expect(() => client.startSession('id')).toThrow(expect.objectContaining({ kind: 'protocol' }));
  expect(desktopSuccess('chooseDirectory', undefined as never)).toMatchObject({ ok: false, error: { code: 'INVALID_HOST_RESULT' } });
  const error = new Error(); let reads = 0;
  Object.defineProperty(error, 'message', { get() { reads++; return reads === 1 ? 'read once' : {}; } });
  expect(desktopFailure(error)).toEqual({ ok: false, error: { kind: 'application', code: 'APPLICATION_FAILED', message: 'read once' } });
  expect(reads).toBe(1);
});

it('test-only bridge adapter keeps dynamic Fake methods, input/result identity and synchronous throws', async () => {
  const { desktopBridgeFake } = await import('./desktop-bridge-fake');
  const value = successes.bootstrap;
  const api = { bootstrap() { expect(this).toBe(api); return Promise.resolve(value); } } as unknown as import('../src/shared/ipc/desktop-api').DesktopAPI;
  const bridge = desktopBridgeFake(api); const client = createDesktopClient(() => bridge);
  await expect(client.bootstrap()).resolves.toBe(value);
  const unknown = { toString: vi.fn(() => 'never') };
  api.bootstrap = () => { throw unknown; };
  let caught: unknown; try { bridge.bootstrap(); } catch (error) { caught = error; } expect(caught).toBe(unknown);
  expect(() => client.bootstrap()).toThrow(expect.objectContaining({ kind: 'transport', message: '桌面连接失败' }));
  api.bootstrap = () => Promise.reject(unknown);
  await expect(client.bootstrap()).rejects.toMatchObject({ kind: 'internal', code: 'INTERNAL_FAILURE', message: '桌面操作失败' });
  expect(unknown.toString).not.toHaveBeenCalled();
});

describe('test-only bridge adapter picker and void result contract', () => {
  it.each(['chooseFile', 'chooseDirectory'] as const)('%s passes illegal undefined to the real client decoder', async method => {
    // Deliberately malformed application Fake: a picker forgot to return its result.
    const api = { [method]: async () => undefined } as unknown as DesktopAPI;
    const bridge = desktopBridgeFake(api);
    const client = createDesktopClient(() => bridge);
    await expect(client[method]()).rejects.toMatchObject({ kind: 'protocol', code: 'INVALID_DESKTOP_RESULT' });
    await expect(bridge[method]()).resolves.toEqual({ ok: true, value: undefined });
  });
  it.each(['chooseFile', 'chooseDirectory'] as const)('%s preserves explicit null and empty string success', async method => {
    for (const value of [null, '']) {
      const api = { [method]: async () => value } as unknown as DesktopAPI;
      const bridge = desktopBridgeFake(api);
      await expect(bridge[method]()).resolves.toEqual({ ok: true, value });
      await expect(createDesktopClient(() => bridge)[method]()).resolves.toBe(value);
    }
  });
  it.each(Object.keys(desktopVoidMethods) as (keyof typeof desktopVoidMethods)[])('%s alone normalizes void undefined to wire null', async method => {
    const api = { [method]: async () => undefined } as unknown as DesktopAPI;
    const bridge = desktopBridgeFake(api);
    const rawCall = bridge[method] as (...args: unknown[]) => Promise<unknown>;
    const call = createDesktopClient(() => bridge)[method] as (...args: unknown[]) => Promise<void>;
    await expect(rawCall(...samples[method])).resolves.toEqual({ ok: true, value: null });
    await expect(call(...samples[method])).resolves.toBeUndefined();
  });
  it.each(['chooseFile', 'chooseDirectory'] as const)('%s real registration rejects an uncanceled empty dialog result', async method => {
    const h = desktopIPCFake();
    h.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] });
    await expect(h.rawCall(method)).resolves.toMatchObject({ ok: false, error: { kind: 'internal', code: 'INVALID_HOST_RESULT' } });
    await expect(h.client[method]()).rejects.toMatchObject({ kind: 'internal', code: 'INVALID_HOST_RESULT' });
    expect(h.dialog.showOpenDialog).toHaveBeenCalledTimes(2);
  });
});

it.each([
  { type: 'terminal-data', data: 0 }, { type: 'session-info', processStatus: 'ready' },
  { type: 'chat-state', state: { activity: 'busy' } }, { type: 'chat-snapshot', snapshot: { messages: [], commands: [] } },
  { type: 'chat-message-start', message: { id: 'm', blocks: [] } }, { type: 'chat-message-end', message: [] },
  { type: 'chat-message-delta', messageId: 'm', blockIndex: -1, blockType: 'text', delta: '' },
  { type: 'chat-tool', tool: { id: 't', name: 'x', arguments: [], status: 'success', output: '' } },
  { type: 'extension-ui', request: { id: 'r', title: '', method: 'select', options: [3] } },
  { type: 'extension-ui-closed', requestId: null }, { type: 'chat-notice', level: 'debug', message: '' },
  { type: 'chat-queue-recovered', requestId: 'r', queue: { steering: [], followUp: [null] } },
  { type: 'chat-editor-text', text: 0 }, { type: 'exit', exitCode: Infinity }, { type: 'unknown-event' },
])('refuses malformed event control/payload $type without notifying an observer', body => {
  const h = chain(); const observer = vi.fn(); h.client.onSessionEvent(observer); const listener = [...h.listeners][0];
  expect(() => listener({}, { id: 'id', ...body })).toThrow(expect.objectContaining({ kind: 'protocol', code: 'INVALID_DESKTOP_EVENT' }));
  expect(observer).not.toHaveBeenCalled();
});
