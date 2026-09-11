import { parsePtyWorkerOutput } from '../src/shared/ipc/worker-schemas';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const control = vi.hoisted(() => ({ spawn: vi.fn(), terminate: vi.fn() }));
vi.mock('node-pty', () => ({ spawn: control.spawn }));
vi.mock('../src/platform/process/process-tree', () => ({ terminateProcessTree: control.terminate }));
let originalPort: unknown;
let port: EventEmitter;
let rootExit: (event: { exitCode: number }) => void;
let finishCleanup: () => void;
let terminal: { pid: number; write: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn>; onData: ReturnType<typeof vi.fn>; onExit: ReturnType<typeof vi.fn> };
const send = (data: unknown) => port.emit('message', { data });

beforeEach(async () => {
  vi.resetModules();
  originalPort = (process as any).parentPort;
  port = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  (process as any).parentPort = port;
  terminal = { pid: 1234, write: vi.fn(), resize: vi.fn(), pause: vi.fn(), resume: vi.fn(), onData: vi.fn(), onExit: vi.fn(callback => { rootExit = callback; }) };
  control.spawn.mockReset().mockReturnValue(terminal);
  control.terminate.mockReset().mockImplementation(() => new Promise<void>(resolve => { finishCleanup = resolve; }));
  vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  await import('../src/app/workers/pty.worker');
  send({ type: 'start', executable: 'fixture', args: [], cwd: '/tmp', env: {}, cols: 80, rows: 24 });
});
afterEach(() => {
  (process as any).parentPort = originalPort; vi.restoreAllMocks();
  for (const [message] of (port as EventEmitter & { postMessage: ReturnType<typeof vi.fn> }).postMessage.mock.calls) expect(parsePtyWorkerOutput(message)).toEqual(message);
});

it('ignores late PTY operations after root exit until descendant escalation completes', async () => {
  send({ type: 'close' });
  rootExit({ exitCode: 0 });
  terminal.resize.mockImplementation(() => { throw new Error('PTY already closed'); });
  send({ type: 'resize', cols: 100, rows: 30 });
  send({ type: 'write', data: 'late input' });
  send({ type: 'ack', size: 100 });
  send({ type: 'close' });
  expect(terminal.resize).not.toHaveBeenCalled();
  expect(terminal.write).not.toHaveBeenCalled();
  expect(terminal.resume).not.toHaveBeenCalled();
  expect(process.exit).not.toHaveBeenCalled();
  expect(control.terminate).toHaveBeenCalledTimes(1);
  finishCleanup();
  await Promise.resolve();
  expect(process.exit).toHaveBeenCalledWith(0);
});

it('operation failures use the same awaited cleanup instead of exiting immediately', async () => {
  terminal.resize.mockImplementation(() => { throw new Error('PTY unavailable'); });
  send({ type: 'resize', cols: 100, rows: 30 });
  rootExit({ exitCode: 0 });
  expect(control.terminate).toHaveBeenCalledWith(1234);
  expect(process.exit).not.toHaveBeenCalled();
  finishCleanup();
  await Promise.resolve();
  expect(process.exit).toHaveBeenCalledWith(1);
});

it('worker protocol ignores malformed and wrong-direction controls without PTY or cleanup effects', () => {
  for (const data of [null, [], {}, { type: 'write', data: 7 }, { type: 'resize', cols: 1, rows: 24 },
    { type: 'ack', size: -1 }, { type: 'command', command: { type: 'prompt' } }, { type: 'data', data: 'wrong' },
    { type: 'start', executable: 'external', args: [], cwd: '/fake', env: { BAD: 1 }, cols: 80, rows: 24 }]) send(data);
  expect(control.spawn).toHaveBeenCalledTimes(1); expect(terminal.write).not.toHaveBeenCalled();
  expect(terminal.resize).not.toHaveBeenCalled(); expect(terminal.resume).not.toHaveBeenCalled();
  expect(control.terminate).not.toHaveBeenCalled(); expect(process.exit).not.toHaveBeenCalled();
});
it('worker protocol preserves NUL/large paste and output ACK character units', () => {
  const paste = '\0文'.repeat(200_000); send({ type: 'write', data: paste });
  expect(terminal.write).toHaveBeenCalledExactlyOnceWith(paste);
  const data = terminal.onData.mock.calls[0][0];
  data('文'.repeat(256 * 1024)); expect(terminal.pause).toHaveBeenCalledTimes(1);
  send({ type: 'ack', size: 192 * 1024 - 1 }); expect(terminal.resume).not.toHaveBeenCalled();
  send({ type: 'ack', size: 1 }); expect(terminal.resume).toHaveBeenCalledTimes(1);
  expect((port as EventEmitter & { postMessage: ReturnType<typeof vi.fn> }).postMessage.mock.calls.at(-1)![0]).toEqual({ type: 'data', data: '文'.repeat(256 * 1024) });
});
it('failed PTY output closes once without recursively posting an error or touching late controls', async () => {
  const post = (port as EventEmitter & { postMessage: ReturnType<typeof vi.fn> }).postMessage;
  post.mockImplementation(() => { throw new Error('output failed'); });
  terminal.onData.mock.calls[0][0]('output');
  send({ type: 'write', data: 'late' }); send({ type: 'close' }); rootExit({ exitCode: 0 });
  expect(post).toHaveBeenCalledTimes(2); // initial PID, then one failed data post
  expect(control.terminate).toHaveBeenCalledTimes(1); expect(terminal.write).not.toHaveBeenCalled();
  finishCleanup(); await Promise.resolve(); expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
});
