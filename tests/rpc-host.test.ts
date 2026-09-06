import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const control = vi.hoisted(() => ({ child: undefined as any, writes: [] as any[], failed: false, rejectDialog: false, terminate: vi.fn().mockResolvedValue(undefined) }));
vi.mock('node:child_process', () => ({ spawn: () => control.child }));
vi.mock('../src/main/process-tree', () => ({ terminateProcessTree: control.terminate }));
vi.mock('../src/main/rpc-writer', () => ({ RpcWriter: class {
  get failed() { return control.failed; }
  write(value: any) { control.writes.push(value); if (value.type === 'extension_ui_response' && control.rejectDialog) { control.failed = true; return Promise.reject(new Error('input stalled')); } return Promise.resolve(); }
  close() {}
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
  vi.resetModules(); vi.useFakeTimers(); control.writes = []; control.failed = false; control.rejectDialog = false; control.terminate.mockClear();
  originalPort = (process as any).parentPort;
  port = Object.assign(new EventEmitter(), { postMessage: vi.fn() }); (process as any).parentPort = port;
  control.child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  await import('../src/main/rpc-host');
  port.emit('message', { data: { type: 'start', id: 's', executable: 'fixture', args: [], cwd: '/tmp', env: {} } });
  control.child.emit('spawn'); await turns();
});
afterEach(() => { (process as any).parentPort = originalPort; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
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
