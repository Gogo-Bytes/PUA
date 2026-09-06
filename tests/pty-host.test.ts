import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const control = vi.hoisted(() => ({ spawn: vi.fn(), terminate: vi.fn() }));
vi.mock('node-pty', () => ({ spawn: control.spawn }));
vi.mock('../src/main/process-tree', () => ({ terminateProcessTree: control.terminate }));
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
  await import('../src/main/pty-host');
  send({ type: 'start', executable: 'fixture', args: [], cwd: '/tmp', env: {}, cols: 80, rows: 24 });
});
afterEach(() => { (process as any).parentPort = originalPort; vi.restoreAllMocks(); });

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
