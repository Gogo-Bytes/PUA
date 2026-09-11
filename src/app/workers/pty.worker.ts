import { parsePtyWorkerInput } from '../../shared/ipc/worker-schemas.js';
import type { PtyWorkerOutput } from '../../shared/ipc/worker-protocol.js';
import { terminateProcessTree } from '../../platform/process/process-tree.js';
import * as pty from 'node-pty';
import { OutputFlow } from '../../platform/pty/output-flow.js';

// Electron utility process: native PTY crashes cannot bring down the window/main process.
const port = process.parentPort;
if (!port) throw new Error('PTY host must run as an Electron utility process');
let terminal: pty.IPty | undefined;
let closing = false;
function shutdown(exitCode: number): void {
  if (closing) return;
  closing = true;
  void (terminal ? terminateProcessTree(terminal.pid) : Promise.resolve())
    .then(() => { process.exit(exitCode); }, error => {
      send({ type: 'error', message: String(error) });
      process.exit(1);
    });
}
let outputFailed = false;
function send(message: PtyWorkerOutput): void {
  if (outputFailed) return;
  try { port!.postMessage(message); }
  catch {
    outputFailed = true;
    shutdown(1);
  }
}
const flow = new OutputFlow(() => terminal?.pause(), () => terminal?.resume());

port.on('message', ({ data: raw }: { data: unknown }) => {
  const data = parsePtyWorkerInput(raw);
  if (!data) return;
  // Queued resize/write/ACK messages must not touch a PTY whose root has exited
  // while descendant termination is still escalating. Close is idempotent too.
  if (closing) return;
  try {
    switch (data.type) {
      case 'start':
        if (terminal || closing) return;
        terminal = pty.spawn(data.executable, data.args, {
          name: 'xterm-256color', cwd: data.cwd, env: data.env, cols: data.cols, rows: data.rows,
        });
        send({ type: 'child-pid', pid: terminal.pid });
        terminal.onData(text => { if (closing) return; flow.sent(text.length); send({ type: 'data', data: text }); });
        terminal.onExit(({ exitCode }) => { send({ type: 'exit', exitCode }); if (!closing) process.exit(0); });
        break;
      case 'write': terminal?.write(data.data); break;
      case 'resize': terminal?.resize(data.cols, data.rows); break;
      case 'ack': flow.acknowledge(data.size); break;
      case 'close':
        shutdown(0);
        break;
    }
  } catch (error) {
    send({ type: 'error', message: String(error) });
    shutdown(1);
  }
});
