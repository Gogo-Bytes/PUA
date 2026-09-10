import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron';
import { checkSender, createIPCRegistrar } from '../src/platform/electron/ipc/registrar';
import { invokeChannels, sendChannels, eventChannels } from '../src/shared/ipc/channels';
import { requestParsers } from '../src/shared/ipc/schemas';
import type { DesktopAPI } from '../src/shared/ipc/desktop-api';

function harness() {
  const invokes = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  const sends = new Map<string, (event: IpcMainEvent, ...args: unknown[]) => void>();
  const rendererURL = 'file:///app/index.html';
  const frame = { url: rendererURL };
  const contents = { mainFrame: frame } as WebContents;
  const event = { sender: contents, senderFrame: frame } as IpcMainInvokeEvent & IpcMainEvent;
  const report = vi.fn();
  const registrar = createIPCRegistrar({
    handle: (channel, handler) => { invokes.set(channel, handler); },
    on: vi.fn((channel, handler) => { sends.set(channel, handler); }) as unknown as Parameters<typeof createIPCRegistrar>[0]['on'],
  }, event => checkSender(event, contents, rendererURL), report);
  return { invokes, sends, event, registrar, report };
}

describe('main IPC registrar', () => {
  it('registers every invoke/send method exactly once in the production entry', () => {
    const source = ts.createSourceFile('register-desktop-ipc.ts', readFileSync(new URL('../src/platform/electron/ipc/register-desktop-ipc.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const registered: Record<'handle' | 'listen', string[]> = { handle: [], listen: [] };
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === 'handle' || node.expression.text === 'listen')) {
        const method = node.arguments[0];
        expect(method && ts.isStringLiteral(method)).toBe(true);
        if (method && ts.isStringLiteral(method)) registered[node.expression.text].push(method.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(registered.handle.sort()).toEqual(Object.keys(invokeChannels).sort());
    expect(registered.listen.sort()).toEqual(Object.keys(sendChannels).sort());
  });
  it('checks window identity, main frame and exact URL before parser or implementation', () => {
    const h = harness(); const callback = vi.fn();
    h.registrar.handle('startSession', callback); h.registrar.listen('write', callback);
    const parse = vi.spyOn(requestParsers, 'startSession');
    const parseSend = vi.spyOn(requestParsers, 'write');
    const foreignMain = { url: h.event.senderFrame!.url };
    const candidates = [
      { ...h.event, sender: { mainFrame: foreignMain }, senderFrame: foreignMain },
      { ...h.event, senderFrame: { url: h.event.senderFrame!.url } },
      { ...h.event, senderFrame: null },
    ];
    for (const candidate of candidates) {
      expect(() => h.invokes.get(invokeChannels.startSession)!(candidate as IpcMainInvokeEvent, null)).toThrow('Untrusted IPC sender');
      expect(() => h.sends.get(sendChannels.write)!(candidate as IpcMainEvent, null, null)).not.toThrow();
    }
    const url = h.event.senderFrame!.url;
    // Same WebContents + same mainFrame, but a changed source (query/hash included).
    for (const source of ['https://untrusted.invalid/', url + '?x', url + '#x', 'file:///app/other.html']) {
      Object.assign(h.event.senderFrame!, { url: source });
      expect(() => h.invokes.get(invokeChannels.startSession)!(h.event, null)).toThrow('Untrusted IPC sender');
      expect(() => h.sends.get(sendChannels.write)!(h.event, null, null)).not.toThrow();
    }
    Object.assign(h.event.senderFrame!, { url });
    expect(parse).not.toHaveBeenCalled(); expect(parseSend).not.toHaveBeenCalled(); expect(callback).not.toHaveBeenCalled();
    expect(h.report).toHaveBeenCalledTimes(candidates.length + 4);
    parse.mockRestore(); parseSend.mockRestore();
  });
  it('rejects malformed tuples before effects and preserves invoke result/errors and send drop/log semantics', async () => {
    const h = harness(); const start = vi.fn(); const write = vi.fn();
    h.registrar.handle('startSession', start); h.registrar.listen('write', write);
    expect(() => h.invokes.get(invokeChannels.startSession)!(h.event, 4)).toThrow('无效字符串');
    expect(() => h.sends.get(sendChannels.write)!(h.event, 'id', 4)).not.toThrow();
    expect(start).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(h.report).toHaveBeenCalledOnce();
    h.invokes.get(invokeChannels.startSession)!(h.event, 'id'); expect(start).toHaveBeenCalledWith('id');
    h.sends.get(sendChannels.write)!(h.event, 'id', '\0'); expect(write).toHaveBeenCalledWith('id', '\0');
    h.registrar.handle('closeSession', async () => false);
    expect(await h.invokes.get(invokeChannels.closeSession)!(h.event, 'id')).toBe(false);
    const error = new Error('domain failure');
    h.registrar.handle('stopChat', async () => { throw error; });
    await expect(h.invokes.get(invokeChannels.stopChat)!(h.event, 'id')).rejects.toBe(error);
    h.registrar.listen('acknowledge', () => { throw error; });
    expect(() => h.sends.get(sendChannels.acknowledge)!(h.event, 'id', 1)).not.toThrow();
    expect(h.report).toHaveBeenLastCalledWith(`IPC ${sendChannels.acknowledge}:`, 'domain failure');
  });
  it('rejects create sender before any asynchronous preparation or core reservation', () => {
    const h = harness(); const prepareProject = vi.fn(); const reserve = vi.fn();
    h.registrar.handle('createSession', async () => { await prepareProject(); return reserve(); });
    const parse = vi.spyOn(requestParsers, 'createSession');
    const options = { cwd: '~/project', kind: 'chat', startMode: 'new', projectTrust: 'default' };
    expect(() => h.invokes.get(invokeChannels.createSession)!({ ...h.event, senderFrame: null }, options)).toThrow('Untrusted IPC sender');
    expect(parse).not.toHaveBeenCalled(); expect(prepareProject).not.toHaveBeenCalled(); expect(reserve).not.toHaveBeenCalled();
    parse.mockRestore();
  });
  it('keeps closeSession and preferences compensation unwrapped; lifecycle outcomes have Fake golden coverage', () => {
    const registration = readFileSync(new URL('../src/platform/electron/ipc/register-desktop-ipc.ts', import.meta.url), 'utf8');
    const preferences = readFileSync(new URL('../src/app/main/desktop-preferences.ts', import.meta.url), 'utf8');
    for (const text of [registration, preferences]) {
      const source = ts.createSourceFile('cleanup.ts', text, ts.ScriptTarget.Latest, true);
      const closes: ts.CallExpression[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && node.expression.getText(source) === 'capabilities.session.close') closes.push(node);
        ts.forEachChild(node, visit);
      };
      visit(source);
      expect(closes).toHaveLength(1);
      expect(closes[0].parent.parent.getText(source)).toMatch(/^unwrapSessionResult\(await capabilities\.session\.close\(/);
    }
    const create = preferences.slice(preferences.indexOf('async createSession'));
    expect(create.indexOf('validateChatArguments')).toBeLessThan(create.indexOf('resolveRuntime'));
    expect(create.indexOf('resolveRuntime')).toBeLessThan(create.indexOf('capabilities.createSession'));
    expect(registration).toContain('createIPCRegistrar(ipcMain, event => checkSender(event, requireCurrent().window.webContents, rendererURL))');
  });
  it('binds method names, arguments and results at compile time', () => {
    const { registrar } = harness();
    if (false) {
      // @ts-expect-error arbitrary channel is not an Interface method
      registrar.handle('desktop:arbitrary', () => undefined);
      // @ts-expect-error id must be a string
      registrar.handle('startSession', (_id: number) => undefined);
      // @ts-expect-error close returns a boolean, not a new wrapper
      registrar.handle('closeSession', () => ({ ok: true }));
      // @ts-expect-error send/invoke categories cannot drift
      registrar.listen('bootstrap', () => undefined);
      // @ts-expect-error parser return must match the method tuple
      requestParsers.resize = () => ['id', '100', 30];
    }
    expect(registrar).toHaveProperty('handle');
  });
});

describe('preload whitelist', () => {
  it('forwards all existing methods and removes the exact event listener on unsubscribe', async () => {
    let api!: DesktopAPI;
    const ipc = { invoke: vi.fn().mockResolvedValue('result'), send: vi.fn(), on: vi.fn(), removeListener: vi.fn() };
    const code = ts.transpileModule(readFileSync(new URL('../src/main/preload.cts', import.meta.url), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    vm.runInNewContext(code, {
      exports: {}, require: (name: string) => {
        if (name === 'electron') return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (key: string, value: DesktopAPI) => { expect(key).toBe('desktop'); api = value; } } };
        if (name === '../shared/ipc/channels.js') return { invokeChannels, sendChannels, eventChannels };
        throw new Error(`Unexpected preload require: ${name}`);
      },
    });
    expect(Object.keys(api).sort()).toEqual([...Object.keys(invokeChannels), ...Object.keys(sendChannels), ...Object.keys(eventChannels)].sort());
    for (const [method, channel] of Object.entries(invokeChannels)) {
      const arity = api[method as keyof typeof invokeChannels].length;
      const args = Array.from({ length: arity }, (_, index) => `arg-${index}`);
      const call = api[method as keyof typeof invokeChannels] as (...args: string[]) => Promise<unknown>;
      expect(await call(...args)).toBe('result'); expect(ipc.invoke).toHaveBeenLastCalledWith(channel, ...args);
    }
    for (const [method, channel] of Object.entries(sendChannels)) {
      const args = Array.from({ length: api[method as keyof typeof sendChannels].length }, (_, index) => `arg-${index}`);
      (api[method as keyof typeof sendChannels] as (...args: string[]) => void)(...args);
      expect(ipc.send).toHaveBeenLastCalledWith(channel, ...args);
    }
    const callback = vi.fn(); const unsubscribe = api.onSessionEvent(callback);
    const [channel, listener] = ipc.on.mock.calls[0];
    expect(channel).toBe(eventChannels.onSessionEvent);
    const event = { type: 'chat-notice', id: 'id', level: 'info', message: 'test' };
    listener({ sender: 'never exposed' }, event); expect(callback).toHaveBeenCalledExactlyOnceWith(event);
    unsubscribe(); expect(ipc.removeListener).toHaveBeenCalledExactlyOnceWith(channel, listener);
  });
});
