/** @vitest-environment jsdom */
import { installDesktopFake } from './desktop-bridge-fake';
import type { DesktopAPI } from '../src/shared/ipc/desktop-api';
let desktop: DesktopAPI;
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import vm from 'node:vm';
import ts from 'typescript';
import { useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { VirtuosoMockContext } from 'react-virtuoso';
import { afterEach, expect, it, vi } from 'vitest';
import * as conversation from '../src/modules/conversation';
import * as schemas from '../src/shared/ipc/worker-schemas';
import * as runtimeMapper from '../src/platform/pi/rpc/conversation-runtime-mapper';
import * as streamMapper from '../src/platform/pi/rpc/conversation-stream-mapper';
import * as normalize from '../src/platform/pi/rpc/chat-normalize';
import * as jsonl from '../src/platform/pi/rpc/jsonl';
import * as piResponse from '../src/platform/pi/rpc/pi-response';
import * as diagnosticModule from '../src/shared/missing-assistant-diagnostics';
import { ChatPane, reduceChatEvent, emptyChatState } from '../src/renderer/features/conversation';
import { windowEventEmitter } from '../src/app/main/create-window';
import type { BrowserWindow } from 'electron';
import type { SessionEvent } from '../src/shared/chat';
import type { RpcWorkerOutput } from '../src/shared/ipc/worker-protocol';

const platform = vi.hoisted(() => ({ fork: vi.fn(), tree: vi.fn().mockResolvedValue(undefined) }));
vi.mock('electron', () => ({ utilityProcess: { fork: platform.fork } }));
// jsdom/Vite rewrites import.meta.url to HTTP; fork is fake, so only these
// two composition worker URLs are converted to artificial filesystem paths.
vi.mock('node:url', () => {
  const module = { fileURLToPath: (url: URL) => {
    if (!/\/app\/workers\/(pi-rpc|pty)\.worker\.(js|ts)$/.test(url.pathname)) throw new Error(`Unexpected worker URL: ${url.pathname}`);
    return `/fake${url.pathname}`;
  } };
  return { ...module, default: module };
});
vi.mock('../src/platform/process/process-tree', () => ({ terminateProcessTree: platform.tree }));
vi.mock('node:fs/promises', () => {
  const forbidden = () => { throw new Error('Forbidden product filesystem'); };
  const fs = { stat: async (path: string) => { if (path !== '/fake/submitted.txt') return forbidden(); return { isFile: () => true, size: 12 }; }, open: forbidden };
  return { ...fs, default: fs };
});
vi.mock('../src/platform/pi/process/environment', () => ({ runtimeEnvironment: () => ({}), terminalEnvironment: () => { throw new Error('No terminal in replay'); } }));
import { composeMain } from '../src/app/main/composition';
import { applySessionStartResult } from '../src/app/main/session-mapper';
import { sendIntent } from '../src/app/main/conversation-mapper';

// Read repository source only. Never import/execute the installed Pi or read session files in tests.
const sources: Record<string, string> = {
  'rpc-host': readFileSync(`${process.cwd()}/src/app/workers/pi-rpc.worker.ts`, 'utf8'),
  'rpc-writer': readFileSync(`${process.cwd()}/src/platform/pi/rpc/writer.ts`, 'utf8'),
};
const turns = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function workerReplay() {
  let sequence = 0;
  const timers = new Map<object, { callback: () => void; delay: number }>();
  const setTimer = (callback: () => void, delay: number) => { const timer = { unref() {} }; timers.set(timer, { callback, delay }); return timer; };
  const clearTimer = (timer: object) => { timers.delete(timer); };
  const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  const writes: Array<Record<string, unknown>> = [];
  child.stdin.on('data', data => writes.push(JSON.parse(data.toString())));
  const wire: RpcWorkerOutput[] = [];
  const host = Object.assign(new EventEmitter(), { stdout: new PassThrough(), postMessage: (data: unknown) => port.emit('message', { data }), kill: vi.fn() });
  const env: Record<string, string | undefined> = {};
  const port = Object.assign(new EventEmitter(), { postMessage: (message: RpcWorkerOutput) => { const detached = structuredClone(message); wire.push(detached); host.emit('message', detached); } });
  const imports: Record<string, unknown> = {
    '../../shared/ipc/worker-schemas.js': schemas, '../../modules/conversation/index.js': conversation,
    '../../shared/missing-assistant-diagnostics.js': diagnosticModule,
    '../../platform/pi/rpc/conversation-runtime-mapper.js': runtimeMapper, '../../platform/pi/rpc/conversation-stream-mapper.js': streamMapper,
    '../../platform/pi/rpc/chat-normalize.js': normalize, '../../platform/pi/rpc/jsonl.js': jsonl, '../../platform/pi/rpc/pi-response.js': piResponse,
    '../../platform/process/process-tree.js': { terminateProcessTree: platform.tree },
    'node:child_process': { spawn: () => child }, 'node:crypto': { randomUUID: () => `fake-${++sequence}` },
  };
  const exits: number[] = [];
  function evaluate(name: string) {
    const exports = {};
    const js = ts.transpileModule(sources[name], { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(js, { exports, Buffer, setTimeout: setTimer, clearTimeout: clearTimer,
      process: { parentPort: port, platform: 'darwin', env, exit: (code: number) => exits.push(code) },
      console: { info: (line: string) => host.stdout.write(`${line}\n`) },
      require: (name: string) => { if (!(name in imports)) throw new Error(`Forbidden VM import: ${name}`); return imports[name]; },
    }, { filename: `source-replay/${name}.ts`, timeout: 1000 });
    return exports;
  }
  imports['../../platform/pi/rpc/writer.js'] = evaluate('rpc-writer');
  evaluate('rpc-host');
  const incoming = (value: unknown) => child.stdout.write(Buffer.from(`${JSON.stringify(value)}\n`));
  const response = (command: string, data?: unknown) => {
    const request = writes.findLast(value => value.type === command);
    expect(request, `worker sent ${command}`).toBeDefined();
    incoming({ id: request!.id, type: 'response', command, success: true, data });
  };
  return { host, child, incoming, response, wire, writes, exits, timers, env,
    tickFragments: () => { for (const [id, timer] of [...timers]) if (timer.delay === 24) { timers.delete(id); timer.callback(); } },
  };
}
afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// Pi 0.85.1 source contract: modes/rpc/rpc-mode.js -> toJsonEvent;
// modes/json-event.js keeps start/end.message and strips update.message/partial.
// The designated JSONL line 5 proves ONLY the final assistant content/stopReason,
// not a wire trace. Timestamps, user text and scheduling below are synthetic.
const assistant = { role: 'assistant', content: [{ type: 'text', text: 'PUA_ACCEPTANCE_OK' }], stopReason: 'stop', timestamp: 200 };
const user = { role: 'user', content: [{ type: 'text', text: 'acceptance request' }], timestamp: 100 };

it.each([false, true])('source-contract replay (diagnostics=%s): send -> final -> idle keeps assistant text in its actual ChatPane DOM', async enabled => {
  vi.stubGlobal('process', Object.create(process, { env: { value: enabled ? { PUA_MISSING_ASSISTANT_DIAGNOSTICS: 'next-chat', PATH: '/fake/bin' } : {} } }));
  const logs = vi.spyOn(console, 'info').mockImplementation(() => {});
  if (enabled) sessionStorage.setItem('PUA_MISSING_ASSISTANT_DIAGNOSTIC_SESSION', 'acceptance-session');
  // Only the main request watchdog uses this timer; no wall clock or process work.
  vi.spyOn(globalThis, 'setInterval').mockImplementation((() => ({ unref() {} })) as unknown as typeof setInterval);
  vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});
  const worker = workerReplay();
  platform.fork.mockImplementation((_file, _args, options) => {
    worker.env.PUA_MISSING_ASSISTANT_DIAGNOSTIC_SESSION = options.env?.PUA_MISSING_ASSISTANT_DIAGNOSTIC_SESSION;
    expect(options.env?.PUA_MISSING_ASSISTANT_DIAGNOSTICS).toBeUndefined();
    return worker.host;
  });
  const listeners = new Set<(event: SessionEvent) => void>();
  const forwarded: SessionEvent[] = [];
  let projection = emptyChatState();
  const forward = windowEventEmitter({ isDestroyed: () => false, webContents: { send: (_channel: string, event: SessionEvent) => {
    forwarded.push(event); projection = reduceChatEvent(projection, event);
    for (const listener of listeners) listener(structuredClone(event));
  } } } as unknown as BrowserWindow);
  const main = composeMain(forward, { createId: () => 'acceptance-session', prepareProject: async () => ({ cwd: '/fake/project', title: 'Fake' }) });
  const session = await main.createSession({ executable: '/fake/pi', source: '/fake/pi', args: [] }, { cwd: '/fake/project', kind: 'chat', startMode: 'new', projectTrust: 'default' });
  desktop = installDesktopFake({
    onSessionEvent: callback => { listeners.add(callback); return () => { listeners.delete(callback); }; },
    startSession: async id => { applySessionStartResult(main.session.start(id)); },
    sendChatMessage: async (id, input) => { await main.conversation.send(id, sendIntent(input.text, input.attachmentIds, input.delivery)); },
  } as DesktopAPI);
  function Pane() {
    const [draft, setDraft] = useState('acceptance request');
    return <VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 80 }}><ChatPane session={{ ...session, processStatus: 'running' }} active draft={draft} onDraftChange={setDraft} onCommands={() => {}} onError={error => { throw new Error(error); }} /></VirtuosoMockContext.Provider>;
  }
  const view = render(<Pane />);
  await act(async () => {
    worker.host.emit('spawn'); worker.child.emit('spawn'); await turns();
    worker.response('get_state', { isStreaming: false }); worker.response('get_messages', { messages: [] }); worker.response('get_commands', { commands: [] }); await turns();
  });
  fireEvent.keyDown(view.getByRole('textbox', { name: '发送消息' }), { key: 'Enter' });
  await act(async () => {
    await turns(); worker.response('prompt');
    worker.incoming({ type: 'agent_start' });
    worker.incoming({ type: 'message_start', message: user }); worker.incoming({ type: 'message_end', message: user });
    worker.incoming({ type: 'message_start', message: { ...assistant, content: [] } });
    worker.incoming({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'PUA_ACCEPTANCE_OK' } });
    worker.incoming({ type: 'message_end', message: assistant });
    worker.incoming({ type: 'agent_end', messages: [assistant] }); worker.incoming({ type: 'agent_settled' });
    await turns();
  });
  const final = worker.wire.filter(value => value.type === 'event' && value.event.type === 'chat-message-end' && value.event.message.role === 'assistant');
  expect(final, 'worker final with assistant body').toHaveLength(1);
  expect(forwarded.some(event => event.type === 'chat-message-end' && event.message.role === 'assistant'), 'main forwarded assistant').toBe(true);
  expect(projection.messages.filter(message => message.role === 'assistant')[0]?.blocks, 'reducer assistant body after idle').toEqual([{ type: 'text', text: 'PUA_ACCEPTANCE_OK' }]);
  expect(view.container.querySelector('.chat-meta')?.textContent).toContain('Pi 已就绪');
  expect(view.container.querySelector('[data-session-id="acceptance-session"] .chat-message.user .message-body')?.textContent).toBe('acceptance request');
  expect(view.container.querySelector('[data-session-id="acceptance-session"] .chat-message.assistant .message-body')?.textContent, 'assistant body remains visible after final -> idle').toBe('PUA_ACCEPTANCE_OK');
  expect(worker.exits).toEqual([]);
  expect(worker.timers.size).toBe(0);
  // Duplicate normalized final is idempotent, while a forged cross-session
  // utility event and a renderer event for another pane must not alter this pane.
  const duplicate = final[0];
  const beforeCross = forwarded.length;
  await act(async () => {
    worker.host.emit('message', { type: 'event', event: { type: 'chat-message-end', id: 'other-session', message: { id: 'wrong', role: 'assistant', blocks: [{ type: 'text', text: 'WRONG_SESSION' }], timestamp: 1 } } });
    for (const listener of listeners) listener({ type: 'chat-message-end', id: 'other-session', message: { id: 'wrong', role: 'assistant', blocks: [{ type: 'text', text: 'WRONG_SESSION' }], timestamp: 1 } });
    await turns();
  });
  expect(forwarded).toHaveLength(beforeCross);
  await act(async () => { worker.host.emit('message', duplicate); await turns(); });
  expect(view.container.querySelectorAll('.chat-message.assistant')).toHaveLength(1);
  expect(view.container.textContent).not.toContain('WRONG_SESSION');
  if (enabled) {
    const entries = logs.mock.calls.map(([line]) => JSON.parse(String(line).slice(diagnosticModule.missingAssistantDiagnosticPrefix.length)));
    for (const stage of ['worker-received', 'worker-emitted', 'main-accepted', 'main-forwarded', 'renderer-received', 'renderer-reduced']) {
      expect(entries.some(entry => entry.stage === stage && entry.marker === true), stage).toBe(true);
    }
    expect(logs.mock.calls.flat().join('')).not.toContain('acceptance request');
    expect(logs.mock.calls.flat().join('')).not.toContain('PUA_ACCEPTANCE_OK');
  } else expect(logs).not.toHaveBeenCalled();
  await act(async () => {
    const closing = main.session.close(session.id);
    const beforeLate = forwarded.length;
    worker.host.emit('message', duplicate);
    worker.incoming({ type: 'message_end', message: { ...assistant, content: [{ type: 'text', text: 'LATE' }] } });
    expect(forwarded).toHaveLength(beforeLate);
    worker.host.emit('exit', 0); await closing; await turns();
  });
  expect(view.container.querySelector('.chat-message.assistant .message-body')?.textContent).toBe('PUA_ACCEPTANCE_OK');
});


// Real worker -> utility parser -> Conversation token owner -> ChatPane failure continuation.
// These malformed ACKs exposed a protocol gap, not the cause of the user's P0.
it.each([
  ['missing', {}], ['null', { success: null }], ['string', { success: 'true' }],
  ['wrong-command', { command: 'abort', success: true }],
] as const)('strict Pi send chain: %s ACK preserves submitted draft/chip/token until an explicit legal retry', async (_label, fields) => {
  vi.spyOn(globalThis, 'setInterval').mockImplementation((() => ({ unref() {} })) as unknown as typeof setInterval);
  vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});
  const worker = workerReplay(); platform.fork.mockReturnValue(worker.host);
  const listeners = new Set<(event: SessionEvent) => void>();
  const main = composeMain(event => { for (const listener of listeners) listener(event); }, {
    createId: () => 'strict-session', prepareProject: async () => ({ cwd: '/fake/project', title: 'Fake' }),
  });
  const session = await main.createSession({ executable: '/fake/pi', source: '/fake/pi', args: [] }, { cwd: '/fake/project', kind: 'chat', startMode: 'new', projectTrust: 'default' });
  const errors: string[] = []; const submitted: string[][] = [];
  desktop = installDesktopFake({
    onSessionEvent: callback => { listeners.add(callback); return () => { listeners.delete(callback); }; },
    startSession: async id => { applySessionStartResult(main.session.start(id)); },
    chooseChatAttachments: async id => main.registerChatAttachments(id, ['/fake/submitted.txt']),
    sendChatMessage: async (id, input) => { submitted.push(input.attachmentIds); await main.conversation.send(id, sendIntent(input.text, input.attachmentIds, input.delivery)); },
  } as DesktopAPI);
  function Pane() {
    const [draft, setDraft] = useState('keep submitted draft');
    return <VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 80 }}><ChatPane session={{ ...session, processStatus: 'running' }} active draft={draft} onDraftChange={setDraft} onCommands={() => {}} onError={error => errors.push(error)} /></VirtuosoMockContext.Provider>;
  }
  const view = render(<Pane />);
  await act(async () => {
    worker.host.emit('spawn'); worker.child.emit('spawn'); await turns();
    worker.response('get_state', {}); worker.response('get_messages', { messages: [] }); worker.response('get_commands', { commands: [] }); await turns();
  });
  await act(async () => { fireEvent.click(view.getByRole('button', { name: '添加附件' })); await turns(); });
  const textbox = view.getByRole('textbox', { name: '发送消息' }) as HTMLTextAreaElement;
  fireEvent.keyDown(textbox, { key: 'Enter' });
  await act(async () => {
    await turns(); const request = worker.writes.findLast(value => value.type === 'prompt')!;
    worker.incoming({ type: 'response', id: request.id, command: 'prompt', ...fields }); await turns();
  });
  expect.soft(errors, 'malformed Pi ACK must reject the real main send').toHaveLength(1);
  expect.soft(errors).toEqual([expect.stringContaining('Pi RPC protocol error')]);
  expect.soft(textbox.value, 'submitted draft is not cleared').toBe('keep submitted draft');
  expect.soft(view.queryByRole('button', { name: '移除 submitted.txt' }), 'submitted chip is not consumed').not.toBeNull();
  expect.soft(worker.wire.filter(value => value.type === 'response').map(value => value.success), 'utility cannot manufacture success').toEqual([false]);
  expect(worker.timers.size).toBe(0); expect(worker.exits).toEqual([]);
  fireEvent.keyDown(textbox, { key: 'Enter' });
  await act(async () => { await turns(); worker.response('prompt'); await turns(); });
  expect(submitted).toHaveLength(2); expect(submitted[1]).toEqual(submitted[0]); expect(submitted[0]).toHaveLength(1);
  expect(worker.writes.filter(value => value.type === 'prompt')).toHaveLength(2);
  expect(errors).toHaveLength(1); expect(textbox.value).toBe(''); expect(view.queryByRole('button', { name: '移除 submitted.txt' })).toBeNull();
  // The same token now fails at the real owner rather than reaching Pi again.
  await expect(main.conversation.send(session.id, sendIntent('again', submitted[0], 'prompt'))).rejects.toMatchObject({ code: 'ATTACHMENT_EXPIRED' });
  expect(worker.writes.filter(value => value.type === 'prompt')).toHaveLength(2);
  await act(async () => { const closing = main.session.close(session.id); worker.host.emit('exit', 0); await closing; await turns(); });
});
