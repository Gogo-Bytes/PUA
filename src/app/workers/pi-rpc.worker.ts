import { parseRpcWorkerInput } from '../../shared/ipc/worker-schemas.js';
import type { RpcWorkerInput, RpcWorkerOutput, RpcWorkerEvent } from '../../shared/ipc/worker-protocol.js';
import { ConversationRuntimeApplication, ConversationStreamApplication, type ConversationMessage } from '../../modules/conversation/index.js';
import { dialogDTO, normalizeDialog, normalizeQueue, normalizeRuntimeSeed, queueDTO, runtimeChangeDTO, runtimeError, runtimeViewDTO } from '../../platform/pi/rpc/conversation-runtime-mapper.js';
import { RpcWriter } from '../../platform/pi/rpc/writer.js';
import { terminateProcessTree } from '../../platform/process/process-tree.js';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { JsonlDecoder, TailBuffer } from '../../platform/pi/rpc/jsonl.js';
import { decodeArguments, isRecord, normalizeHistoryItems } from '../../platform/pi/rpc/chat-normalize.js';
import { ConversationStreamMapper, messageDTO, streamNotificationDTO } from '../../platform/pi/rpc/conversation-stream-mapper.js';
import type { ChatCommand, ChatTreeNode } from '../../shared/ipc/conversation.js';
import { createMissingAssistantDiagnostics } from '../../shared/ipc/missing-assistant-diagnostics.js';

import { parsePiResponse, type PiCommand, type PiResponseData } from '../../platform/pi/rpc/pi-response.js';

type StartMessage = Extract<RpcWorkerInput, { type: 'start' }>;

const port = process.parentPort;
if (!port) throw new Error('RPC host must run as an Electron utility process');
let child: ChildProcessWithoutNullStreams | undefined;
let sessionId = '';
let closing = false;
let writer: RpcWriter | undefined;
let shutdownPromise: Promise<void> | undefined;
interface PendingRequest { command: PiCommand['type']; resolve(value: Record<string, unknown>): void; reject(error: Error): void; remainingMs: number; startedAt?: number; timer?: NodeJS.Timeout }
const pending = new Map<string, PendingRequest>();
const stderr = new TailBuffer();
const diagnostics = new TailBuffer(16 * 1024);

type SessionEventWithoutId = RpcWorkerEvent extends infer Event ? Event extends { id: string } ? Omit<Event, 'id'> : never : never;
let outputFailed = false;
const diagnosticsOutput = createMissingAssistantDiagnostics(() => process.env.PUA_MISSING_ASSISTANT_DIAGNOSTIC_SESSION, line => console.info(line));
const post = (message: RpcWorkerOutput): boolean => {
  if (outputFailed) return false;
  try {
    if (message.type === 'event') diagnosticsOutput.record('worker-emitted', sessionId, message.event);
    port.postMessage(message); return true;
  }
  catch (error) {
    // Do not recursively use a broken transport to report its own failure.
    outputFailed = true;
    diagnostics.append(`Host output failed; delivery unknown: ${String(error)}\n`);
    void shutdown(1);
    return false;
  }
};
const event = (value: SessionEventWithoutId) => post({ type: 'event', event: { ...value, id: sessionId } as RpcWorkerEvent });
const fail = (error: unknown) => {
  const detail = [stderr.toString().trim(), diagnostics.toString().trim()].filter(Boolean).join('\n');
  event({ type: 'chat-notice', level: 'error', message: `${String(error)}${detail ? `\n\n${detail}` : ''}` });
};

const streamMapper = new ConversationStreamMapper();
function commandsDTO(value: unknown): ChatCommand[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => isRecord(item) && typeof item.name === 'string' && (item.source === 'extension' || item.source === 'prompt' || item.source === 'skill')
    ? [{ name: item.name, description: typeof item.description === 'string' ? item.description : undefined, source: item.source }] : []);
}
function treeDTO(value: unknown): ChatTreeNode[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!isRecord(item) || !isRecord(item.entry) || typeof item.entry.id !== 'string') return [];
    const entry = item.entry;
    const entryId = entry.id as string;
    const forkable = entry.type === 'message' && isRecord(entry.message) && entry.message.role === 'user';
    return [{ entryId, label: typeof item.label === 'string' ? item.label : undefined, forkable, children: treeDTO(item.children) }];
  });
}
function withForkEntries(messages: readonly ConversationMessage[], value: unknown): ConversationMessage[] {
  const entries = Array.isArray(value) ? value.flatMap(item => isRecord(item) && typeof item.entryId === 'string' && typeof item.text === 'string' ? [{ entryId: item.entryId, text: item.text }] : []) : [];
  let cursor = 0;
  let currentEntryId: string | undefined;
  return messages.map(message => {
    if (message.role !== 'user') return message.role === 'assistant' && currentEntryId ? { ...message, forkEntryId: currentEntryId } : message;
    const text = message.blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n');
    const index = entries.findIndex((entry, index) => index >= cursor && entry.text === text);
    if (index < 0) { currentEntryId = undefined; return message; }
    cursor = index + 1;
    currentEntryId = entries[index].entryId;
    return { ...message, forkEntryId: currentEntryId };
  });
}
const stream = new ConversationStreamApplication({
  after: (delayMs, callback) => {
    const timer = setTimeout(() => {
      try { callback(); }
      catch (error) { fail(error); void shutdown(1); }
    }, delayMs);
    return () => clearTimeout(timer);
  },
}, { decode: decodeArguments }, notification => {
  if (notification.type === 'fragment-index-rejected') { diagnostics.append('Invalid contentIndex ignored\n'); return; }
  if (!event(streamNotificationDTO(notification))) throw new Error('Host output failed; stream delivery unknown');
});
const runtime = new ConversationRuntimeApplication({
  clearQueue: () => send({ type: 'clear_queue' }),
  abort: async () => { await send({ type: 'abort' }); },
  writeAnswer: async response => {
    if (!writer) throw new Error('Pi RPC process is not running');
    try { await writer.write({ ...response, type: 'extension_ui_response' }); }
    catch (error) { if (writer.failed) { fail(error); void shutdown(1); } throw error; }
  },
}, {
  now: () => Date.now(),
  at: (deadline, callback) => {
    const timer = setTimeout(callback, Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  },
}, notification => {
  switch (notification.type) {
    case 'state-changed':
      try { event({ type: 'chat-state', state: runtimeChangeDTO(notification.change) }); }
      finally { syncRequestDeadlines(); }
      break;
    case 'dialog-opened': event({ type: 'extension-ui', request: dialogDTO(notification.dialog) }); break;
    case 'dialog-closed': event({ type: 'extension-ui-closed', requestId: notification.dialogId }); break;
  }
});
function syncRequestDeadlines(): void {
  if (closing) return;
  for (const [id, request] of pending) {
    if (runtime.waiting) {
      if (request.timer) { clearTimeout(request.timer); request.timer = undefined; request.remainingMs = Math.max(0, request.remainingMs - (Date.now() - request.startedAt!)); }
    } else if (!request.timer) {
      request.startedAt = Date.now();
      request.timer = setTimeout(() => {
        if (closing || pending.get(id) !== request) return;
        const error = new Error('Pi RPC request timed out; acceptance unknown, session closed (not replayed)');
        pending.delete(id); request.reject(error); fail(error); void shutdown(1);
      }, request.remainingMs);
      request.timer.unref();
    }
  }
}
function send<C extends PiCommand['type']>(command: PiCommand & { type: C }, timeoutMs = 300_000): Promise<PiResponseData[C]> {
  if (closing || !child || child.exitCode !== null) return Promise.reject(new Error('Pi RPC process is not running'));
  if (pending.size >= 32) return Promise.reject(new Error('Too many pending Pi requests'));
  const id = `pua-${randomUUID()}`;
  return new Promise((resolve, reject) => {
    const request: PendingRequest & { command: C } = {
      command: command.type,
      resolve: value => resolve(parsePiResponse(request.command, value)),
      reject, remainingMs: timeoutMs,
    };
    pending.set(id, request);
    syncRequestDeadlines();
    void writer!.write({ ...command, id }).catch(error => {
      const request = pending.get(id); if (request?.timer) clearTimeout(request.timer); pending.delete(id); reject(error); if (writer?.failed) { fail(error); void shutdown(1); }
    });
  });
}

async function answerExtension(response: Extract<RpcWorkerInput, { type: 'extension-response' }>['response']): Promise<void> {
  await runtime.answer(response);
}

function shutdown(code = 0): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  // Install the cleanup identity before retirement can synchronously fail/reenter output.
  shutdownPromise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  closing = true;
  void (async () => {
    stream.invalidate(); runtime.invalidate();
    const error = new Error('Pi session closing; acceptance unknown');
    for (const request of pending.values()) { if (request.timer) clearTimeout(request.timer); request.reject(error); }
    pending.clear();
    writer?.close(new Error('Pi session closing; acceptance unknown'));
    if (child?.pid) await terminateProcessTree(child.pid);
    event({ type: 'exit', exitCode: code });
    process.exit(code);
  })().then(resolve, reject);
  return shutdownPromise;
}

function handleResponse(value: Record<string, unknown>): boolean {
  if (value.type !== 'response' || typeof value.id !== 'string') return false;
  const request = pending.get(value.id);
  if (!request) return true;
  if (request.timer) clearTimeout(request.timer);
  try {
    // The slot and timer are retired before parsing or running any continuation.
    request.resolve(value);
  } catch (error) { request.reject(error instanceof Error ? error : new Error(String(error))); }
  pending.delete(value.id);
  return true;
}

function handleExtensionUI(value: Record<string, unknown>): boolean {
  if (value.type !== 'extension_ui_request' || typeof value.id !== 'string' || typeof value.method !== 'string') return false;
  const method = value.method;
  const dialog = normalizeDialog(value, Date.now());
  if (dialog) {
    runtime.accept({ type: 'dialog', dialog });
  } else if (method === 'notify' && typeof value.message === 'string') {
    const level = value.notifyType === 'warning' || value.notifyType === 'error' ? value.notifyType : 'info';
    event({ type: 'chat-notice', level, message: value.message });
  } else if (method === 'setStatus' && typeof value.statusKey === 'string') {
    runtime.accept({ type: 'status', key: value.statusKey, text: typeof value.statusText === 'string' ? value.statusText : undefined });
  } else if (method === 'setWidget' && typeof value.widgetKey === 'string') {
    runtime.accept({ type: 'widget', key: value.widgetKey, content: Array.isArray(value.widgetLines) ? {
      lines: value.widgetLines.filter((x): x is string => typeof x === 'string'),
      placement: value.widgetPlacement === 'belowEditor' ? 'belowEditor' : 'aboveEditor',
    } : undefined });
  } else if (method === 'setTitle' && typeof value.title === 'string') {
    event({ type: 'session-info', title: value.title });
  } else if (method === 'set_editor_text' && typeof value.text === 'string') {
    event({ type: 'chat-editor-text', text: value.text });
  } else diagnostics.append(`Ignored extension UI method or malformed payload: ${method}\n`);
  return true;
}

function postSessionIdentity(value: unknown): void {
  if (isRecord(value) && typeof value.sessionId === 'string' && typeof value.sessionFile === 'string') post({ type: 'session-identity', sessionId: value.sessionId, sessionFile: value.sessionFile });
}

let forkMetadataGeneration = 0;
async function refreshForkMetadata(): Promise<void> {
  if (closing) return;
  const generation = ++forkMetadataGeneration;
  try {
    const [forkValue, treeValue] = await Promise.all([send({ type: 'get_fork_messages' }, 15_000), send({ type: 'get_tree' }, 15_000)]);
    if (closing || generation !== forkMetadataGeneration) return;
    const entries = Array.isArray(forkValue.messages) ? forkValue.messages.flatMap(item =>
      isRecord(item) && typeof item.entryId === 'string' && typeof item.text === 'string'
        ? [{ entryId: item.entryId, text: item.text }] : []) : [];
    // Enrichment must never replace live transcript identities or reset stream/tool correlation.
    event({ type: 'chat-fork-metadata', entries, sessionTree: treeDTO(treeValue.tree) });
  } catch (error) {
    diagnostics.append(`Fork metadata refresh failed: ${String(error)}\n`);
  }
}

function handleEvent(value: Record<string, unknown>): void {
  diagnosticsOutput.record('worker-received', sessionId, value);
  if (closing || handleResponse(value) || handleExtensionUI(value)) return;
  switch (value.type) {
    case 'agent_start': runtime.accept({ type: 'activity', activity: 'responding' }); break;
    case 'agent_settled': runtime.accept({ type: 'activity', activity: 'idle' }); void refreshForkMetadata(); break;
    case 'compaction_start': runtime.accept({ type: 'activity', activity: 'compacting' }); break;
    case 'auto_retry_start': runtime.accept({ type: 'activity', activity: 'retrying' }); break;
    case 'queue_update': runtime.accept({ type: 'queue', queue: normalizeQueue(value) }); break;
    case 'message_start':
    case 'message_update':
    case 'message_end':
    case 'tool_execution_start':
    case 'tool_execution_update':
    case 'tool_execution_end': {
      const input = streamMapper.normalize(value);
      if (input) stream.accept(input);
      break;
    }
    case 'extension_error': event({ type: 'chat-notice', level: 'error', message: `扩展错误：${typeof value.error === 'string' ? value.error : '未知错误'}` }); break;
    case 'compaction_end': if (value.errorMessage) event({ type: 'chat-notice', level: 'error', message: `上下文压缩失败：${value.errorMessage}` }); break;
    case 'auto_retry_end': if (value.success === false) event({ type: 'chat-notice', level: 'error', message: `自动重试失败：${typeof value.finalError === 'string' ? value.finalError : ''}` }); break;
    default: diagnostics.append(`Ignored Pi RPC event: ${String(value.type)}\n`); break;
  }
}

async function start(message: StartMessage): Promise<void> {
  if (closing || child) return;
  sessionId = message.id;
  child = spawn(message.executable, [...message.args, '--mode', 'rpc'], { cwd: message.cwd, env: message.env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  writer = new RpcWriter(child.stdin);
  if (child.pid) post({ type: 'child-pid', pid: child.pid });
  child.stderr.on('data', chunk => stderr.append(chunk));
  const decoder = new JsonlDecoder(value => { if (isRecord(value)) handleEvent(value); });
  child.stdout.on('data', chunk => { try { decoder.push(chunk); } catch (error) { fail(runtimeError(error)); void shutdown(1); } });
  child.stdout.on('end', () => { try { decoder.end(); } catch (error) { fail(error); } });
  child.on('error', error => { if (!closing) fail(error); });
  child.on('exit', code => {
    const wasClosing = closing;
    closing = true;
    stream.invalidate();
    runtime.invalidate();
    const error = new Error(`Pi RPC process exited (${code ?? 0})`); for (const request of pending.values()) { if (request.timer) clearTimeout(request.timer); request.reject(error); } pending.clear();
    event({ type: 'exit', exitCode: code ?? 0 });
    if (!wasClosing && code) fail(error);
    if (!wasClosing) void shutdown(code ?? 0);
  });
  await new Promise<void>((resolve, reject) => { child!.once('spawn', resolve); child!.once('error', reject); });
  if (closing) return;
  const [stateValue, messagesValue, commandsValue] = await Promise.all([send({ type: 'get_state' }, 15_000), send({ type: 'get_messages' }, 15_000), send({ type: 'get_commands' }, 15_000)]);
  if (closing) return;
  const state = runtimeViewDTO(runtime.initialize(normalizeRuntimeSeed(stateValue)));
  postSessionIdentity(stateValue);
  const history = stream.initializeHistory(normalizeHistoryItems(messagesValue.messages));
  const messages = history.map(messageDTO);
  const commands = commandsDTO(commandsValue.commands);
  event({ type: 'chat-snapshot', snapshot: { ...state, messages, commands } });
  if (closing) return;
  event({ type: 'session-info', processStatus: 'running', activity: state.activity });
}

port.on('message', ({ data: raw }: { data: unknown }) => {
  const parsed = parseRpcWorkerInput(raw);
  if (!parsed.ok) {
    if (!closing && parsed.requestId) post({ type: 'response', requestId: parsed.requestId, success: false, error: parsed.error });
    return;
  }
  const data = parsed.message;
  if (data.type === 'start') { void start(data).catch(error => { if (!closing) { fail(`原生对话启动失败：${(error as Error).message}`); void shutdown(1); } }); return; }
  if (data.type === 'close') { void shutdown(); return; }
  if (closing) return;
  if (data.type === 'extension-response') {
    // The input parser rebuilt the whitelist at this worker edge, after main validation.
    void answerExtension(data.response)
      .then(() => { if (!closing) post({ type: 'response', requestId: data.requestId, success: true }); })
      .catch(error => { if (!closing) post({ type: 'response', requestId: data.requestId, success: false, error: String(runtimeError(error)) }); });
    return;
  }
  if (data.type === 'stop') {
    void runtime.stop(queue => {
      if (!event({ type: 'chat-queue-recovered', requestId: data.requestId, queue: queueDTO(queue) })) {
        throw new Error('Host output failed; recovered queue delivery unknown');
      }
    })
      .then(() => { if (!closing) post({ type: 'response', requestId: data.requestId, success: true }); })
      .catch(error => { if (!closing) post({ type: 'response', requestId: data.requestId, success: false, error: String(runtimeError(error)) }); });
    return;
  }
  if (data.type === 'send' || data.type === 'rename') {
    // Pi spellings and image content belong exclusively to this worker edge.
    const references = data.type === 'send' && data.filePaths.length
      ? `\n\n参考文件路径：\n${data.filePaths.map(file => `- ${JSON.stringify(file)}`).join('\n')}` : '';
    const command: PiCommand = data.type === 'rename' ? { type: 'set_session_name', name: data.name }
      : { type: 'prompt', message: `${data.text}${references}`, images: data.images.map(image => ({ type: 'image', ...image })), streamingBehavior: data.queuePreference };
    void send(command)
      .then(() => { if (!closing) post({ type: 'response', requestId: data.requestId, success: true }); })
      .catch(error => { if (!closing) post({ type: 'response', requestId: data.requestId, success: false, error: String(error) }); });
    return;
  }
  if (data.type === 'fork') {
    ++forkMetadataGeneration;
    void send({ type: 'fork', entryId: data.entryId })
      .then(async result => {
        if (!result.cancelled && !closing) {
          const [stateValue, messagesValue, commandsValue, forkValue] = await Promise.all([
            send({ type: 'get_state' }, 15_000), send({ type: 'get_messages' }, 15_000), send({ type: 'get_commands' }, 15_000), send({ type: 'get_fork_messages' }, 15_000),
          ]);
          postSessionIdentity(stateValue);
          const state = runtimeViewDTO(runtime.initialize(normalizeRuntimeSeed(stateValue)));
          stream.reset();
          const history = stream.initializeHistory(normalizeHistoryItems(messagesValue.messages));
          const mapped = withForkEntries(history, forkValue.messages).map(messageDTO);
          event({ type: 'chat-snapshot', snapshot: { ...state, messages: mapped, commands: commandsDTO(commandsValue.commands) } });
        }
        if (!closing) post({ type: 'response', requestId: data.requestId, success: true, data: result });
      })
      .catch(error => { if (!closing) post({ type: 'response', requestId: data.requestId, success: false, error: String(error) }); });
    return;
  }
  if (data.type === 'clone') {
    ++forkMetadataGeneration;
    void send({ type: 'clone' })
      .then(async result => {
        if (!result.cancelled && !closing) {
          const [stateValue, messagesValue, commandsValue, forkValue] = await Promise.all([
            send({ type: 'get_state' }, 15_000), send({ type: 'get_messages' }, 15_000), send({ type: 'get_commands' }, 15_000), send({ type: 'get_fork_messages' }, 15_000),
          ]);
          postSessionIdentity(stateValue);
          const state = runtimeViewDTO(runtime.initialize(normalizeRuntimeSeed(stateValue)));
          stream.reset();
          const history = stream.initializeHistory(normalizeHistoryItems(messagesValue.messages));
          const mapped = withForkEntries(history, forkValue.messages).map(messageDTO);
          event({ type: 'chat-snapshot', snapshot: { ...state, messages: mapped, commands: commandsDTO(commandsValue.commands) } });
        }
        if (!closing) post({ type: 'response', requestId: data.requestId, success: true, data: result });
      })
      .catch(error => { if (!closing) post({ type: 'response', requestId: data.requestId, success: false, error: String(error) }); });
    return;
  }
  if (data.type === 'get-available-models' || data.type === 'get-available-thinking-levels' || data.type === 'compact' || data.type === 'set-model' || data.type === 'set-thinking-level' || data.type === 'set-auto-compaction' || data.type === 'set-auto-retry' || data.type === 'switch-session' || data.type === 'export-html' || data.type === 'get-tree' || data.type === 'get-fork-messages' || data.type === 'get-state' || data.type === 'get-session-stats' || data.type === 'get-auto-settings') {
    const command: PiCommand = data.type === 'get-available-models' ? { type: 'get_available_models' }
      : data.type === 'get-available-thinking-levels' ? { type: 'get_available_thinking_levels' }
      : data.type === 'compact' ? { type: 'compact', ...(data.customInstructions === undefined ? {} : { customInstructions: data.customInstructions }) }
      : data.type === 'set-model' ? { type: 'set_model', provider: data.provider, modelId: data.modelId }
      : data.type === 'set-thinking-level' ? { type: 'set_thinking_level', level: data.level }
      : data.type === 'set-auto-compaction' ? { type: 'set_auto_compaction', enabled: data.enabled }
      : data.type === 'set-auto-retry' ? { type: 'set_auto_retry', enabled: data.enabled }
      : data.type === 'switch-session' ? { type: 'switch_session', sessionPath: data.sessionPath }
      : data.type === 'export-html' ? { type: 'export_html', outputPath: data.outputPath }
      : { type: (data.type === 'get-auto-settings' ? 'get_state' : data.type.replaceAll('-', '_')) as never };
    void send(command).then(result => { if (!closing) post({ type: 'response', requestId: data.requestId, success: true, data: result }); }).catch(error => { if (!closing) post({ type: 'response', requestId: data.requestId, success: false, error: String(error) }); });
    return;
  }
});
