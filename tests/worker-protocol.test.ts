import { describe, expect, it } from 'vitest';
import { parseRpcWorkerInput, parseRpcWorkerOutput, parsePtyWorkerInput, parsePtyWorkerOutput } from '../src/shared/ipc/worker-schemas';
import type { RpcWorkerInput, RpcWorkerOutput, PtyWorkerInput, PtyWorkerOutput, WorkerInputPort } from '../src/shared/ipc/worker-protocol';
import type { Terminal } from '../src/main/terminal';
import type { ExtensionUIRequest } from '../src/shared/chat';

// Compile-time callers use the real port Interface, not assertion casts. Never executed.
function negativeCallers(rpc: WorkerInputPort<RpcWorkerInput>, pty: WorkerInputPort<PtyWorkerInput>, terminal: Terminal) {
  rpc.postMessage({ type: 'stop', requestId: 'r' });
  // @ts-expect-error Pi commands are not a main-to-worker capability
  rpc.postMessage({ type: 'command', requestId: 'r', command: { type: 'switch_session' } });
  // @ts-expect-error request correlation is required
  rpc.postMessage({ type: 'stop' });
  // @ts-expect-error raw prompt fields are not a semantic send
  rpc.postMessage({ type: 'send', requestId: 'r', command: { type: 'prompt' } });
  // @ts-expect-error wrong worker direction
  rpc.postMessage({ type: 'response', requestId: 'r', success: true });
  // @ts-expect-error wrong worker capability
  pty.postMessage({ type: 'rename', requestId: 'r', name: 'title' });
  // @ts-expect-error terminal does not expose ownership or process handles
  terminal.close('s');
  const output = (value: RpcWorkerOutput | PtyWorkerOutput) => value;
  // @ts-expect-error failed responses require an error
  output({ type: 'response', requestId: 'r', success: false });
  // @ts-expect-error no raw Pi acknowledgement payload
  output({ type: 'response', requestId: 'r', success: true, data: {} });
  // @ts-expect-error event cannot carry terminal data
  output({ type: 'event', event: { type: 'terminal-data', id: 's', data: 'x' } });
}
void negativeCallers;

const launch = { executable: 'fake', args: ['', '--option'], cwd: '/fake', env: { TERM: 'xterm' } };
const send = { type: 'send', requestId: 'r', text: '', filePaths: [], images: [], queuePreference: 'steer' } satisfies RpcWorkerInput;
describe('worker-protocol input capability parsers', () => {
  it.each<RpcWorkerInput>([
    { type: 'start', id: 's', ...launch }, send, { type: 'stop', requestId: 'r' },
    { type: 'rename', requestId: 'r', name: '' }, { type: 'close' },
    { type: 'extension-response', requestId: 'r', response: { id: 'd', value: '' } },
    { type: 'extension-response', requestId: 'r', response: { id: 'd', confirmed: false } },
    { type: 'extension-response', requestId: 'r', response: { id: 'd', cancelled: true } },
  ])('accepts and rebuilds RPC $type', message => {
    expect(parseRpcWorkerInput(message)).toEqual({ ok: true, message });
  });
  it.each<PtyWorkerInput>([
    { type: 'start', ...launch, cols: 80, rows: 24 }, { type: 'write', data: '\0\x1b[31m' },
    { type: 'resize', cols: 100, rows: 30 }, { type: 'ack', size: 2 }, { type: 'close' },
  ])('accepts PTY $type', message => { expect(parsePtyWorkerInput(message)).toEqual(message); });
  it.each([
    null, [], 'close', {}, { type: 'start', id: 's', ...launch, args: [1] },
    { type: 'start', id: 's', ...launch, env: { BAD: 1 } }, { type: 'stop' }, { type: 'stop', requestId: '' },
    { type: 'command', requestId: 'r', command: { type: 'switch_session' } },
    { type: 'response', requestId: 'r', success: true }, { type: 'write', data: 'external effect' },
    { ...send, text: null }, { ...send, filePaths: Array(1) }, { ...send, images: Array(1) },
    { ...send, images: [{ data: 'aA==', mimeType: 1 }] }, { ...send, queuePreference: 'prompt' },
    { type: 'rename', requestId: 'r', name: 1 },
  ])('rejects malformed or wrong-direction RPC %j', raw => { expect(parseRpcWorkerInput(raw).ok).toBe(false); });
  it.each([null, [], {}, send, { type: 'data', data: 'wrong direction' },
    { type: 'write', data: 1 }, { type: 'resize', cols: 1, rows: 24 }, { type: 'resize', cols: 80, rows: Infinity },
    { type: 'ack', size: 0 }, { type: 'ack', size: -1 }, { type: 'ack', size: 1.5 },
    { type: 'start', ...launch, cols: 80, rows: 24, env: [] },
  ])('rejects malformed PTY %j', raw => { expect(parsePtyWorkerInput(raw)).toBeUndefined(); });
  it('retains correlation and original extension error; strips extra Pi type fields', () => {
    expect(parseRpcWorkerInput({ type: 'extension-response', requestId: 'r', response: { id: 'd', value: '', cancelled: true } }))
      .toEqual({ ok: false, requestId: 'r', error: 'Error: 扩展响应需要唯一结果' });
    expect(parseRpcWorkerInput({ type: 'extension-response', requestId: 'r', response: { id: 'd', cancelled: true, type: 'switch_session' } }))
      .toEqual({ ok: true, message: { type: 'extension-response', requestId: 'r', response: { id: 'd', cancelled: true } } });
  });
  it('adds no limits or byte conversions to authorized large text/image/path payloads', () => {
    const large = '\0文'.repeat(1024 * 1024);
    expect(parsePtyWorkerInput({ type: 'write', data: large })).toEqual({ type: 'write', data: large });
    const message = { ...send, text: large, filePaths: [large], images: [{ data: large, mimeType: 'image/png' }] };
    expect(parseRpcWorkerInput(message)).toEqual({ ok: true, message });
  });
});
describe('worker-protocol extension-ui request parser', () => {
  const common = { id: 'dialog', title: '' };
  const requests: ExtensionUIRequest[] = [
    { ...common, method: 'select', options: [] },
    { ...common, method: 'select', options: ['', '文\0'] },
    { ...common, method: 'confirm', message: '' },
    { ...common, method: 'input' }, { ...common, method: 'input', placeholder: '' },
    { ...common, method: 'editor' }, { ...common, method: 'editor', prefill: '文\0' },
  ];
  const envelope = (request: unknown, id = 's') => ({ type: 'event', event: { type: 'extension-ui', id, request } });
  it.each(requests)('preserves valid $method fields, optional deadlines and session binding', request => {
    // Deadlines are finite timestamps, not positive durations or safe integers.
    for (const expiresAt of [undefined, 0, -1, 0.5, 1_700_000_000_000, Number.MAX_VALUE]) {
      const message = envelope({ ...request, expiresAt });
      expect(parseRpcWorkerOutput(message, 's')).toEqual(message);
      expect(parseRpcWorkerOutput(message, 'other')).toBeUndefined();
    }
    expect(parseRpcWorkerOutput(envelope(request), 's')).toEqual(envelope(request));
  });
  it.each([
    { label: 'missing select options', request: { ...common, method: 'select' } },
    { label: 'missing confirm message', request: { ...common, method: 'confirm' } },
    ...[null, undefined, [], 'request', 1, true].map(request => ({ label: `request ${String(request)}`, request })),
    ...[null, 1, true, 'options', {}, { 0: 'a', length: 1 }, [1], ['a', null], [['a']], Array(1), ['a', , 'b']]
      .map(options => ({ label: `select options ${String(options)}`, request: { ...common, method: 'select', options } })),
    ...[null, 1, true, [], {}, ['message']]
      .map(message => ({ label: `confirm message ${String(message)}`, request: { ...common, method: 'confirm', message } })),
    ...requests.flatMap(request => [null, NaN, Infinity, -Infinity, '0', [], {}, true]
      .map(expiresAt => ({ label: `${request.method} expiresAt ${String(expiresAt)}`, request: { ...request, expiresAt } }))),
    ...[null, 1, true, [], {}].flatMap(value => [
      { label: `input placeholder ${String(value)}`, request: { ...common, method: 'input', placeholder: value } },
      { label: `editor prefill ${String(value)}`, request: { ...common, method: 'editor', prefill: value } },
    ]),
    ...[undefined, null, 1, true, [], {}].flatMap(value => [
      { label: `id ${String(value)}`, request: { ...common, method: 'input', id: value } },
      { label: `title ${String(value)}`, request: { ...common, method: 'input', title: value } },
      { label: `method ${String(value)}`, request: { ...common, method: value } },
    ]),
    { label: 'empty id', request: { ...common, method: 'input', id: '' } },
    { label: 'unknown method', request: { ...common, method: 'custom' } },
  ])('rejects $label before returning a typed event', ({ request }) => {
    expect(parseRpcWorkerOutput(envelope(request), 's')).toBeUndefined();
    expect(parseRpcWorkerOutput(envelope(request, 'other'), 's')).toBeUndefined();
  });
});

describe('worker-protocol output envelope parsers', () => {
  it.each<RpcWorkerOutput>([
    { type: 'child-pid', pid: 7 }, { type: 'response', requestId: 'r', success: true },
    { type: 'response', requestId: 'r', success: false, error: '' },
    { type: 'event', event: { type: 'session-info', id: 's', processStatus: 'running', activity: 'idle', title: '' } },
    { type: 'event', event: { type: 'chat-state', id: 's', state: { activity: 'waiting-input' } } },
    { type: 'event', event: { type: 'exit', id: 's', exitCode: 0 } },
  ])('accepts RPC $type', message => { expect(parseRpcWorkerOutput(message, 's')).toEqual(message); });
  it.each<PtyWorkerOutput>([
    { type: 'child-pid', pid: 7 }, { type: 'data', data: '\0文' }, { type: 'error', message: '' }, { type: 'exit', exitCode: -1 },
  ])('accepts PTY $type', message => { expect(parsePtyWorkerOutput(message)).toEqual(message); });
  it.each([
    null, [], { type: 'child-pid', pid: -1 }, { type: 'child-pid', pid: 1.5 },
    { type: 'response', success: true }, { type: 'response', requestId: 'r', success: 1 },
    { type: 'response', requestId: 'r', success: false }, { type: 'response', requestId: 'r', success: true, data: {} },
    { type: 'event', event: { type: 'session-info', id: 'other', processStatus: 'running' } },
    { type: 'event', event: { type: 'terminal-data', id: 's', data: 'not RPC' } },
    { type: 'event', event: { type: 'chat-state', id: 's', state: null } },
    { type: 'event', event: { type: 'chat-state', id: 's', state: { activity: ['idle'] } } },
    { type: 'event', event: { type: 'chat-message-delta', id: 's', messageId: 'm', blockIndex: -1, blockType: 'text', delta: 'x' } },
    { type: 'event', event: { type: 'chat-snapshot', id: 's', snapshot: {} } },
    { type: 'start', id: 's', ...launch }, { type: 'data', data: 'PTY only' },
  ])('rejects malformed, cross-session or wrong-direction RPC %j', raw => { expect(parseRpcWorkerOutput(raw, 's')).toBeUndefined(); });
  it.each([null, [], { type: 'response', requestId: 'r', success: true }, { type: 'data', data: 1 }, { type: 'error' }, { type: 'exit', exitCode: NaN }])
    ('rejects malformed PTY %j', raw => { expect(parsePtyWorkerOutput(raw)).toBeUndefined(); });
});
