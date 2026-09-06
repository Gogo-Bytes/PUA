import { terminateProcessTree } from './process-tree.js';
import { utilityProcess, type UtilityProcess } from 'electron';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { ChatAttachment, ChatDelivery, ExtensionUIResponse, SessionEvent } from '../shared/chat.js';
import type { CreateSessionOptions, RuntimeInfo, SessionInfo } from '../shared/contracts.js';
import { expandHome, runtimeEnvironment, terminalEnvironment } from './runtime.js';
import { imageMimeType, MAX_CHAT_ATTACHMENTS, validateImageBudget } from './attachment-policy.js';

interface RegisteredAttachment extends ChatAttachment { selectedPath: string; imageData?: string }
interface ManagedSession {
  info: SessionInfo;
  runtime: RuntimeInfo;
  cols: number;
  rows: number;
  process?: UtilityProcess;
  closing?: boolean;
  childPid?: number;
  closed?: Promise<void>;
  cleanup?: Promise<void>;
  attachmentWork: Promise<unknown>;
  sending?: boolean;
  pending: Map<string, { resolve(value: unknown): void; reject(error: Error): void }>;
  attachments: Map<string, RegisteredAttachment>;
  startMode: 'new' | 'continue' | 'resume';
}

export function validSize(cols: unknown, rows: unknown): cols is number {
  return Number.isInteger(cols) && Number.isInteger(rows) && Number(cols) >= 2 && Number(cols) <= 1000 && Number(rows) >= 2 && Number(rows) <= 1000;
}

export class Sessions {
  private sessions = new Map<string, ManagedSession>();
  private shuttingDown = false;
  constructor(private emit: (event: SessionEvent) => void) {}

  async create(runtime: RuntimeInfo, options: CreateSessionOptions): Promise<SessionInfo> {
    if (this.shuttingDown) throw new Error('应用正在关闭，不能创建会话');
    const { kind, startMode, projectTrust } = options;
    if (kind !== 'chat' && kind !== 'terminal') throw new Error('无效会话类型');
    if (!['new', 'continue', 'resume'].includes(startMode)) throw new Error('无效会话模式');
    if (!['default', 'approve', 'decline'].includes(projectTrust)) throw new Error('无效信任选项');
    if (kind === 'chat' && startMode === 'resume') throw new Error('任意历史选择首期仅支持兼容终端');
    if (kind === 'terminal' && !validSize(options.cols, options.rows)) throw new Error('无效终端尺寸');
    const directory = path.resolve(expandHome(options.cwd));
    if (!(await stat(directory)).isDirectory()) throw new Error('项目路径不是目录');
    if (this.shuttingDown) throw new Error('应用正在关闭，不能创建会话');
    // No await between checking ownership and reserving it in the map.
    const live = [...this.sessions.values()].filter(session => session.info.processStatus !== 'exited' || session.closing);
    if (live.length && (kind === 'terminal' || live.some(session => session.info.kind === 'terminal'))) throw new Error('兼容终端可在内部恢复任意历史，请先关闭其他会话；终端运行或关闭期间不能创建其他会话');
    if ((startMode !== 'new' && live.length) || live.some(session => session.startMode === 'continue' && session.info.processStatus === 'starting')) throw new Error('为避免两个进程写入同一 Pi 历史，会话恢复只能在关闭其他运行会话后开始；恢复就绪前不能创建新会话');
    const id = randomUUID();
    const info: SessionInfo = { id, cwd: directory, title: path.basename(directory) || directory, kind, processStatus: 'starting', activity: 'idle' };
    const args = [...runtime.args];
    if (kind === 'chat') {
      if (startMode === 'continue') args.push('--continue');
      if (projectTrust === 'approve') args.push('--approve');
      if (projectTrust === 'decline') args.push('--no-approve');
    } else {
      if (startMode === 'continue') args.push('--continue');
      if (startMode === 'resume') args.push('--resume');
    }
    this.sessions.set(id, { info, runtime: { ...runtime, args }, cols: options.cols ?? 100, rows: options.rows ?? 30, pending: new Map(), attachments: new Map(), attachmentWork: Promise.resolve(), startMode });
    return { ...info };
  }

  start(id: string): void {
    if (this.shuttingDown) throw new Error('应用正在关闭，不能启动会话');
    const session = this.get(id);
    if (session.closing || session.process || session.info.processStatus === 'exited') return;
    if (session.info.kind === 'chat') this.startChat(session); else this.startTerminal(session);
  }

  private startChat(session: ManagedSession): void {
    const child = utilityProcess.fork(fileURLToPath(new URL('./rpc-host.js', import.meta.url)), [], { serviceName: 'PUA Pi RPC', stdio: 'pipe' });
    session.process = child;
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', data => this.emit({ type: 'chat-notice', id: session.info.id, level: 'error', message: data.toString() }));
    child.on('spawn', () => {
      if (session.closing) { child.kill(); return; }
      child.postMessage({ type: 'start', id: session.info.id, ...session.runtime, cwd: session.info.cwd, env: runtimeEnvironment(session.runtime) });
    });
    child.on('message', (message: { type?: string; pid?: number; event?: SessionEvent; requestId?: string; success?: boolean; data?: unknown; error?: string }) => {
      if (message.type === 'child-pid' && Number.isSafeInteger(message.pid)) session.childPid = message.pid;
      if (message.type === 'event' && message.event) {
        if (message.event.type === 'session-info') {
          if (message.event.title) session.info.title = message.event.title;
          if (message.event.processStatus) session.info.processStatus = message.event.processStatus;
          if (message.event.activity) session.info.activity = message.event.activity;
        }
        if (message.event.type === 'chat-state') session.info.activity = message.event.state.activity ?? session.info.activity;
        if (message.event.type !== 'exit') this.emit(message.event);
      }
      if (message.type === 'response' && message.requestId) {
        const request = session.pending.get(message.requestId); if (!request) return;
        session.pending.delete(message.requestId);
        if (message.success) request.resolve(message.data); else request.reject(new Error(message.error || 'RPC host command failed'));
      }
    });
    child.on('exit', code => this.hostExited(session, code));
  }

  private startTerminal(session: ManagedSession): void {
    const child = utilityProcess.fork(fileURLToPath(new URL('./pty-host.js', import.meta.url)), [], { serviceName: 'PUA Pi terminal', stdio: 'pipe' });
    session.process = child;
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', data => this.emit({ type: 'terminal-data', id: session.info.id, data: data.toString() }));
    child.on('spawn', () => {
      if (session.closing) { child.kill(); return; }
      session.info.processStatus = 'running';
      this.emit({ type: 'session-info', id: session.info.id, processStatus: 'running' });
      child.postMessage({ type: 'start', ...session.runtime, cwd: session.info.cwd, cols: session.cols, rows: session.rows, env: terminalEnvironment(session.runtime) });
    });
    child.on('message', (message: { type: string; pid?: number; data?: string; message?: string; exitCode?: number }) => {
      if (message.type === 'child-pid' && Number.isSafeInteger(message.pid)) session.childPid = message.pid;
      if (message.type === 'data' && typeof message.data === 'string') this.emit({ type: 'terminal-data', id: session.info.id, data: message.data });
      if (message.type === 'error') this.emit({ type: 'terminal-data', id: session.info.id, data: `\r\nPi 启动失败：${message.message}\r\n` });

    });
    child.on('exit', code => this.hostExited(session, code));
  }

  private hostExited(session: ManagedSession, code: number): void {
    // Publish cleanup synchronously, so close cannot wait for an already-emitted host exit.
    session.process = undefined;
    session.cleanup = (async () => {
      if (session.childPid) await terminateProcessTree(session.childPid);
      this.exited(session, code);
    })();
    void session.cleanup.catch(error => this.emit({ type: 'chat-notice', id: session.info.id, level: 'error', message: `进程清理失败，仍保留会话占用：${String(error)}` }));
  }

  private exited(session: ManagedSession, exitCode: number): void {
    if (session.info.processStatus === 'exited') return;
    session.info.processStatus = 'exited'; session.info.activity = 'idle'; session.info.exitCode = exitCode;
    for (const request of session.pending.values()) request.reject(new Error(`会话已退出 · ${exitCode}`));
    session.pending.clear(); session.attachments.clear();
    this.emit({ type: 'exit', id: session.info.id, exitCode });
  }

  private request(session: ManagedSession, message: Record<string, unknown>): Promise<unknown> {
    if (session.info.kind !== 'chat') return Promise.reject(new Error('这不是原生对话会话'));
    if (!session.process || session.closing || (session.info.processStatus !== 'running' && !(session.info.processStatus === 'starting' && message.type === 'extension-response'))) return Promise.reject(new Error('Pi 对话进程尚未运行'));
    if (session.pending.size >= 32) return Promise.reject(new Error('Pi 请求过多，请等待当前操作完成'));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setInterval(() => {
        if (session.info.activity === 'waiting-input') return;
        clearInterval(timer); session.pending.delete(requestId); reject(new Error('Pi 请求超时，接收状态未知；正在关闭会话，不会自动重发'));
        void this.close(session.info.id);
      }, 360_000);
      timer.unref();
      session.pending.set(requestId, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      session.process!.postMessage({ ...message, requestId });
    });
  }

  registerAttachments(id: string, paths: string[]): Promise<ChatAttachment[]> {
    const session = this.get(id);
    const work = session.attachmentWork.then(() => this.readAttachments(id, paths));
    session.attachmentWork = work.catch(() => {});
    return work;
  }
  removeAttachment(id: string, attachmentId: string): void {
    const session = this.get(id); if (session.info.kind !== 'chat') throw new Error('附件只支持原生对话');
    session.attachments.delete(attachmentId);
  }
  private async readAttachments(id: string, paths: string[]): Promise<ChatAttachment[]> {
    const session = this.get(id); if (session.info.kind !== 'chat') throw new Error('附件只支持原生对话');
    const next: RegisteredAttachment[] = [];
    const existingImages: Array<{ size: number }> = [...session.attachments.values()].filter(item => item.kind === 'image');
    if (session.attachments.size + paths.length > MAX_CHAT_ATTACHMENTS) throw new Error(`单次消息最多添加 ${MAX_CHAT_ATTACHMENTS} 个文件引用`);
    for (const selectedPath of paths) {
      const mimeType = imageMimeType(selectedPath);
      let size: number; let imageData: string | undefined;
      if (mimeType) {
        const handle = await open(selectedPath, 'r');
        try {
          const stats = await handle.stat(); if (!stats.isFile()) throw new Error(`${selectedPath} 不是文件`);
          size = stats.size; validateImageBudget(existingImages, { name: path.basename(selectedPath), size });
          const bytes = Buffer.alloc(size); let offset = 0; while (offset < size) { const read = await handle.read(bytes, offset, size - offset, offset); if (!read.bytesRead) break; offset += read.bytesRead; }
          imageData = bytes.subarray(0, offset).toString('base64'); existingImages.push({ size });
        } finally { await handle.close(); }
      } else { const stats = await stat(selectedPath); if (!stats.isFile()) throw new Error(`${selectedPath} 不是文件`); size = stats.size; }
      const attachment: RegisteredAttachment = { id: randomUUID(), name: path.basename(selectedPath), path: selectedPath, selectedPath, kind: mimeType ? 'image' : 'file', mimeType, size, imageData };
      if (mimeType) attachment.previewUrl = `data:${mimeType};base64,${imageData}`;
      next.push(attachment);
    }
    if (session.closing || session.info.processStatus === 'exited' || this.sessions.get(id) !== session) throw new Error('会话已关闭');
    for (const attachment of next) session.attachments.set(attachment.id, attachment);
    return next.map(({ selectedPath: _, imageData: __, ...item }) => item);
  }

  async sendChatMessage(id: string, text: string, attachmentIds: string[], delivery: ChatDelivery): Promise<void> {
    const session = this.get(id);
    if (!['prompt', 'steer', 'followUp'].includes(delivery)) throw new Error('无效发送方式');
    if (!text.trim() && attachmentIds.length === 0) throw new Error('消息不能为空');
    if (attachmentIds.length > MAX_CHAT_ATTACHMENTS || new Set(attachmentIds).size !== attachmentIds.length) throw new Error('无效附件列表');
    const selected = attachmentIds.map(attachmentId => { const item = session.attachments.get(attachmentId); if (!item) throw new Error('附件已失效，请重新选择'); return item; });
    const selectedImages: Array<{ size: number }> = []; for (const item of selected.filter(item => item.kind === 'image')) { validateImageBudget(selectedImages, { name: item.name, size: item.size }); selectedImages.push({ size: item.size }); }
    const files = selected.filter(item => item.kind === 'file');
    const images = selected.filter(item => item.kind === 'image').map(item => ({ type: 'image', data: item.imageData, mimeType: item.mimeType }));
    const references = files.length ? `\n\n参考文件路径：\n${files.map(item => `- ${JSON.stringify(item.selectedPath)}`).join('\n')}` : '';
    const command = { type: 'prompt', message: `${text}${references}`, images, streamingBehavior: delivery === 'followUp' ? 'followUp' : 'steer' };
    if (session.sending) throw new Error('上一条消息尚未确认，请稍候');
    session.sending = true;
    try {
      await this.request(session, { type: 'command', command });
      for (const attachmentId of attachmentIds) session.attachments.delete(attachmentId);
    } finally { session.sending = false; }
  }

  async stopChat(id: string): Promise<void> { await this.request(this.get(id), { type: 'stop' }); }
  async respondToExtensionUI(id: string, response: ExtensionUIResponse): Promise<void> { await this.request(this.get(id), { type: 'extension-response', response }); }
  async renameChatSession(id: string, name: string): Promise<void> { await this.request(this.get(id), { type: 'command', command: { type: 'set_session_name', name } }); this.get(id).info.title = name; }

  get(id: string): ManagedSession { const session = this.sessions.get(id); if (!session) throw new Error('会话不存在'); return session; }
  write(id: string, data: string): void { const session = this.get(id); if (session.info.kind !== 'terminal' || session.closing) return; if (session.info.processStatus === 'running') session.process?.postMessage({ type: 'write', data }); }
  resize(id: string, cols: number, rows: number): void { if (!validSize(cols, rows)) return; const session = this.get(id); if (session.info.kind !== 'terminal' || session.closing) return; session.cols = cols; session.rows = rows; if (session.info.processStatus === 'running') session.process?.postMessage({ type: 'resize', cols, rows }); }
  acknowledge(id: string, size: number): void { const session = this.sessions.get(id); if (session?.info.kind === 'terminal' && !session.closing) session.process?.postMessage({ type: 'ack', size }); }
  hasBusy(): boolean { return [...this.sessions.values()].some(session => session.info.kind === 'terminal' ? session.info.processStatus === 'running' : session.info.activity !== 'idle' && session.info.processStatus !== 'exited'); }
  close(id: string): Promise<void> {
    const session = this.get(id);
    if (session.closed) return session.closed;
    session.closing = true; session.attachments.clear();
    session.closed = (async () => {
      if (session.process && session.info.processStatus !== 'exited') {
        const child = session.process;
        const hostExit = new Promise<void>(resolve => child.once('exit', () => resolve()));
        child.postMessage({ type: 'close' });
        const fallback = setTimeout(() => {
          void (session.childPid ? terminateProcessTree(session.childPid) : Promise.resolve()).catch(error => this.emit({ type: 'chat-notice', id, level: 'error', message: String(error) })).finally(() => child.kill());
        }, 2000);
        await hostExit; clearTimeout(fallback);
      }
      await session.cleanup;
      this.exited(session, session.info.exitCode ?? 0);
      this.sessions.delete(id);
    })();
    return session.closed;
  }
  async closeAll(): Promise<void> { this.shuttingDown = true; await Promise.all([...this.sessions.keys()].map(id => this.close(id))); }
}
