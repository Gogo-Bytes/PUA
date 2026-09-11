import { parseRpcWorkerOutput } from '../src/shared/ipc/worker-schemas';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const control = vi.hoisted(() => ({ child: undefined as any, writes: [] as any[], failed: false, rejectDialog: false, dialogWrite: undefined as Promise<void> | undefined, closeWriter: vi.fn(), terminate: vi.fn().mockResolvedValue(undefined) }));
vi.mock('node:child_process', () => ({ spawn: () => control.child }));
vi.mock('../src/platform/process/process-tree', () => ({ terminateProcessTree: control.terminate }));
vi.mock('../src/platform/pi/rpc/writer', () => ({ RpcWriter: class {
  get failed() { return control.failed; }
  write(value: any) { control.writes.push(value); if (value.type === 'extension_ui_response' && control.rejectDialog) { control.failed = true; return Promise.reject(new Error('input stalled')); } return value.type === 'extension_ui_response' && control.dialogWrite ? control.dialogWrite : Promise.resolve(); }
  close() { control.closeWriter(); }
} }));
let port: EventEmitter & { postMessage: ReturnType<typeof vi.fn> };
let originalPort: unknown;
const incoming = (value: unknown) => control.child.stdout.write(JSON.stringify(value) + '\n');
const response = (command: string, data: unknown, success = true) => {
  const request = control.writes.findLast(value => value.type === command);
  incoming({ id: request.id, type: 'response', command, success, data, error: success ? undefined : 'abort failed' });
};
const turns = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const events = () => port.postMessage.mock.calls.map(call => call[0]);
async function ready() {
  response('get_state', { isStreaming: false }); response('get_messages', { messages: [] }); response('get_commands', { commands: [] }); await turns();
}
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); control.writes = []; control.failed = false; control.rejectDialog = false; control.dialogWrite = undefined; control.closeWriter.mockClear(); control.terminate.mockClear();
  originalPort = (process as any).parentPort;
  port = Object.assign(new EventEmitter(), { postMessage: vi.fn() }); (process as any).parentPort = port;
  control.child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  await import('../src/app/workers/pi-rpc.worker');
  port.emit('message', { data: { type: 'start', id: 's', executable: 'fixture', args: [], cwd: '/tmp', env: {} } });
  control.child.emit('spawn'); await turns();
});
afterEach(() => {
  (process as any).parentPort = originalPort; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
  // Every existing runtime/stream golden crosses the same main-side envelope parser.
  for (const message of events()) expect(parseRpcWorkerOutput(message, 's')).toEqual(message);
});
it('pauses handshake deadlines for startup UI, leaves timeout zero answerable, then becomes ready', async () => {
  incoming({ type: 'extension_ui_request', id: 'startup', method: 'input', title: 'Startup question', timeout: 0 });
  await vi.advanceTimersByTimeAsync(31_000);
  expect(process.exit).not.toHaveBeenCalled();
  expect(events().some(value => value.event?.type === 'extension-ui-closed')).toBe(false);
  port.emit('message', { data: { type: 'extension-response', requestId: 'answer', response: { id: 'startup', value: 'yes' } } }); await turns();
  expect(control.writes.find(value => value.type === 'extension_ui_response')).toMatchObject({ id: 'startup', value: 'yes' });
  await ready();
  expect(events().some(value => value.event?.type === 'chat-snapshot')).toBe(true);
});
it('resumes the remaining handshake budget instead of an imminent wall-clock tick', async () => {
  await vi.advanceTimersByTimeAsync(1000);
  incoming({ type: 'extension_ui_request', id: 'startup-short', method: 'input', title: 'Startup', timeout: 0 });
  await vi.advanceTimersByTimeAsync(13_000);
  port.emit('message', { data: { type: 'extension-response', requestId: 'answer', response: { id: 'startup-short', value: 'yes' } } }); await turns();
  await vi.advanceTimersByTimeAsync(2000);
  expect(process.exit).not.toHaveBeenCalled();
  await ready();
  expect(events().some(value => value.event?.type === 'chat-snapshot')).toBe(true);
});
it('uses fatal transport cleanup when a dialog answer write fails', async () => {
  await ready(); incoming({ type: 'extension_ui_request', id: 'dialog', method: 'input', title: 'Answer' }); control.rejectDialog = true;
  port.emit('message', { data: { type: 'extension-response', requestId: 'answer', response: { id: 'dialog', value: 'x' } } }); await turns();
  expect(control.terminate).toHaveBeenCalledWith(12345);
  expect(process.exit).toHaveBeenCalledWith(1);
  expect(events().some(value => value.event?.type === 'extension-ui-closed')).toBe(true);
});
it('publishes recovered queue before abort resolves and retains it on abort failure', async () => {
  await ready(); port.emit('message', { data: { type: 'stop', requestId: 'stop' } });
  response('clear_queue', { steering: ['keep this'], followUp: ['then this'] }); await turns();
  expect(events().filter(value => value.event?.type === 'chat-queue-recovered')).toEqual([{ type: 'event', event: { type: 'chat-queue-recovered', id: 's', requestId: 'stop', queue: { steering: ['keep this'], followUp: ['then this'] } } }]);
  expect(events().some(value => value.requestId === 'stop')).toBe(false);
  response('abort', undefined, false); await turns();
  expect(events().find(value => value.requestId === 'stop')).toMatchObject({ success: false });
  expect(events().filter(value => value.event?.type === 'chat-queue-recovered')).toHaveLength(1);
});

// Golden transcript captured against the pre-extraction host. IDs and repeated
// pre-show projections are intentional compatibility, not redundant assertions.
it('golden: overlapping startup dialogs preserve observed activity and event order', async () => {
  incoming({ type: 'extension_ui_request', id: 'a', method: 'input', title: 'A', timeout: 0 });
  incoming({ type: 'extension_ui_request', id: 'b', method: 'confirm', title: 'B', message: '?' });
  incoming({ type: 'auto_retry_start' });
  port.emit('message', { data: { type: 'extension-response', requestId: 'answer-b', response: { id: 'b', confirmed: false } } }); await turns();
  incoming({ type: 'compaction_start' });
  port.emit('message', { data: { type: 'extension-response', requestId: 'answer-a', response: { id: 'a', cancelled: true, type: 'switch_session' } } }); await turns();
  incoming({ type: 'agent_end' }); incoming({ type: 'compaction_end' }); incoming({ type: 'auto_retry_end', success: true });
  response('get_state', { isStreaming: true }); response('get_messages', { messages: [] }); response('get_commands', { commands: [] }); await turns();
  incoming({ type: 'agent_settled' });
  const transcript = events().flatMap(value => {
    if (value.type === 'response') return [`response:${value.requestId}:${value.success}`];
    const e = value.event;
    if (e?.type === 'chat-state') return [`state:${e.state.activity}`];
    if (e?.type === 'extension-ui') return [`open:${e.request.id}`];
    if (e?.type === 'extension-ui-closed') return [`close:${e.requestId}`];
    if (e?.type === 'chat-snapshot') return [`snapshot:${e.snapshot.activity}`];
    if (e?.type === 'session-info') return [`${e.processStatus}:${e.activity}`];
    return [];
  });
  expect(transcript).toEqual([
    'state:idle', 'state:waiting-input', 'open:a',
    'state:waiting-input', 'state:waiting-input', 'open:b', 'state:waiting-input',
    'close:b', 'state:waiting-input', 'response:answer-b:true', 'state:waiting-input',
    'close:a', 'state:compacting', 'response:answer-a:true',
    'snapshot:compacting', 'running:compacting', 'state:idle',
  ]);
  expect(control.writes.filter(value => value.type === 'extension_ui_response')).toEqual([
    { id: 'b', confirmed: false, type: 'extension_ui_response' },
    { id: 'a', cancelled: true, type: 'extension_ui_response' },
  ]);
});
it('golden: legal stop recovery is synchronous, request-scoped and not a queue update', async () => {
  await ready(); incoming({ type: 'queue_update', steering: ['cached'], followUp: [] });
  const transcript: string[] = [];
  port.postMessage.mockImplementation(value => {
    if (value.event?.type === 'chat-queue-recovered') {
      expect(control.writes.filter(value => value.type === 'abort')).toHaveLength(0);
      transcript.push(`recover:${value.event.requestId}:${JSON.stringify(value.event.queue)}`);
    }
    if (value.type === 'response') transcript.push(`response:${value.requestId}:${value.success}:${String(value.data)}`);
  });
  port.emit('message', { data: { type: 'stop', requestId: 'renderer-stop-17' } });
  expect(control.writes.at(-1).type).toBe('clear_queue');
  response('clear_queue', { steering: ['returned'], followUp: [] }); await turns();
  expect(control.writes.at(-1).type).toBe('abort');
  response('abort', undefined); await turns();
  expect(transcript).toEqual(['recover:renderer-stop-17:{"steering":["returned"],"followUp":[]}', 'response:renderer-stop-17:true:undefined']);
  expect(events().filter(value => value.event?.type === 'chat-state').at(-1).event.state.queue).toEqual({ steering: ['cached'], followUp: [] });
});

it('failed clear_queue publishes nothing, never aborts and does not replay', async () => {
  await ready(); port.emit('message', { data: { type: 'stop', requestId: 'failed-clear' } });
  response('clear_queue', undefined, false); await turns();
  expect(events().find(value => value.requestId === 'failed-clear')).toMatchObject({ success: false });
  expect(events().filter(value => value.event?.type === 'chat-queue-recovered')).toEqual([]);
  expect(control.writes.filter(value => value.type === 'abort')).toEqual([]);
  expect(control.writes.filter(value => value.type === 'clear_queue')).toHaveLength(1);
});
it('concurrent stop IDs retain renderer deduplication semantics with reverse clear responses', async () => {
  await ready();
  for (const requestId of ['first', 'second']) port.emit('message', { data: { type: 'stop', requestId } });
  const clears = control.writes.filter(value => value.type === 'clear_queue'); expect(clears).toHaveLength(2);
  incoming({ type: 'response', id: clears[1].id, command: 'clear_queue', success: true, data: { steering: [], followUp: ['second'] } }); await turns();
  incoming({ type: 'response', id: clears[0].id, command: 'clear_queue', success: true, data: { steering: [], followUp: [] } }); await turns();
  const aborts = control.writes.filter(value => value.type === 'abort'); expect(aborts).toHaveLength(2);
  incoming({ type: 'response', id: aborts[0].id, command: 'abort', success: true }); incoming({ type: 'response', id: aborts[1].id, command: 'abort', success: true }); await turns();
  expect(events().filter(value => value.event?.type === 'chat-queue-recovered').map(value => value.event)).toEqual([
    { id: 's', type: 'chat-queue-recovered', requestId: 'second', queue: { steering: [], followUp: ['second'] } },
    { id: 's', type: 'chat-queue-recovered', requestId: 'first', queue: { steering: [], followUp: [] } },
  ]);
  expect(events().filter(value => value.type === 'response').map(value => [value.requestId, value.success, value.data])).toEqual([['second', true, undefined], ['first', true, undefined]]);
});
it('exactly resumes fourteen seconds of handshake budget after a long overlap, then closes without replay', async () => {
  await vi.advanceTimersByTimeAsync(1000);
  incoming({ type: 'extension_ui_request', id: 'a', method: 'input', title: 'A', timeout: 0 });
  incoming({ type: 'extension_ui_request', id: 'b', method: 'input', title: 'B', timeout: 0 });
  await vi.advanceTimersByTimeAsync(120_000);
  port.emit('message', { data: { type: 'extension-response', requestId: 'b-answer', response: { id: 'b', cancelled: true } } }); await turns();
  await vi.advanceTimersByTimeAsync(120_000); expect(process.exit).not.toHaveBeenCalled();
  port.emit('message', { data: { type: 'extension-response', requestId: 'a-answer', response: { id: 'a', value: '' } } }); await turns();
  await vi.advanceTimersByTimeAsync(13_999); expect(process.exit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(process.exit).toHaveBeenCalledWith(1);
  expect(control.writes.filter(value => value.type === 'get_state')).toHaveLength(1);
  expect(control.terminate).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it('five-minute host budget preserves remaining time and new requests start paused during waiting', async () => {
  await ready();
  port.emit('message', { data: { type: 'send', requestId: 'old', text: 'old', filePaths: [], images: [], queuePreference: 'steer' } });
  await vi.advanceTimersByTimeAsync(100_000);
  incoming({ type: 'extension_ui_request', id: 'a', method: 'input', title: 'A', timeout: 0 });
  port.emit('message', { data: { type: 'send', requestId: 'new', text: 'new', filePaths: [], images: [], queuePreference: 'steer' } });
  await vi.advanceTimersByTimeAsync(600_000); expect(process.exit).not.toHaveBeenCalled();
  port.emit('message', { data: { type: 'extension-response', requestId: 'answer', response: { id: 'a', value: 'yes' } } }); await turns();
  const old = control.writes.find(value => value.type === 'prompt' && value.message === 'old');
  await vi.advanceTimersByTimeAsync(199_999); expect(process.exit).not.toHaveBeenCalled();
  incoming({ type: 'response', id: old.id, command: 'prompt', success: true }); await turns();
  await vi.advanceTimersByTimeAsync(100_000); expect(process.exit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(process.exit).toHaveBeenCalledWith(1);
  expect(control.writes.filter(value => value.type === 'prompt')).toHaveLength(2);
  expect(events().some(value => value.event?.message?.includes('not replayed'))).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it.each(['close', 'exit'] as const)('%s invalidates a confirmed-but-not-continued clear and suppresses all late input/success', async action => {
  await ready(); port.emit('message', { data: { type: 'stop', requestId: 'late-stop' } });
  response('clear_queue', { steering: ['cleared late'], followUp: [] });
  if (action === 'close') port.emit('message', { data: { type: 'close' } }); else control.child.emit('exit', 0);
  await turns(); const before = events().length;
  incoming({ type: 'agent_start' }); incoming({ type: 'extension_ui_request', id: 'late', method: 'input', title: 'Late' });
  port.emit('message', { data: { type: 'start', id: 'replacement', executable: 'never', args: [], cwd: '/tmp', env: {} } });
  port.emit('message', { data: { type: 'stop', requestId: 'later-stop' } });
  await vi.advanceTimersByTimeAsync(1_000_000);
  expect(events()).toHaveLength(before);
  expect(events().filter(value => value.event?.type === 'chat-queue-recovered')).toEqual([]);
  expect(events().filter(value => value.type === 'response' && value.success)).toEqual([]);
  expect(control.writes.filter(value => value.type === 'abort')).toEqual([]);
  expect(control.terminate).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it('close after abort acknowledgement retains recovery but does not report late stop success', async () => {
  await ready(); port.emit('message', { data: { type: 'stop', requestId: 'stop' } }); response('clear_queue', { steering: ['saved'], followUp: [] }); await turns();
  response('abort', undefined); port.emit('message', { data: { type: 'close' } }); await turns();
  expect(events().filter(value => value.event?.type === 'chat-queue-recovered')).toHaveLength(1);
  expect(events().some(value => value.type === 'response' && value.requestId === 'stop')).toBe(false);
});
it('close during answer write retires dialogs synchronously and cannot report success after completion', async () => {
  await ready(); incoming({ type: 'extension_ui_request', id: 'd', method: 'input', title: 'D' });
  let finish!: () => void; control.dialogWrite = new Promise<void>(resolve => { finish = resolve; });
  port.emit('message', { data: { type: 'extension-response', requestId: 'answer', response: { id: 'd', value: 'yes' } } });
  expect(control.writes.at(-1)).toMatchObject({ type: 'extension_ui_response' });
  port.emit('message', { data: { type: 'close' } }); await turns(); const before = events().length;
  finish(); await turns(); expect(events()).toHaveLength(before);
  expect(events().filter(value => value.event?.type === 'extension-ui-closed')).toHaveLength(1);
  expect(events().some(value => value.type === 'response' && value.requestId === 'answer')).toBe(false);
});
it('close after handshake acknowledgements prevents late snapshot/running', async () => {
  response('get_state', { isStreaming: true }); response('get_messages', { messages: [] }); response('get_commands', { commands: [] });
  port.emit('message', { data: { type: 'close' } }); await turns();
  expect(events().some(value => value.event?.type === 'chat-snapshot' || value.event?.processStatus === 'running')).toBe(false);
  expect(control.terminate).toHaveBeenCalledTimes(1);
});
it.each(['recovery', 'state'] as const)('failed %s transport post closes once, clears pending timers and never recursively posts or aborts', async phase => {
  await ready(); incoming({ type: 'extension_ui_request', id: 'd', method: 'input', title: 'D', timeout: 100 });
  port.emit('message', { data: { type: 'stop', requestId: 'stop' } });
  const before = port.postMessage.mock.calls.length;
  port.postMessage.mockImplementation(() => { throw new Error('port unavailable'); });
  if (phase === 'recovery') response('clear_queue', { steering: ['delivery unknown'], followUp: [] }); else incoming({ type: 'agent_start' });
  await turns(); await vi.advanceTimersByTimeAsync(1_000_000);
  expect(port.postMessage.mock.calls).toHaveLength(before + 1);
  expect(control.writes.filter(value => value.type === 'abort')).toEqual([]);
  expect(control.writes.filter(value => value.type === 'clear_queue')).toHaveLength(1);
  expect(control.closeWriter).toHaveBeenCalledTimes(1); expect(control.terminate).toHaveBeenCalledTimes(1);
  expect(process.exit).toHaveBeenCalledExactlyOnceWith(1); expect(vi.getTimerCount()).toBe(0);
  expect(events().some(value => value.type === 'response' && value.success)).toBe(false);
});
it('keeps dialog validation errors at the edge and timeout retirement does not write an answer', async () => {
  await ready(); incoming({ type: 'extension_ui_request', id: 's', method: 'select', title: 'Pick', options: ['yes', 1], timeout: 100 });
  const answer = async (requestId: string, response: unknown) => { port.emit('message', { data: { type: 'extension-response', requestId, response } }); await turns(); };
  await answer('type', { id: 's', confirmed: true }); await answer('option', { id: 's', value: 'no' }); await answer('raw', { id: 's', value: 'yes', cancelled: true });
  await vi.advanceTimersByTimeAsync(100); await answer('ended', { id: 's', value: 'yes' });
  expect(events().filter(value => value.type === 'response').map(value => value.error)).toEqual([
    'Error: 扩展响应类型不匹配', 'Error: 无效选项', 'Error: 扩展响应需要唯一结果', 'Error: 扩展对话已结束',
  ]);
  expect(control.writes.filter(value => value.type === 'extension_ui_response')).toEqual([]);
  expect(events().filter(value => value.event?.type === 'chat-state').at(-1).event.state.activity).toBe('idle');
});
it('stream guard: 24ms batches flush before any message_end and final text is authoritative', async () => {
  await ready(); incoming({ type: 'message_start', message: { role: 'assistant', content: [] } });
  const delta = (text: string) => incoming({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: text } });
  delta('a'); delta('b'); await vi.advanceTimersByTimeAsync(23);
  expect(events().filter(value => value.event?.type === 'chat-message-delta')).toEqual([]);
  await vi.advanceTimersByTimeAsync(1); expect(events().filter(value => value.event?.type === 'chat-message-delta')[0].event.delta).toBe('ab');
  delta('provisional'); incoming({ type: 'message_end', message: { role: 'user', content: 'interrupting final' } });
  const transcript = events().filter(value => ['chat-message-delta', 'chat-message-end'].includes(value.event?.type)).map(value => value.event.type);
  expect(transcript).toEqual(['chat-message-delta', 'chat-message-delta', 'chat-message-end']);
  incoming({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'authoritative' }] } });
  expect(events().filter(value => value.event?.type === 'chat-message-end').at(-1).event.message.blocks).toEqual([{ type: 'text', text: 'authoritative' }]);
  const count = events().length; await vi.advanceTimersByTimeAsync(24); expect(events()).toHaveLength(count);
});
it('tool guard: interleaved cumulative partials replace, empty final wins, final membership/name/args survive late execution', async () => {
  await ready(); incoming({ type: 'message_start', message: { role: 'assistant', content: [
    { type: 'toolCall', id: 'keep', name: 'provisional', arguments: { old: true } },
    { type: 'toolCall', id: 'retire', name: 'unused', arguments: {} },
  ] } });
  for (const [id, text] of [['keep', 'a'], ['retire', 'x'], ['keep', 'ab']]) incoming({ type: 'tool_execution_update', toolCallId: id, partialResult: { content: [{ type: 'text', text }] } });
  expect(events().filter(value => value.event?.type === 'chat-tool' && value.event.tool.id === 'keep').map(value => value.event.tool.output)).toEqual(['a', 'ab']);
  incoming({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'keep', name: 'authoritative', arguments: { final: true } }] } });
  incoming({ type: 'tool_execution_start', toolCallId: 'keep', toolName: 'late', args: { wrong: true } });
  incoming({ type: 'tool_execution_end', toolCallId: 'keep', toolName: 'late', args: { wrong: true }, result: { content: [] } });
  const final = events().filter(value => value.event?.type === 'chat-tool' && value.event.tool.id === 'keep').at(-1).event.tool;
  expect(final).toMatchObject({ name: 'authoritative', arguments: { final: true }, output: '', status: 'success' });
  const count = events().length;
  incoming({ type: 'tool_execution_end', toolCallId: 'retire', result: { content: [{ type: 'text', text: 'late' }] } });
  expect(events()).toHaveLength(count);
});
it('installs shutdown identity before dialog retirement can fail transport or synchronously reenter close', async () => {
  await ready(); incoming({ type: 'extension_ui_request', id: 'd', method: 'input', title: 'D' });
  port.emit('message', { data: { type: 'stop', requestId: 'pending' } });
  const before = port.postMessage.mock.calls.length;
  port.postMessage.mockImplementation(() => {
    port.emit('message', { data: { type: 'close' } });
    throw new Error('retirement delivery failed');
  });
  port.emit('message', { data: { type: 'close' } }); await turns();
  expect(port.postMessage.mock.calls).toHaveLength(before + 1);
  expect(control.closeWriter).toHaveBeenCalledTimes(1); expect(control.terminate).toHaveBeenCalledTimes(1);
  expect(process.exit).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  expect(control.writes.filter(value => value.type === 'abort')).toEqual([]);
});
it('ordinary request resumes exactly its remaining five-minute budget, not a fresh budget', async () => {
  await ready(); port.emit('message', { data: { type: 'stop', requestId: 'unknown-stop' } });
  await vi.advanceTimersByTimeAsync(100_000);
  incoming({ type: 'extension_ui_request', id: 'pause', method: 'input', title: 'Pause', timeout: 0 });
  await vi.advanceTimersByTimeAsync(600_000);
  port.emit('message', { data: { type: 'extension-response', requestId: 'answer', response: { id: 'pause', cancelled: true } } }); await turns();
  await vi.advanceTimersByTimeAsync(199_999); expect(process.exit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(process.exit).toHaveBeenCalledWith(1);
  expect(control.writes.filter(value => value.type === 'clear_queue')).toHaveLength(1);
  expect(control.writes.filter(value => value.type === 'abort')).toEqual([]);
  expect(events().filter(value => value.event?.type === 'chat-queue-recovered')).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

const streamEvents = () => events().flatMap(value => value.event && ['chat-message-start', 'chat-message-delta', 'chat-message-end', 'chat-tool'].includes(value.event.type) ? [value.event] : []);
const startAssistant = (content: unknown[] = []) => incoming({ type: 'message_start', message: { role: 'assistant', timestamp: 1, content } });
const updateAssistant = (type: string, contentIndex: number, fields: object = {}) => incoming({ type: 'message_update', assistantMessageEvent: { type, contentIndex, ...fields } });
it('stream golden: batch key includes message, index and kind; starts and late updates follow active identity', async () => {
  vi.setSystemTime(1000); await ready(); startAssistant([{ type: 'thinking', thinking: 'seed' }, { type: 'text', text: 'seed text' }]);
  updateAssistant('text_delta', 0, { delta: 'a' }); updateAssistant('thinking_delta', 0, { delta: 'think' }); updateAssistant('text_delta', 0, { delta: 'b' });
  updateAssistant('text_delta', 4095, { delta: 'edge' });
  for (const index of [-1, 0.5, 4096]) updateAssistant('text_delta', index, { delta: 'invalid' });
  startAssistant(); updateAssistant('text_delta', 0, { delta: 'second' });
  incoming({ type: 'message_start', message: { role: 'user', timestamp: 2, content: 'user' } });
  updateAssistant('thinking_delta', 1, { delta: 'still assistant' });
  await vi.advanceTimersByTimeAsync(23); expect(streamEvents().filter(e => e.type === 'chat-message-delta')).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(streamEvents().filter(e => e.type === 'chat-message-delta').map(e => [e.messageId, e.blockIndex, e.blockType, e.delta])).toEqual([
    ['stream-1000-1', 0, 'text', 'ab'], ['stream-1000-1', 0, 'thinking', 'think'], ['stream-1000-1', 4095, 'text', 'edge'],
    ['stream-1000-2', 0, 'text', 'second'], ['stream-1000-2', 1, 'thinking', 'still assistant'],
  ]);
  incoming({ type: 'message_end', message: { role: 'user', timestamp: 3, content: 'user final' } });
  incoming({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'final' }] } });
  expect(streamEvents().filter(e => e.type === 'chat-message-end').map(e => e.message.id)).toEqual(['user-2-2', 'stream-1000-2']);
  const count = streamEvents().length; updateAssistant('text_delta', 0, { delta: 'late' }); await vi.advanceTimersByTimeAsync(24); expect(streamEvents()).toHaveLength(count);
  startAssistant(); expect(streamEvents().at(-1).message.id).toBe('stream-1048-6');
});
it.each([null, { role: 'toolResult', toolCallId: 'unknown' }, { role: 'custom', display: false }])('stream golden: every ignored end flushes before returning (%j)', async message => {
  await ready(); startAssistant(); updateAssistant('text_delta', 0, { delta: 'flush' }); incoming({ type: 'message_end', message });
  expect(streamEvents().at(-1)).toMatchObject({ type: 'chat-message-delta', delta: 'flush' });
  const count = streamEvents().length; await vi.advanceTimersByTimeAsync(24); expect(streamEvents()).toHaveLength(count);
});
it('stream golden: argument fragments use first ID location and execution details replace fragment accumulation', async () => {
  await ready(); startAssistant(); updateAssistant('toolcall_delta', 0, { delta: 'ignored' });
  updateAssistant('toolcall_start', 0, { id: 'a', toolName: 'read' });
  updateAssistant('toolcall_delta', 0, { delta: '{"path":' }); updateAssistant('toolcall_delta', 0, { delta: '"x"}' });
  updateAssistant('toolcall_delta', 0, { delta: 'invalid' });
  expect(streamEvents().at(-1).tool).toMatchObject({ arguments: { path: 'x' }, details: { argumentText: '{"path":"x"}invalid' } });
  incoming({ type: 'tool_execution_update', toolCallId: 'a', partialResult: { content: [], details: { execution: true } } });
  updateAssistant('toolcall_delta', 0, { delta: '{"nested":{}}' });
  expect(streamEvents().at(-1).tool.arguments).toEqual({ nested: {} });
  updateAssistant('toolcall_start', 0, { id: 'b', toolName: 'read' }); updateAssistant('toolcall_delta', 0, { delta: ' ' });
  expect(streamEvents().at(-1).tool.id).toBe('a');
  updateAssistant('toolcall_end', 0, { toolCall: { id: 'a', name: 'final', arguments: { end: true } } });
  expect(streamEvents().at(-1).tool).toMatchObject({ id: 'a', name: 'final', arguments: { end: true }, details: undefined });
});
it('stream golden: history is single pass by ID, duplicate results replace, original indices survive and live precedes snapshot', async () => {
  vi.setSystemTime(1000); startAssistant([{ type: 'toolCall', id: 'a', name: 'live', arguments: {} }]);
  const call = (id: string) => ({ role: 'assistant', timestamp: 1, content: [{ type: 'toolCall', id, name: 'read', arguments: {} }] });
  const result = (id: unknown, text: string) => ({ role: 'toolResult', toolCallId: id, toolName: 'read', content: text });
  response('get_state', {}); response('get_messages', { messages: [result('a', 'orphan'), call('a'), result('a', 'first'), call('a'), result('a', 'second'), result('a', ''), call('b'), result(undefined, 'missing'), { role: 'custom', display: false }, call('c'), result('b', 'B'), call(''), result('', 'empty ignored')] }); response('get_commands', { commands: [] }); await turns();
  const snapshot = events().find(e => e.event?.type === 'chat-snapshot').event.snapshot;
  expect(snapshot.messages.map((m: any) => [m.id, m.blocks[0].tool.output, m.blocks[0].tool.status])).toEqual([
    ['assistant-1-1', 'first', 'success'], ['assistant-1-3', '', 'success'], ['assistant-1-6', 'B', 'success'], ['assistant-1-9', '', 'pending'], ['assistant-1-11', '', 'pending'],
  ]);
  expect(events().filter(e => ['chat-message-start', 'chat-snapshot', 'session-info'].includes(e.event?.type)).map(e => e.event.type)).toEqual(['chat-message-start', 'chat-snapshot', 'session-info']);
  incoming({ type: 'tool_execution_start', toolCallId: 'a', args: { late: true } });
  expect(streamEvents().at(-1)).toMatchObject({ messageId: 'assistant-1-3', tool: { name: 'read', arguments: { late: true }, status: 'success' } });
});
it('stream golden: execution may precede declaration; terminal progress cannot downgrade but subsequent finals replace', async () => {
  await ready(); incoming({ type: 'tool_execution_end', toolCallId: 'a', toolName: 'read', result: { content: 'done' }, isError: 'truthy' });
  expect(streamEvents().at(-1)).toMatchObject({ tool: { id: 'a', status: 'error', output: 'done' } }); expect(streamEvents().at(-1).messageId).toBeUndefined();
  startAssistant(); updateAssistant('toolcall_start', 0, { id: 'a', toolName: 'wrong' });
  incoming({ type: 'tool_execution_update', toolCallId: 'a', partialResult: { content: 'ignored' } });
  expect(streamEvents().at(-1).tool).toMatchObject({ name: 'read', status: 'error', output: 'done' });
  incoming({ type: 'tool_execution_end', toolCallId: 'a', result: { content: 'new' } });
  incoming({ type: 'message_end', message: { role: 'toolResult', toolCallId: 'a', content: [], isError: 1 } });
  expect(streamEvents().at(-1).tool).toMatchObject({ status: 'error', output: '', images: [] });
});

// Explicitly approved corrections, kept separate from normal compatibility golden.
it.each(['null', '[]', '1', 'true', '"text"'])('stream correction: partial JSON %s cannot replace object arguments', async delta => {
  await ready(); startAssistant([{ type: 'toolCall', id: 'a', name: 'read', arguments: { keep: true } }]);
  updateAssistant('toolcall_delta', 0, { delta });
  expect(streamEvents().at(-1).tool.arguments).toEqual({ keep: true });
});
it.each(['close', 'exit'] as const)('stream correction: %s discards pending deltas instead of flushing', async action => {
  await ready(); startAssistant(); updateAssistant('text_delta', 0, { delta: 'discard' });
  if (action === 'close') port.emit('message', { data: { type: 'close' } }); else control.child.emit('exit', 0);
  await turns(); await vi.advanceTimersByTimeAsync(24);
  expect(streamEvents().filter(e => e.type === 'chat-message-delta')).toEqual([]);
});
it('stream correction: synchronous close on first flush notification suppresses remainder and final continuation', async () => {
  await ready(); startAssistant(); updateAssistant('text_delta', 0, { delta: 'first' }); updateAssistant('thinking_delta', 1, { delta: 'second' });
  let closed = false;
  port.postMessage.mockImplementation(value => { if (value.event?.type === 'chat-message-delta' && !closed) { closed = true; port.emit('message', { data: { type: 'close' } }); } });
  incoming({ type: 'message_end', message: { role: 'assistant', content: [] } }); await turns();
  expect(streamEvents().filter(e => e.type === 'chat-message-delta').map(e => e.delta)).toEqual(['first']);
  expect(streamEvents().filter(e => e.type === 'chat-message-end')).toEqual([]); expect(vi.getTimerCount()).toBe(0);
});
it('stream correction: failed delta transport closes both owners once without replay or late final', async () => {
  await ready(); startAssistant(); updateAssistant('text_delta', 0, { delta: 'first' }); updateAssistant('thinking_delta', 1, { delta: 'second' });
  const before = events().length; port.postMessage.mockImplementation(() => { throw new Error('transport failed'); });
  incoming({ type: 'message_end', message: { role: 'assistant', content: [] } }); await turns(); await vi.advanceTimersByTimeAsync(1000);
  expect(events()).toHaveLength(before + 1); expect(control.terminate).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it.each(['close', 'throw'] as const)('stream correction: snapshot observer %s cannot publish subsequent running', async action => {
  port.postMessage.mockImplementation(value => {
    if (value.event?.type !== 'chat-snapshot') return;
    if (action === 'close') port.emit('message', { data: { type: 'close' } }); else throw new Error('snapshot output failed');
  });
  await ready();
  expect(events().filter(e => e.event?.processStatus === 'running')).toEqual([]);
  expect(control.terminate).toHaveBeenCalledTimes(1); expect(control.closeWriter).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it('stream correction: timer-driven failed delta post is handled by transport cleanup without uncaught replay', async () => {
  await ready(); startAssistant(); updateAssistant('text_delta', 0, { delta: 'first' }); updateAssistant('text_delta', 1, { delta: 'second' });
  const before = events().length; port.postMessage.mockImplementation(() => { throw new Error('timer delivery failed'); });
  await vi.advanceTimersByTimeAsync(24); await turns();
  expect(events()).toHaveLength(before + 1); expect(control.terminate).toHaveBeenCalledTimes(1); expect(control.closeWriter).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it('stream golden: invalid index diagnostics require an active assistant and retain original text/count', async () => {
  await ready(); updateAssistant('text_delta', -1, { delta: 'before' }); startAssistant();
  updateAssistant('text_delta', -1, { delta: 'active' });
  incoming({ type: 'message_end', message: { role: 'assistant', content: [] } }); updateAssistant('text_delta', -1, { delta: 'after' });
  control.child.stdout.write('{bad}\n'); await turns();
  const notice = events().find(e => e.event?.type === 'chat-notice').event.message;
  expect(notice.match(/Invalid contentIndex ignored/g)).toHaveLength(1);
  const count = events().length; updateAssistant('text_delta', -1, { delta: 'invalidated' }); await turns(); expect(events()).toHaveLength(count);
});
it('stream golden: repeated historical IDs before a result update only the last call and orphan results are not buffered', async () => {
  const call = (id: string) => ({ role: 'assistant', timestamp: 1, content: [{ type: 'toolCall', id, name: 'same', arguments: {} }] });
  response('get_state', {}); response('get_messages', { messages: [
    { role: 'toolResult', toolCallId: 'orphan', content: 'discard' }, call('orphan'), call('a'), call('a'), { role: 'toolResult', toolCallId: 'a', content: 'latest' },
  ] }); response('get_commands', { commands: [] }); await turns();
  const messages = events().find(e => e.event?.type === 'chat-snapshot').event.snapshot.messages;
  expect(messages.map((m: any) => [m.id, m.blocks[0].tool.status, m.blocks[0].tool.output])).toEqual([
    ['assistant-1-1', 'pending', ''], ['assistant-1-2', 'pending', ''], ['assistant-1-3', 'success', 'latest'],
  ]);
});
it('stream golden: late updates do not attach to finalized IDs; a new start consumes a new ID and initial calls reset execution', async () => {
  vi.setSystemTime(1000); vi.spyOn(Math, 'random').mockReturnValue(0.25); await ready();
  incoming({ type: 'tool_execution_end', toolCallId: 'a', toolName: 'early', result: { content: 'done' } });
  startAssistant([{ type: 'toolCall', id: 'a', name: 'initial', arguments: {} }, { type: 'toolCall' }]);
  expect(streamEvents().at(-1).message.blocks[0].tool).toMatchObject({ name: 'initial', status: 'pending', output: '' });
  expect(streamEvents().at(-1).message.blocks[1].tool.id).toBe('tool-0.25');
  incoming({ type: 'message_end', message: { role: 'assistant', content: [] } });
  updateAssistant('toolcall_start', 0, { id: 'late' }); const count = streamEvents().length;
  incoming({ type: 'tool_execution_end', toolCallId: 'a', result: { content: 'retired' } }); expect(streamEvents()).toHaveLength(count);
  startAssistant(); expect(streamEvents().at(-1).message.id).toBe('stream-1000-3');
  updateAssistant('toolcall_start', 0, { id: 'new' }); expect(streamEvents().at(-1)).toMatchObject({ messageId: 'stream-1000-3', tool: { id: 'new', status: 'pending' } });
});

it.each(['steer', 'followUp'] as const)('worker protocol golden: semantic send maps %s and references/images exactly at the Pi edge', async queuePreference => {
  await ready();
  const filePaths = ['/fake/a"b\n.txt', '/fake/文.txt'];
  port.emit('message', { data: { type: 'send', requestId: 'send-golden', text: '/extension\0', filePaths,
    images: [{ data: 'dGlueQ==', mimeType: 'image/png' }], queuePreference } });
  expect(control.writes.at(-1)).toEqual({ id: expect.stringMatching(/^pua-/), type: 'prompt',
    message: `/extension\0\n\n参考文件路径：\n${filePaths.map(file => `- ${JSON.stringify(file)}`).join('\n')}`,
    images: [{ type: 'image', data: 'dGlueQ==', mimeType: 'image/png' }], streamingBehavior: queuePreference });
  response('prompt', { unusedRawPiResult: true }); await turns();
  expect(events().find(value => value.requestId === 'send-golden')).toEqual({ type: 'response', requestId: 'send-golden', success: true });
});
it('worker protocol golden: empty send and semantic rename preserve raw operation and failure text', async () => {
  await ready();
  port.emit('message', { data: { type: 'send', requestId: 'empty', text: '', filePaths: [], images: [], queuePreference: 'steer' } });
  expect(control.writes.at(-1)).toEqual({ id: expect.any(String), type: 'prompt', message: '', images: [], streamingBehavior: 'steer' });
  response('prompt', undefined); await turns();
  port.emit('message', { data: { type: 'rename', requestId: 'rename', name: 'title\0' } });
  expect(control.writes.at(-1)).toEqual({ id: expect.any(String), type: 'set_session_name', name: 'title\0' });
  response('set_session_name', undefined, false); await turns();
  expect(events().find(value => value.requestId === 'rename')).toEqual({ type: 'response', requestId: 'rename', success: false, error: 'Error: abort failed' });
});
it('worker protocol rejects unknown commands, wrong direction and malformed correlated requests without Pi effects', async () => {
  await ready(); const writes = control.writes.length;
  for (const data of [
    { type: 'command', requestId: 'raw', command: { type: 'switch_session', sessionPath: '/external' } },
    { type: 'response', requestId: 'wrong-direction', success: true },
    { type: 'send', requestId: 'bad-send', text: 1, filePaths: [], images: [], queuePreference: 'steer' },
    { type: 'extension-response', requestId: 'bad-extension', response: { id: 'd', value: 1 } },
  ]) port.emit('message', { data });
  await turns();
  expect(control.writes).toHaveLength(writes); expect(control.terminate).not.toHaveBeenCalled();
  expect(events().filter(value => value.type === 'response').map(value => [value.requestId, value.success])).toEqual([
    ['raw', false], ['wrong-direction', false], ['bad-send', false], ['bad-extension', false],
  ]);
  const before = events().length;
  for (const data of [null, [], {}, { type: 'stop' }, { type: 'extension-response', response: { id: 'd', cancelled: true } }, { type: 'write', data: 'external' }]) port.emit('message', { data });
  await turns(); expect(events()).toHaveLength(before); expect(control.writes).toHaveLength(writes);
});

// Protocol corrections, not a reproduction of the unresolved missing-assistant P0.
const malformedAcknowledgements: Array<[string, Record<string, unknown>]> = [
  ['missing success', { command: 'EXPECTED' }],
  ['null success', { command: 'EXPECTED', success: null }],
  ['string success', { command: 'EXPECTED', success: 'true' }],
  ['numeric success', { command: 'EXPECTED', success: 1 }],
  ['missing command', { success: true }],
  ['wrong command', { command: 'get_state', success: true }],
  ['non-string command', { command: null, success: true }],
  ['failure missing error', { command: 'EXPECTED', success: false }],
  ['failure non-string error', { command: 'EXPECTED', success: false, error: null }],
];
for (const command of ['prompt', 'set_session_name', 'clear_queue', 'abort'] as const) {
  it.each(malformedAcknowledgements)(`strict Pi: ${command} rejects %s once, clears timer and ignores late success`, async (_label, fields) => {
    await ready();
    const input = command === 'prompt' ? { type: 'send', text: 'keep', filePaths: [], images: [], queuePreference: 'steer' }
      : command === 'set_session_name' ? { type: 'rename', name: 'keep' } : { type: 'stop' };
    port.emit('message', { data: { ...input, requestId: 'strict' } });
    if (command === 'abort') { response('clear_queue', { steering: ['recovered'], followUp: [] }); await turns(); }
    const request = control.writes.at(-1);
    const malformed = { ...fields, ...(fields.command === 'EXPECTED' ? { command } : {}) };
    incoming({ type: 'response', id: request.id, data: { steering: [], followUp: [] }, ...malformed }); await turns();
    expect(events().filter(value => value.requestId === 'strict')).toEqual([
      { type: 'response', requestId: 'strict', success: false, error: expect.stringContaining('Pi RPC protocol error') },
    ]);
    expect(vi.getTimerCount()).toBe(0);
    const count = events().length;
    incoming({ type: 'response', id: request.id, command, success: true, data: { steering: [], followUp: [] } });
    await vi.advanceTimersByTimeAsync(300_001);
    expect(events()).toHaveLength(count); expect(control.terminate).not.toHaveBeenCalled();
    expect(events().filter(value => value.event?.type === 'chat-queue-recovered')).toHaveLength(command === 'abort' ? 1 : 0);
    if (command === 'clear_queue') expect(control.writes.filter(value => value.type === 'abort')).toEqual([]);
  });
}
it.each([undefined, null, [], 'queue', {}, { steering: [] }, { followUp: [] }, { steering: [1], followUp: [] }, { steering: [], followUp: ['valid', null] }])('strict Pi: malformed clear payload %j cannot recover cached text or abort', async data => {
  await ready(); incoming({ type: 'queue_update', steering: ['cached'], followUp: [] });
  port.emit('message', { data: { type: 'stop', requestId: 'invalid-clear' } });
  response('clear_queue', data); await turns();
  expect(events().find(value => value.requestId === 'invalid-clear')).toMatchObject({ success: false, error: expect.stringContaining('recovery unknown') });
  expect(events().filter(value => value.event?.type === 'chat-queue-recovered')).toEqual([]);
  expect(control.writes.filter(value => value.type === 'abort')).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});
it.each(['get_state', 'get_messages', 'get_commands'] as const)('strict Pi: %s handshake rejects mismatched command before snapshot', async command => {
  const request = control.writes.find(value => value.type === command);
  incoming({ type: 'response', id: request.id, command: 'prompt', success: true, data: {} }); await turns();
  expect(events().some(value => value.event?.type === 'chat-snapshot' || value.event?.processStatus === 'running')).toBe(false);
  expect(control.terminate).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it('strict Pi: unknown and missing IDs do not settle work; reverse legal responses settle only their own IDs', async () => {
  await ready();
  for (const requestId of ['one', 'two']) port.emit('message', { data: { type: 'rename', requestId, name: requestId } });
  const requests = control.writes.filter(value => value.type === 'set_session_name');
  for (const id of [undefined, 'unknown']) incoming({ type: 'response', id, command: 'set_session_name', success: true });
  await turns(); expect(events().filter(value => value.type === 'response')).toEqual([]); expect(vi.getTimerCount()).toBe(2);
  for (const request of requests.toReversed()) { incoming({ type: 'response', id: request.id, command: request.type, success: true }); await turns(); }
  expect(events().filter(value => value.type === 'response').map(value => value.requestId)).toEqual(['two', 'one']);
  expect(vi.getTimerCount()).toBe(0);
});

for (const command of ['get_state', 'get_messages', 'get_commands'] as const) {
  it.each(malformedAcknowledgements)(`strict Pi: ${command} handshake rejects %s and follows existing startup cleanup`, async (_label, fields) => {
    const request = control.writes.find(value => value.type === command);
    // Use a different command even for get_state, whose name is the matrix's wrong-command value.
    const malformed = { ...fields, ...(fields.command === 'EXPECTED' ? { command } : fields.command === 'get_state' ? { command: 'prompt' } : {}) };
    incoming({ type: 'response', id: request.id, data: command === 'get_state' ? {} : command === 'get_messages' ? { messages: [] } : { commands: [] }, ...malformed });
    await turns();
    expect(events().some(value => value.event?.type === 'chat-snapshot' || value.event?.processStatus === 'running')).toBe(false);
    expect(events().some(value => value.event?.message?.includes('Pi RPC protocol error'))).toBe(true);
    expect(control.terminate).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    const count = events().length; await ready(); expect(events()).toHaveLength(count);
  });
}
it.each([
  ['get_state', null], ['get_state', []], ['get_state', 'state'],
  ['get_messages', {}], ['get_messages', { messages: null }], ['get_messages', { messages: 'messages' }],
  ['get_commands', {}], ['get_commands', { commands: null }], ['get_commands', { commands: 'commands' }],
] as const)('strict Pi: %s rejects incompatible handshake payload %j', async (command, data) => {
  response(command, data); await turns();
  expect(events().some(value => value.event?.type === 'chat-snapshot' || value.event?.processStatus === 'running')).toBe(false);
  expect(control.terminate).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it.each(['prompt', 'set_session_name', 'clear_queue', 'abort', 'get_state', 'get_messages', 'get_commands'] as const)('strict Pi: %s preserves explicit failure error text, including empty strings', async command => {
  const startup = command.startsWith('get_');
  if (!startup) {
    await ready();
    port.emit('message', { data: command === 'prompt' ? { type: 'send', requestId: 'failure', text: 'keep', filePaths: [], images: [], queuePreference: 'steer' }
      : command === 'set_session_name' ? { type: 'rename', requestId: 'failure', name: 'keep' } : { type: 'stop', requestId: 'failure' } });
    if (command === 'abort') { response('clear_queue', { steering: [], followUp: [] }); await turns(); }
  }
  const request = control.writes.findLast(value => value.type === command);
  incoming({ type: 'response', id: request.id, command, success: false, error: '' }); await turns();
  if (startup) expect(control.terminate).toHaveBeenCalledTimes(1);
  else expect(events().find(value => value.requestId === 'failure')).toEqual({ type: 'response', requestId: 'failure', success: false, error: 'Error' });
  expect(vi.getTimerCount()).toBe(0);
});
it('strict Pi: legal empty clear arrays retain recovery-before-abort and allow unused ACK data', async () => {
  await ready(); port.emit('message', { data: { type: 'stop', requestId: 'empty-clear' } });
  response('clear_queue', { steering: [], followUp: [], extra: true }); await turns();
  expect(events().filter(value => value.event?.type === 'chat-queue-recovered').map(value => value.event.queue)).toEqual([{ steering: [], followUp: [] }]);
  expect(events().some(value => value.requestId === 'empty-clear')).toBe(false);
  response('abort', { unused: true }); await turns();
  expect(events().find(value => value.requestId === 'empty-clear')).toEqual({ type: 'response', requestId: 'empty-clear', success: true });
  expect(vi.getTimerCount()).toBe(0);
});
it('strict Pi: queue_update keeps its independent compatibility normalization', async () => {
  await ready(); incoming({ type: 'queue_update', steering: ['keep', 4], followUp: false });
  expect(events().filter(value => value.event?.type === 'chat-state').at(-1).event.state.queue).toEqual({ steering: ['keep'], followUp: [] });
});
it.each(['close', 'exit'] as const)('strict Pi: %s before prompt response suppresses late ACK and clears pending once', async action => {
  await ready(); port.emit('message', { data: { type: 'send', requestId: 'late', text: 'keep', filePaths: [], images: [], queuePreference: 'steer' } });
  const request = control.writes.at(-1);
  if (action === 'close') port.emit('message', { data: { type: 'close' } }); else control.child.emit('exit', 0);
  await turns(); const count = events().length;
  incoming({ type: 'response', id: request.id, command: 'prompt', success: true }); await turns();
  expect(events()).toHaveLength(count); expect(events().some(value => value.requestId === 'late')).toBe(false);
  expect(control.terminate).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
it('strict Pi: correlated malformed ACK frees one of the 32 slots without replay or closing the session', async () => {
  await ready();
  for (let index = 0; index < 32; index++) port.emit('message', { data: { type: 'rename', requestId: `rename-${index}`, name: `${index}` } });
  port.emit('message', { data: { type: 'rename', requestId: 'overflow', name: 'overflow' } }); await turns();
  expect(events().find(value => value.requestId === 'overflow')).toMatchObject({ success: false, error: 'Error: Too many pending Pi requests' });
  const first = control.writes.find(value => value.type === 'set_session_name');
  incoming({ type: 'response', id: first.id, command: 'set_session_name', success: null }); await turns();
  expect(vi.getTimerCount()).toBe(31);
  port.emit('message', { data: { type: 'rename', requestId: 'replacement', name: 'replacement' } });
  expect(control.writes.filter(value => value.type === 'set_session_name')).toHaveLength(33);
  port.emit('message', { data: { type: 'close' } }); await turns(); expect(vi.getTimerCount()).toBe(0);
});
