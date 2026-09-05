import { utilityProcess, type UtilityProcess } from 'electron';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { RuntimeInfo, SessionInfo, TerminalEvent } from '../shared/contracts.js';
import { expandHome, terminalEnvironment } from './runtime.js';

interface ManagedSession {
  info: SessionInfo;
  runtime: RuntimeInfo;
  cols: number;
  rows: number;
  process?: UtilityProcess;
  closing?: boolean;
}

export function validSize(cols: unknown, rows: unknown): cols is number {
  return Number.isInteger(cols) && Number.isInteger(rows) && Number(cols) >= 2 && Number(cols) <= 1000 && Number(rows) >= 2 && Number(rows) <= 1000;
}

export class Sessions {
  private sessions = new Map<string, ManagedSession>();
  constructor(private emit: (event: TerminalEvent) => void) {}

  async create(runtime: RuntimeInfo, cwd: string, mode: string, cols: number, rows: number): Promise<SessionInfo> {
    if (!validSize(cols, rows)) throw new Error('无效终端尺寸');
    if (!['new', 'continue', 'resume'].includes(mode)) throw new Error('无效会话模式');
    const directory = path.resolve(expandHome(cwd));
    if (!(await stat(directory)).isDirectory()) throw new Error('项目路径不是目录');
    const id = randomUUID();
    const info: SessionInfo = { id, cwd: directory, title: path.basename(directory) || directory, status: 'running' };
    const args = [...runtime.args, ...(mode === 'continue' ? ['--continue'] : mode === 'resume' ? ['--resume'] : [])];
    this.sessions.set(id, { info, runtime: { ...runtime, args }, cols, rows });
    return { ...info };
  }

  start(id: string): void {
    const session = this.get(id);
    if (session.process || session.info.status === 'exited') return;
    const child = utilityProcess.fork(fileURLToPath(new URL('./pty-host.js', import.meta.url)), [], { serviceName: 'Pi terminal', stdio: 'pipe' });
    session.process = child;
    // Always drain diagnostics; do not duplicate agent transcripts to disk.
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', data => this.emit({ type: 'data', id, data: data.toString() }));
    child.on('spawn', () => {
      if (session.closing) { child.kill(); return; }
      child.postMessage({ type: 'start', ...session.runtime, cwd: session.info.cwd, cols: session.cols, rows: session.rows, env: terminalEnvironment(session.runtime) });
    });
    child.on('message', (message: { type: string; data?: string; message?: string; exitCode?: number }) => {
      if (message.type === 'data' && typeof message.data === 'string') this.emit({ type: 'data', id, data: message.data });
      if (message.type === 'error') this.emit({ type: 'data', id, data: `\r\nPi 启动失败：${message.message}\r\n` });
      if (message.type === 'exit') this.exited(session, message.exitCode ?? 0);
    });
    child.on('exit', code => this.exited(session, code));
  }

  private exited(session: ManagedSession, exitCode: number): void {
    if (session.info.status === 'exited') return;
    session.info.status = 'exited';
    session.info.exitCode = exitCode;
    this.emit({ type: 'exit', id: session.info.id, exitCode });
  }

  get(id: string): ManagedSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error('会话不存在');
    return session;
  }
  write(id: string, data: string): void {
    const session = this.get(id);
    if (session.info.status === 'running') session.process?.postMessage({ type: 'write', data });
  }
  resize(id: string, cols: number, rows: number): void {
    if (!validSize(cols, rows)) return;
    const session = this.get(id);
    session.cols = cols; session.rows = rows;
    if (session.info.status === 'running') session.process?.postMessage({ type: 'resize', cols, rows });
  }
  acknowledge(id: string, size: number): void {
    this.sessions.get(id)?.process?.postMessage({ type: 'ack', size });
  }
  hasRunning(): boolean { return [...this.sessions.values()].some(s => s.info.status === 'running'); }
  close(id: string): void {
    const session = this.get(id);
    session.closing = true;
    if (session.process) {
      const child = session.process;
      child.postMessage({ type: 'close' });
      const fallback = setTimeout(() => child.kill(), 2000);
      fallback.unref();
      child.once('exit', () => clearTimeout(fallback));
    }
    this.sessions.delete(id);
  }
  closeAll(): void { for (const id of this.sessions.keys()) this.close(id); }
}
