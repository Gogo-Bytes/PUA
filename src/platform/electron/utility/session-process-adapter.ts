import type { RpcOperation, RpcWorkerInput, PtyWorkerInput, WorkerInputPort } from '../../../shared/ipc/worker-protocol.js';
import { parseRpcWorkerOutput, parsePtyWorkerOutput, workerRequestId } from '../../../shared/ipc/worker-schemas.js';
import type { Terminal } from '../../../modules/terminal/index.js';
import { utilityProcess, type UtilityProcess } from 'electron';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { terminateProcessTree } from '../../process/process-tree.js';
import { runtimeEnvironment, terminalEnvironment } from '../../pi/process/environment.js';
import { MissingAssistantDiagnosticSession, withoutMissingAssistantDiagnostics } from './missing-assistant-diagnostics.js';
import { imageMimeType } from '../../filesystem/attachment-policy.js';
import { validSize } from '../../../shared/ipc/schemas.js';
import type { ChatAttachment, SessionEvent, SessionActivity } from '../../../shared/ipc/conversation.js';
import type { CreateSessionOptions, RuntimeInfo } from '../../../shared/ipc/desktop-api.js';
import type { SessionProcessPort, SessionProcessEvent, SessionSnapshot } from '../../../modules/sessions/index.js';
import type { Attachment, AttachmentMetadata, AttachmentResourcesPort, AttachmentSourceId, AttachmentToken, ConversationRuntimePort, ExtensionResponse, RuntimeSend } from '../../../modules/conversation/index.js';

type ProcessHost = Omit<UtilityProcess, 'postMessage'> & WorkerInputPort<RpcWorkerInput | PtyWorkerInput>;
interface AttachmentPayload extends ChatAttachment { imageData?: string }
interface ProcessResource {
  id: string;
  runtime: RuntimeInfo;
  cols: number;
  rows: number;
  host?: ProcessHost;
  hostEnded: boolean;
  hostExit: Promise<void>;
  resolveHostExit(): void;
  exitCode: number;
  invalidated: boolean;
  childPid?: number;
  closed?: Promise<{ exitCode: number }>;
  treeCleanup?: Promise<void>;
  activity: SessionActivity;
  pending: Map<string, { resolve(): void; reject(error: Error): void }>;
  payloads: Map<AttachmentToken, AttachmentPayload>;
  sources: Map<AttachmentSourceId, string>;
}
export interface SessionProcessContext {
  workerPaths: { chat: string; terminal: string };
  snapshot(id: string): SessionSnapshot | undefined;
  close(id: string): Promise<void>;
  emit(event: SessionEvent): void;
  /** Synchronous, non-throwing business invalidation; never releases Session ownership. */
  invalidateConversation(id: string): void;
}

/** Main-side resource owner. Lifecycle permissions are read from the coordinator, never cached here. */
export class SessionProcessAdapter implements SessionProcessPort, ConversationRuntimePort, AttachmentResourcesPort, Terminal {
  private readonly resources = new Map<string, ProcessResource>();
  private readonly diagnostics = new MissingAssistantDiagnosticSession(process.env.PUA_MISSING_ASSISTANT_DIAGNOSTICS, line => console.info(line));
  private lifecycle: (event: SessionProcessEvent) => void = () => {};
  constructor(private readonly context: SessionProcessContext) {}
  observe(listener: (event: SessionProcessEvent) => void): void { this.lifecycle = listener; }
  register(id: string, runtime: RuntimeInfo, options: CreateSessionOptions): void {
    if (this.resources.has(id)) throw new Error('Duplicate process resource');
    const args = [...runtime.args];
    if (options.startMode === 'continue') args.push('--continue');
    if (options.kind === 'terminal' && options.startMode === 'resume') args.push('--resume');
    if (options.kind === 'chat' && options.projectTrust === 'approve') args.push('--approve');
    if (options.kind === 'chat' && options.projectTrust === 'decline') args.push('--no-approve');
    let resolveHostExit!: () => void;
    const hostExit = new Promise<void>(resolve => { resolveHostExit = resolve; });
    this.resources.set(id, { id, runtime: { ...runtime, args }, cols: options.cols ?? 100, rows: options.rows ?? 30, hostEnded: false, hostExit, resolveHostExit, exitCode: 0, invalidated: false, activity: 'idle', pending: new Map(), payloads: new Map(), sources: new Map() });
    this.diagnostics.register(id, options.kind);
  }
  forget(id: string): void { this.resources.delete(id); }
  activity(id: string): SessionActivity { return this.resources.get(id)?.activity ?? 'idle'; }
  private snapshot(resource: ProcessResource): SessionSnapshot {
    const snapshot = this.context.snapshot(resource.id); if (!snapshot) throw new Error('会话不存在'); return snapshot;
  }
  private resource(id: string): ProcessResource { const resource = this.resources.get(id); if (!resource) throw new Error('会话不存在'); return resource; }
  private accepts(resource: ProcessResource): boolean {
    const phase = this.context.snapshot(resource.id)?.lifecycle.phase;
    return this.resources.get(resource.id) === resource && !resource.invalidated && (phase === 'reserved' || phase === 'starting' || phase === 'running');
  }
  private emit(event: SessionEvent): void { this.diagnostics.output.record('main-forwarded', event.id, event); try { this.context.emit(event); } catch { /* Observers cannot break transport cleanup. */ } }
  private notice(id: string, error: unknown): void { this.emit({ type: 'chat-notice', id, level: 'error', message: String(error) }); }
  start(id: string): void {
    const resource = this.resource(id);
    if (!this.accepts(resource) || resource.host || resource.hostEnded) return;
    const snapshot = this.snapshot(resource);
    const chat = snapshot.kind === 'chat';
    const worker = chat ? this.context.workerPaths.chat : this.context.workerPaths.terminal;
    const diagnosticEnv = process.env.PUA_MISSING_ASSISTANT_DIAGNOSTICS !== undefined || process.env.PUA_MISSING_ASSISTANT_DIAGNOSTIC_SESSION !== undefined
      ? this.diagnostics.workerEnvironment(process.env, id) : undefined;
    const host: ProcessHost = utilityProcess.fork(worker, [], { serviceName: chat ? 'PUA Pi RPC' : 'PUA Pi terminal', stdio: 'pipe', ...(diagnosticEnv ? { env: diagnosticEnv } : {}) });
    resource.host = host;
    host.stdout?.on('data', data => {
      if (!this.diagnostics.output.enabled(id)) return;
      try { this.diagnostics.output.relay(id, data.toString()); } catch { /* Diagnostic stdout cannot affect transport. */ }
    });
    host.stderr?.on('data', data => {
      if (!this.accepts(resource)) return;
      this.emit(chat ? { type: 'chat-notice', id, level: 'error', message: data.toString() } : { type: 'terminal-data', id, data: data.toString() });
    });
    host.on('spawn', () => {
      if (!this.accepts(resource)) return;
      if (!chat) this.lifecycle({ type: 'ready', id });
      // A ready observer may synchronously close the session.
      if (!this.accepts(resource)) return;
      try {
        host.postMessage(chat
          ? { type: 'start', id, executable: resource.runtime.executable, args: resource.runtime.args, cwd: snapshot.cwd, env: withoutMissingAssistantDiagnostics(runtimeEnvironment(resource.runtime)) } satisfies RpcWorkerInput
          : { type: 'start', executable: resource.runtime.executable, args: resource.runtime.args, cwd: snapshot.cwd, cols: resource.cols, rows: resource.rows, env: withoutMissingAssistantDiagnostics(terminalEnvironment(resource.runtime)) } satisfies PtyWorkerInput);
      } catch (error) { this.lifecycle({ type: 'start-failed', id, detail: String(error) }); }
    });
    host.on('message', (raw: unknown) => {
      if (this.resources.get(id) !== resource || resource.hostEnded) return;
      const message = chat ? parseRpcWorkerOutput(raw, id) : parsePtyWorkerOutput(raw);
      if (!message) {
        const requestId = workerRequestId(raw);
        if (chat && requestId) resource.pending.get(requestId)?.reject(new Error('Invalid RPC worker response'));
        return;
      }
      // PID registration remains allowed during graceful close, before the host has ended.
      if (message.type === 'child-pid') resource.childPid = message.pid;
      if (!this.accepts(resource)) return;
      if (chat && message.type === 'event' && message.event) {
        const event = message.event;
        this.diagnostics.output.record('main-accepted', id, event);
        if (event.type === 'session-info') {
          if (event.title) this.lifecycle({ type: 'title-changed', id, title: event.title });
          if (event.processStatus === 'running') this.lifecycle({ type: 'ready', id });
          if (!this.accepts(resource)) return;
          if (event.activity) { resource.activity = event.activity; this.emit({ type: 'session-info', id, activity: event.activity }); }
        } else if (event.type !== 'exit') {
          if (event.type === 'chat-state') resource.activity = event.state.activity ?? resource.activity;
          this.emit(event);
        }
      }
      if (chat && message.type === 'response' && message.requestId) {
        const request = resource.pending.get(message.requestId);
        if (message.success) request?.resolve(); else request?.reject(new Error(message.error || 'RPC host command failed'));
      }
      if (!chat && message.type === 'data' && typeof message.data === 'string') this.emit({ type: 'terminal-data', id, data: message.data });
      if (!chat && message.type === 'error') this.emit({ type: 'terminal-data', id, data: `\r\nPi 启动失败：${message.message}\r\n` });
    });
    host.on('exit', code => {
      if (this.resources.get(id) !== resource || resource.hostEnded) return;
      resource.hostEnded = true; resource.exitCode = code;
      resource.resolveHostExit();
      this.invalidate(resource, new Error(`会话已退出 · ${code}`));
      this.lifecycle({ type: 'transport-ended', id });
    });
  }
  private invalidate(resource: ProcessResource, error: Error): void {
    resource.invalidated = true;
    this.context.invalidateConversation(resource.id);
    resource.payloads.clear();
    resource.sources.clear();
    for (const request of resource.pending.values()) request.reject(error);
  }
  private cleanupTree(resource: ProcessResource): Promise<void> {
    if (!resource.childPid) return Promise.resolve();
    return resource.treeCleanup ??= terminateProcessTree(resource.childPid);
  }
  close(id: string): Promise<{ exitCode: number }> {
    const resource = this.resources.get(id);
    // Registration can fail before any resource is installed; no external work has begun.
    if (!resource) return Promise.resolve({ exitCode: 0 });
    if (resource.closed) return resource.closed;
    let resolve!: (result: { exitCode: number }) => void;
    let reject!: (error: unknown) => void;
    resource.closed = new Promise((yes, no) => { resolve = yes; reject = no; });
    this.invalidate(resource, new Error('会话已关闭'));
    void this.finishClose(resource).then(resolve, reject);
    return resource.closed;
  }
  private async finishClose(resource: ProcessResource): Promise<{ exitCode: number }> {
    const host = resource.host;
    if (host && !resource.hostEnded) {
      let fallback: ReturnType<typeof setTimeout> | undefined;
      let confirmation: ReturnType<typeof setTimeout> | undefined;
      let escalation: Promise<void> | undefined;
      const hostExit = new Promise<void>((resolve, reject) => {
        void resource.hostExit.then(resolve);
        fallback = setTimeout(() => {
          escalation = (async () => {
            // Snapshot/terminate the child tree before killing its host, as in the existing adapter.
            let treeError: unknown;
            try { await this.cleanupTree(resource); } catch (error) { treeError = error; }
            if (!resource.hostEnded) {
              confirmation = setTimeout(() => reject(new Error('Utility host did not exit; session ownership retained')), 2000);
              try { host.kill(); } catch (error) { reject(error); }
            }
            if (treeError) throw treeError;
          })();
          void escalation.catch(reject);
        }, 2000);
        // Waiter and fallback are installed before a possibly throwing/reentrant postMessage.
        try { host.postMessage({ type: 'close' } satisfies RpcWorkerInput & PtyWorkerInput); } catch (error) { this.notice(resource.id, error); }
      });
      try { await hostExit; await escalation; }
      finally { clearTimeout(fallback); clearTimeout(confirmation); }
    }
    await this.cleanupTree(resource);
    return { exitCode: resource.exitCode };
  }
  private request(resource: ProcessResource, message: RpcOperation): Promise<void> {
    if (this.snapshot(resource).kind !== 'chat') return Promise.reject(new Error('这不是原生对话会话'));
    const phase = this.snapshot(resource).lifecycle.phase;
    if (!resource.host || !this.accepts(resource) || (phase !== 'running' && !(phase === 'starting' && message.type === 'extension-response'))) return Promise.reject(new Error('Pi 对话进程尚未运行'));
    if (resource.pending.size >= 32) return Promise.reject(new Error('Pi 请求过多，请等待当前操作完成'));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const settle = (error?: Error) => {
        if (!resource.pending.delete(requestId)) return;
        clearInterval(timer);
        if (error) reject(error); else resolve();
      };
      const timer = setInterval(() => {
        if (resource.activity === 'waiting-input') return;
        settle(new Error('Pi 请求超时，接收状态未知；正在关闭会话，不会自动重发'));
        void this.context.close(resource.id).catch(error => this.notice(resource.id, error));
      }, 360_000);
      timer.unref();
      resource.pending.set(requestId, { resolve: () => settle(), reject: error => settle(error) });
      try { resource.host!.postMessage({ ...message, requestId } satisfies RpcWorkerInput); }
      catch (error) { settle(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  /** Paths and payloads are physical resources; only Conversation grants token authority. */
  stageSources(id: string, paths: readonly string[]): AttachmentSourceId[] {
    const resource = this.resource(id);
    this.assertAvailable(id);
    return paths.map(selectedPath => {
      const source = randomUUID() as AttachmentSourceId;
      resource.sources.set(source, selectedPath);
      return source;
    });
  }

  assertAvailable(id: string, operation: 'attachments' | 'send' = 'attachments'): void {
    const resource = this.resource(id);
    if (!this.accepts(resource)) throw new Error('会话已关闭');
    if (this.snapshot(resource).kind !== 'chat') throw new Error(operation === 'send' ? '这不是原生对话会话' : '附件只支持原生对话');
  }

  discardSources(id: string, sources: readonly AttachmentSourceId[]): void {
    const resource = this.resources.get(id);
    for (const source of sources) resource?.sources.delete(source);
  }

  release(id: string, tokens: readonly AttachmentToken[]): void {
    const resource = this.resources.get(id);
    for (const token of tokens) resource?.payloads.delete(token);
  }

  attachmentView(id: string, attachment: Attachment): ChatAttachment {
    const payload = this.resource(id).payloads.get(attachment.id);
    if (!payload) throw new Error('附件已失效，请重新选择');
    return { ...attachment, path: payload.path, previewUrl: payload.previewUrl };
  }

  async read(id: string, source: AttachmentSourceId, admit: (metadata: AttachmentMetadata) => void): Promise<Attachment> {
    const resource = this.resource(id);
    const assertOpen = () => { if (!this.accepts(resource)) throw new Error('会话已关闭'); };
    this.assertAvailable(id);
    const selectedPath = resource.sources.get(source);
    if (selectedPath === undefined) throw new Error('附件来源已失效');
    const mimeType = imageMimeType(selectedPath);
    const name = path.basename(selectedPath);
    let size: number;
    let imageData: string | undefined;
    if (mimeType) {
      const handle = await open(selectedPath, 'r');
      try {
        assertOpen();
        const stats = await handle.stat();
        assertOpen();
        if (!stats.isFile()) throw new Error(`${selectedPath} 不是文件`);
        size = stats.size;
        admit({ name, size, kind: 'image', mimeType });
        const bytes = Buffer.alloc(size);
        let offset = 0;
        while (offset < size) {
          const read = await handle.read(bytes, offset, size - offset, offset);
          assertOpen();
          if (!read.bytesRead) break;
          offset += read.bytesRead;
        }
        imageData = bytes.subarray(0, offset).toString('base64');
      } finally { await handle.close(); }
    } else {
      const stats = await stat(selectedPath);
      assertOpen();
      if (!stats.isFile()) throw new Error(`${selectedPath} 不是文件`);
      size = stats.size;
      admit({ name, size, kind: 'file' });
    }
    assertOpen();
    const attachment: Attachment = { id: randomUUID(), name, kind: mimeType ? 'image' : 'file', mimeType, size };
    resource.payloads.set(attachment.id, {
      ...attachment, path: selectedPath, imageData,
      ...(mimeType ? { previewUrl: `data:${mimeType};base64,${imageData}` } : {}),
    });
    return attachment;
  }

  async send(id: string, input: RuntimeSend): Promise<void> {
    const resource = this.resource(id);
    // IDs have already been authorized by Conversation. This lookup only materializes wire payloads.
    const selected = input.attachmentIds.map(token => {
      const item = resource.payloads.get(token);
      if (!item) throw new Error('附件已失效，请重新选择');
      return item;
    });
    const filePaths = selected.filter(item => item.kind === 'file').map(item => item.path);
    const images = selected.filter(item => item.kind === 'image').map(item => {
      if (item.imageData === undefined || item.mimeType === undefined) throw new Error('附件已失效，请重新选择');
      return { data: item.imageData, mimeType: item.mimeType };
    });
    await this.request(resource, { type: 'send', text: input.text, filePaths, images, queuePreference: input.queuePreference });
  }

  async stop(id: string): Promise<void> { await this.request(this.resource(id), { type: 'stop' }); }
  async respond(id: string, response: ExtensionResponse): Promise<void> { await this.request(this.resource(id), { type: 'extension-response', response }); }
  async rename(id: string, name: string): Promise<void> {
    const resource = this.resource(id);
    await this.request(resource, { type: 'rename', name });
    if (this.accepts(resource)) this.lifecycle({ type: 'title-changed', id, title: name });
  }

  write(id: string, data: string): void {
    const resource = this.resource(id);
    if (this.snapshot(resource).kind === 'terminal' && this.accepts(resource) && this.snapshot(resource).lifecycle.phase === 'running') resource.host?.postMessage({ type: 'write', data } satisfies PtyWorkerInput);
  }
  resize(id: string, cols: number, rows: number): void {
    if (!validSize(cols, rows)) return;
    const resource = this.resource(id);
    if (this.snapshot(resource).kind !== 'terminal' || !this.accepts(resource)) return;
    resource.cols = cols; resource.rows = rows;
    if (this.snapshot(resource).lifecycle.phase === 'running') resource.host?.postMessage({ type: 'resize', cols, rows } satisfies PtyWorkerInput);
  }
  acknowledge(id: string, size: number): void {
    const resource = this.resources.get(id);
    if (resource && this.accepts(resource) && this.snapshot(resource).kind === 'terminal') resource.host?.postMessage({ type: 'ack', size } satisfies PtyWorkerInput);
  }
}
