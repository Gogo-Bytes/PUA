import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { terminateProcessTree } from '../src/platform/process/process-tree';

it.skipIf(process.platform === 'win32')('escalates ignored SIGTERM and kills inherited plus Pi-style detached descendants', async () => {
  const script = `const {spawn}=require('node:child_process'); process.on('SIGTERM',()=>{}); process.stdin.resume(); process.stdin.on('end',()=>{}); const code="process.on('SIGTERM',()=>{}); console.log(process.pid); setInterval(()=>{},1000)"; for(const detached of [false,true]) spawn(process.execPath,['-e',code],{detached,stdio:['ignore','pipe','ignore']}).stdout.pipe(process.stdout); setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['-e', script], { detached: true, stdio: ['pipe', 'pipe', 'ignore'] });
  const pids: number[] = [];
  try {
    await new Promise<void>((resolve, reject) => { let data = ''; const timeout = setTimeout(() => reject(new Error('fixture timeout')), 2000); child.stdout.on('data', chunk => { data += chunk; const lines = data.trim().split('\n'); if (lines.length === 2) { pids.push(...lines.map(Number)); clearTimeout(timeout); resolve(); } }); });
    const exited = new Promise(resolve => child.once('exit', resolve));
    await terminateProcessTree(child.pid!); await exited;
    for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    try { process.kill(-child.pid!, 'SIGKILL'); } catch {}
    for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  }
}, 5000);
