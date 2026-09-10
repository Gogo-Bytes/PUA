#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const log = process.env.PUA_LIFECYCLE_LOG;
const record = value => appendFileSync(log, `${JSON.stringify(value)}\n`);
const event = value => appendFileSync(`${log}.events`, `${JSON.stringify({ time: Date.now(), ...value })}\n`);
const delay = Number(process.env.PUA_LIFECYCLE_READY_DELAY_MS ?? 0);
if (!Number.isSafeInteger(delay) || delay < 0 || delay > 10000) throw new Error('Invalid fixture readiness delay');
record({ pid: process.pid, host: process.ppid });
if (process.env.PUA_LIFECYCLE_CASE !== 'terminal-close') process.on('SIGTERM', () => {});
process.stdin.on('end', () => {});
setInterval(() => {}, 1000);

const children = [];
try {
  await Promise.all([false, true].map(detached => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', `
      process.on('SIGTERM', () => {});
      process.on('SIGHUP', () => {});
      setInterval(() => {}, 1000);
      ${detached && process.env.PUA_LIFECYCLE_FAULT === 'missing-ready' ? '' : `setTimeout(() => process.send({ ready: process.pid }), ${detached ? delay : 0});`}
    `], { detached, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    children.push(child);
    // Register at spawn, not readiness: failure cleanup must also know slow children.
    if (child.pid) event({ event: 'spawn', pid: child.pid, detached });
    const timer = setTimeout(() => reject(new Error(`descendant readiness deadline: detached=${detached}, pid=${child.pid}`)), 5000);
    const fail = error => { clearTimeout(timer); reject(error); };
    child.once('error', fail);
    child.once('exit', (code, signal) => fail(new Error(`descendant exited before readiness: pid=${child.pid}, code=${code}, signal=${signal}`)));
    child.once('message', message => {
      if (message?.ready !== child.pid) { fail(new Error(`Invalid descendant readiness: pid=${child.pid}`)); return; }
      clearTimeout(timer);
      record({ descendant: child.pid, detached });
      event({ event: 'ready', pid: child.pid, detached });
      resolve();
    });
  })));
} catch (error) {
  event({ event: 'error', message: String(error) });
  console.error(`lifecycle fixture: ${error}`);
  await Promise.all(children.map(child => new Promise(resolve => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    child.once('exit', resolve);
    child.kill('SIGKILL');
  })));
  process.exit(1);
}

// A rejected handshake triggers immediate product cleanup. Only expose it after
// both descendants have installed signal handlers and acknowledged readiness.
let input = '';
process.stdin.on('data', chunk => {
  input += chunk;
  while (input.includes('\n')) {
    const index = input.indexOf('\n');
    const line = input.slice(0, index);
    input = input.slice(index + 1);
    const command = JSON.parse(line);
    let data = command.type === 'get_state' ? { isStreaming: false } : command.type === 'get_messages' ? { messages: [] } : { commands: [] };
    if (process.env.PUA_LIFECYCLE_CASE === 'handshake') data = {};
    event({ event: 'response', command: command.type });
    process.stdout.write(`${JSON.stringify({ type: 'response', id: command.id, command: command.type, success: true, data })}\n`);
  }
});
