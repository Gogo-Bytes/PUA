#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const log = process.env.PUA_LIFECYCLE_LOG;
const record = value => appendFileSync(log, `${JSON.stringify(value)}\n`);
record({ pid: process.pid, host: process.ppid });
if (process.env.PUA_LIFECYCLE_CASE !== 'terminal-close') process.on('SIGTERM', () => {});
process.stdin.on('end', () => {});
setInterval(() => {}, 1000);
for (const detached of [false, true]) {
  const child = spawn(process.execPath, ['-e', `process.on('SIGTERM',()=>{});process.on('SIGHUP',()=>{});console.log(process.pid);setInterval(()=>{},1000)`], { detached, stdio: ['ignore', 'pipe', 'ignore'] });
  child.stdout.once('data', data => record({ descendant: Number(String(data).trim()), detached }));
}
let input = '';
process.stdin.on('data', chunk => {
  input += chunk;
  while (input.includes('\n')) {
    const index = input.indexOf('\n'); const line = input.slice(0, index); input = input.slice(index + 1);
    const command = JSON.parse(line);
    let data = command.type === 'get_state' ? { isStreaming: false } : command.type === 'get_messages' ? { messages: [] } : { commands: [] };
    if (process.env.PUA_LIFECYCLE_CASE === 'handshake') data = {};
    process.stdout.write(`${JSON.stringify({ type: 'response', id: command.id, command: command.type, success: true, data })}\n`);
  }
});
