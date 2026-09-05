import * as pty from 'node-pty';
import { OutputFlow } from './flow-control.js';

type HostMessage =
  | { type: 'start'; executable: string; args: string[]; cwd: string; env: Record<string, string>; cols: number; rows: number }
  | { type: 'write'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'ack'; size: number }
  | { type: 'close' };

// Electron utility process: native PTY crashes cannot bring down the window/main process.
const port = process.parentPort;
if (!port) throw new Error('PTY host must run as an Electron utility process');
let terminal: pty.IPty | undefined;
let closing = false;
const send = (message: unknown) => port.postMessage(message);
const flow = new OutputFlow(() => terminal?.pause(), () => terminal?.resume());

port.on('message', ({ data }: { data: HostMessage }) => {
  try {
    switch (data.type) {
      case 'start':
        if (terminal || closing) return;
        terminal = pty.spawn(data.executable, data.args, {
          name: 'xterm-256color', cwd: data.cwd, env: data.env, cols: data.cols, rows: data.rows,
        });
        terminal.onData(text => { flow.sent(text.length); send({ type: 'data', data: text }); });
        terminal.onExit(({ exitCode }) => { send({ type: 'exit', exitCode }); process.exit(0); });
        break;
      case 'write': terminal?.write(data.data); break;
      case 'resize': terminal?.resize(data.cols, data.rows); break;
      case 'ack': flow.acknowledge(data.size); break;
      case 'close':
        closing = true;
        if (terminal) terminal.kill(); else process.exit(0);
        break;
    }
  } catch (error) {
    send({ type: 'error', message: String(error) });
    try { terminal?.kill(); } finally { process.exit(1); }
  }
});
