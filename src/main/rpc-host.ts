import { validBlockIndex } from '../shared/chat-validation.js';
import { ExtensionDialogs } from './extension-dialogs.js';
import { RpcWriter } from './rpc-writer.js';
import { terminateProcessTree } from './process-tree.js';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { JsonlDecoder, TailBuffer } from './rpc-jsonl.js';
import { contentImages, contentText, isRecord, normalizeHistory, normalizeMessage, normalizeToolResult } from './chat-normalize.js';
import type { ChatCommand, ChatRuntimeState, ExtensionUIRequest, SessionEvent, ToolActivity } from '../shared/chat.js';

interface StartMessage { type: 'start'; id: string; executable: string; args: string[]; cwd: string; env: Record<string, string> }
type HostMessage = StartMessage
  | { type: 'command'; requestId: string; command: Record<string, unknown> }
  | { type: 'stop'; requestId: string }
  | { type: 'extension-response'; requestId: string; response: Record<string, unknown> }
  | { type: 'close' };

type Outgoing =
  | { type: 'event'; event: SessionEvent }
  | { type: 'child-pid'; pid: number }
  | { type: 'response'; requestId: string; success: true; data?: unknown }
  | { type: 'response'; requestId: string; success: false; error: string };

const port = process.parentPort;
if (!port) throw new Error('RPC host must run as an Electron utility process');
let child: ChildProcessWithoutNullStreams | undefined;
let sessionId = '';
let closing = false;
let writer: RpcWriter | undefined;
let shutdownPromise: Promise<void> | undefined;
let underlyingActivity: ChatRuntimeState['activity'] = 'idle';
let observedActivity = false;
let sequence = 0;
let activeMessageId: string | undefined;
let activeUserMessageId: string | undefined;
interface PendingRequest { resolve(value: unknown): void; reject(error: Error): void; remainingMs: number; startedAt?: number; timer?: NodeJS.Timeout }
const pending = new Map<string, PendingRequest>();
const stderr = new TailBuffer();
const diagnostics = new TailBuffer(16 * 1024);
const tools = new Map<string, ToolActivity>();
const finalTools = new Set<string>();
const retiredTools = new Set<string>();
const toolLocations = new Map<string, { messageId?: string; blockIndex?: number }>();
const deltaBuffer = new Map<string, { messageId: string; blockIndex: number; blockType: 'text' | 'thinking'; delta: string }>();
let deltaTimer: NodeJS.Timeout | undefined;
let runtimeState: ChatRuntimeState = { activity: 'idle', queue: { steering: [], followUp: [] }, statuses: {}, widgets: [] };

type SessionEventWithoutId = SessionEvent extends infer Event ? Event extends { id: string } ? Omit<Event, 'id'> : never : never;
const post = (message: Outgoing) => port.postMessage(message);
const event = (value: SessionEventWithoutId) => post({ type: 'event', event: { ...value, id: sessionId } as SessionEvent });
const fail = (error: unknown) => {
  const detail = [stderr.toString().trim(), diagnostics.toString().trim()].filter(Boolean).join('\n');
  event({ type: 'chat-notice', level: 'error', message: `${String(error)}${detail ? `\n\n${detail}` : ''}` });
};

function flushDeltas(): void {
  if (deltaTimer) clearTimeout(deltaTimer);
  deltaTimer = undefined;
  for (const value of deltaBuffer.values()) event({ type: 'chat-message-delta', ...value });
  deltaBuffer.clear();
}
function queueDelta(messageId: string, blockIndex: number, blockType: 'text' | 'thinking', delta: string): void {
  const key = `${messageId}:${blockIndex}:${blockType}`;
  const current = deltaBuffer.get(key);
  if (current) current.delta += delta;
  else deltaBuffer.set(key, { messageId, blockIndex, blockType, delta });
  deltaTimer ??= setTimeout(flushDeltas, 24);
}
const dialogs = new ExtensionDialogs(requestId => {
  event({ type: 'extension-ui-closed', requestId });
  updateState({ activity: underlyingActivity });
});
function updateState(state: Partial<ChatRuntimeState>): void {
  if (state.activity && state.activity !== 'waiting-input') { underlyingActivity = state.activity; observedActivity = true; }
  state = { ...state, activity: dialogs.waiting ? 'waiting-input' : underlyingActivity };
  runtimeState = { ...runtimeState, ...state };
  event({ type: 'chat-state', state });
  syncRequestDeadlines();
}
function syncRequestDeadlines(): void {
  if (closing) return;
  for (const [id, request] of pending) {
    if (dialogs.waiting) {
      if (request.timer) { clearTimeout(request.timer); request.timer = undefined; request.remainingMs = Math.max(0, request.remainingMs - (Date.now() - request.startedAt!)); }
    } else if (!request.timer) {
      request.startedAt = Date.now();
      request.timer = setTimeout(() => {
        const error = new Error('Pi RPC request timed out; acceptance unknown, session closed (not replayed)');
        pending.delete(id); request.reject(error); fail(error); void shutdown(1);
      }, request.remainingMs);
      request.timer.unref();
    }
  }
}
function send(command: Record<string, unknown>, timeoutMs = 300_000): Promise<unknown> {
  if (!child || child.exitCode !== null) return Promise.reject(new Error('Pi RPC process is not running'));
  if (pending.size >= 32) return Promise.reject(new Error('Too many pending Pi requests'));
  const id = `pua-${randomUUID()}`;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, remainingMs: timeoutMs });
    syncRequestDeadlines();
    void writer!.write({ ...command, id }).catch(error => {
      const request = pending.get(id); if (request?.timer) clearTimeout(request.timer); pending.delete(id); reject(error); if (writer?.failed) { fail(error); void shutdown(1); }
    });
  });
}
async function sendExtensionResponse(raw: unknown): Promise<void> {
  const response = dialogs.answer(raw);
  if (!writer) throw new Error('Pi RPC process is not running');
  try { await writer.write({ ...response, type: 'extension_ui_response' }); }
  catch (error) { if (writer.failed) { fail(error); void shutdown(1); } throw error; }
  dialogs.remove(response.id);
}

async function shutdown(code = 0): Promise<void> {
  return shutdownPromise ??= (async () => {
    closing = true; dialogs.clear(); flushDeltas();
    writer?.close(new Error('Pi session closing; acceptance unknown'));
    if (child?.pid) await terminateProcessTree(child.pid);
    event({ type: 'exit', exitCode: code });
    process.exit(code);
  })();
}

function handleResponse(value: Record<string, unknown>): boolean {
  if (value.type !== 'response' || typeof value.id !== 'string') return false;
  const request = pending.get(value.id);
  if (!request) return true;
  pending.delete(value.id);
  if (request.timer) clearTimeout(request.timer);
  if (value.success === false) request.reject(new Error(typeof value.error === 'string' ? value.error : 'Pi RPC command failed'));
  else request.resolve(value.data);
  return true;
}

function handleExtensionUI(value: Record<string, unknown>): boolean {
  if (value.type !== 'extension_ui_request' || typeof value.id !== 'string' || typeof value.method !== 'string') return false;
  const method = value.method;
  const expiresAt = typeof value.timeout === 'number' && Number.isFinite(value.timeout) && value.timeout > 0 ? Date.now() + Math.min(value.timeout, 2147483647) : undefined;
  const show = (request: ExtensionUIRequest) => { dialogs.add({ ...request, expiresAt }); updateState({ activity: underlyingActivity }); event({ type: 'extension-ui', request: { ...request, expiresAt } }); };
  if (method === 'select' && typeof value.title === 'string' && Array.isArray(value.options)) {
    updateState({ activity: 'waiting-input' });
    show({ id: value.id, method, title: value.title, options: value.options.filter((x): x is string => typeof x === 'string') });
  } else if (method === 'confirm' && typeof value.title === 'string' && typeof value.message === 'string') {
    updateState({ activity: 'waiting-input' }); show({ id: value.id, method, title: value.title, message: value.message });
  } else if (method === 'input' && typeof value.title === 'string') {
    updateState({ activity: 'waiting-input' }); show({ id: value.id, method, title: value.title, placeholder: typeof value.placeholder === 'string' ? value.placeholder : undefined });
  } else if (method === 'editor' && typeof value.title === 'string') {
    updateState({ activity: 'waiting-input' }); show({ id: value.id, method, title: value.title, prefill: typeof value.prefill === 'string' ? value.prefill : undefined });
  } else if (method === 'notify' && typeof value.message === 'string') {
    const level = value.notifyType === 'warning' || value.notifyType === 'error' ? value.notifyType : 'info';
    event({ type: 'chat-notice', level, message: value.message });
  } else if (method === 'setStatus' && typeof value.statusKey === 'string') {
    const statuses = { ...runtimeState.statuses };
    if (typeof value.statusText === 'string') statuses[value.statusKey] = value.statusText; else delete statuses[value.statusKey];
    updateState({ statuses });
  } else if (method === 'setWidget' && typeof value.widgetKey === 'string') {
    const widgets = runtimeState.widgets.filter(widget => widget.key !== value.widgetKey);
    if (Array.isArray(value.widgetLines)) widgets.push({ key: value.widgetKey, lines: value.widgetLines.filter((x): x is string => typeof x === 'string'), placement: value.widgetPlacement === 'belowEditor' ? 'belowEditor' : 'aboveEditor' });
    updateState({ widgets });
  } else if (method === 'setTitle' && typeof value.title === 'string') {
    event({ type: 'session-info', title: value.title });
  } else if (method === 'set_editor_text' && typeof value.text === 'string') {
    event({ type: 'chat-editor-text', text: value.text });
  } else diagnostics.append(`Ignored extension UI method or malformed payload: ${method}\n`);
  return true;
}

function handleEvent(value: Record<string, unknown>): void {
  if (handleResponse(value) || handleExtensionUI(value)) return;
  switch (value.type) {
    case 'agent_start': updateState({ activity: 'responding' }); break;
    case 'agent_settled': updateState({ activity: 'idle' }); break;
    case 'compaction_start': updateState({ activity: 'compacting' }); break;
    case 'auto_retry_start': updateState({ activity: 'retrying' }); break;
    case 'queue_update': {
      const queue = { steering: Array.isArray(value.steering) ? value.steering.filter((x): x is string => typeof x === 'string') : [], followUp: Array.isArray(value.followUp) ? value.followUp.filter((x): x is string => typeof x === 'string') : [] };
      updateState({ queue }); break;
    }
    case 'message_start': {
      const message = normalizeMessage(value.message, sequence++);
      if (!message) break;
      if (message.role === 'assistant') { activeMessageId = `stream-${Date.now()}-${sequence}`; message.id = activeMessageId; message.streaming = true; }
      if (message.role === 'user') { activeUserMessageId = message.id; }
      for (let index = 0; index < message.blocks.length; index++) {
        const block = message.blocks[index]; if (block.type === 'tool') { tools.set(block.tool.id, block.tool); toolLocations.set(block.tool.id, { messageId: message.id, blockIndex: index }); }
      }
      event({ type: 'chat-message-start', message }); break;
    }
    case 'message_update': {
      if (!activeMessageId || !isRecord(value.assistantMessageEvent)) break;
      const update = value.assistantMessageEvent;
      const index = update.contentIndex;
      if (!validBlockIndex(index)) { diagnostics.append('Invalid contentIndex ignored\n'); break; }
      if ((update.type === 'text_delta' || update.type === 'thinking_delta') && typeof update.delta === 'string') queueDelta(activeMessageId, index, update.type === 'text_delta' ? 'text' : 'thinking', update.delta);
      if (update.type === 'toolcall_start' && typeof update.id === 'string') {
        const tool: ToolActivity = tools.get(update.id) ?? { id: update.id, name: typeof update.toolName === 'string' ? update.toolName : 'tool', arguments: {}, status: 'pending', output: '' };
        tools.set(tool.id, tool); toolLocations.set(tool.id, { messageId: activeMessageId, blockIndex: index }); event({ type: 'chat-tool', messageId: activeMessageId, blockIndex: index, tool: { ...tool } });
      }
      if (update.type === 'toolcall_delta' && typeof update.delta === 'string') {
        const location = [...toolLocations.entries()].find(([, item]) => item.messageId === activeMessageId && item.blockIndex === index);
        if (location) { const tool = tools.get(location[0])!; const raw = ((tool.details as { argumentText?: string } | undefined)?.argumentText ?? '') + update.delta; try { tool.arguments = JSON.parse(raw); } catch { /* incomplete JSON */ } tool.details = { argumentText: raw }; event({ type: 'chat-tool', ...toolLocations.get(tool.id), tool: { ...tool } }); }
      }
      if (update.type === 'toolcall_end' && isRecord(update.toolCall) && typeof update.toolCall.id === 'string') {
        const tool = tools.get(update.toolCall.id) ?? { id: update.toolCall.id, name: 'tool', arguments: {}, status: 'pending', output: '' };
        tool.name = typeof update.toolCall.name === 'string' ? update.toolCall.name : tool.name; tool.arguments = isRecord(update.toolCall.arguments) ? update.toolCall.arguments : tool.arguments; tool.details = undefined;
        tools.set(tool.id, tool); toolLocations.set(tool.id, { messageId: activeMessageId, blockIndex: index }); event({ type: 'chat-tool', ...toolLocations.get(tool.id), tool: { ...tool } });
      }
      break;
    }
    case 'message_end': {
      flushDeltas();
      const raw = isRecord(value.message) ? value.message : undefined;
      if (raw?.role === 'toolResult' && typeof raw.toolCallId === 'string') {
        const tool = tools.get(raw.toolCallId);
        if (tool) { tool.status = raw.isError ? 'error' : 'success'; tool.output = contentText(raw.content); tool.details = raw.details; tool.images = contentImages(raw.content); event({ type: 'chat-tool', ...toolLocations.get(tool.id), tool: { ...tool } }); }
        break;
      }
      const message = normalizeMessage(value.message, sequence++);
      if (!message) break;
      if (message.role === 'assistant' && activeMessageId) { message.id = activeMessageId; message.streaming = false; activeMessageId = undefined; }
      if (message.role === 'user' && activeUserMessageId) { message.id = activeUserMessageId; activeUserMessageId = undefined; }
      const finalIds = new Set(message.blocks.flatMap(block => block.type === 'tool' ? [block.tool.id] : []));
      for (const [toolId, location] of toolLocations) if (location.messageId === message.id && !finalIds.has(toolId)) { retiredTools.add(toolId); tools.delete(toolId); toolLocations.delete(toolId); }
      for (const toolId of finalIds) finalTools.add(toolId);
      for (let index = 0; index < message.blocks.length; index++) { const block = message.blocks[index]; if (block.type === 'tool') { const current = tools.get(block.tool.id); if (current) block.tool = { ...current, name: block.tool.name, arguments: block.tool.arguments }; tools.set(block.tool.id, block.tool); toolLocations.set(block.tool.id, { messageId: message.id, blockIndex: index }); } }
      event({ type: 'chat-message-end', message }); break;
    }
    case 'tool_execution_start': {
      if (typeof value.toolCallId !== 'string' || retiredTools.has(value.toolCallId)) break; const tool = tools.get(value.toolCallId) ?? { id: value.toolCallId, name: typeof value.toolName === 'string' ? value.toolName : 'tool', arguments: {}, status: 'pending', output: '' };
      if (tool.status !== 'success' && tool.status !== 'error') tool.status = 'running'; if (!finalTools.has(tool.id) && isRecord(value.args)) tool.arguments = value.args; tools.set(tool.id, tool); event({ type: 'chat-tool', ...toolLocations.get(tool.id), tool: { ...tool } }); break;
    }
    case 'tool_execution_update': {
      if (typeof value.toolCallId !== 'string' || retiredTools.has(value.toolCallId)) break; const tool = tools.get(value.toolCallId) ?? { id: value.toolCallId, name: typeof value.toolName === 'string' ? value.toolName : 'tool', arguments: isRecord(value.args) ? value.args : {}, status: 'pending', output: '' }; const result = normalizeToolResult(value.partialResult); if (tool.status !== 'success' && tool.status !== 'error') { tool.status = 'running'; tool.output = result.output; tool.details = result.details; tool.images = result.images; } tools.set(tool.id, tool); event({ type: 'chat-tool', ...toolLocations.get(tool.id), tool: { ...tool } }); break;
    }
    case 'tool_execution_end': {
      if (typeof value.toolCallId !== 'string' || retiredTools.has(value.toolCallId)) break; const tool = tools.get(value.toolCallId) ?? { id: value.toolCallId, name: typeof value.toolName === 'string' ? value.toolName : 'tool', arguments: isRecord(value.args) ? value.args : {}, status: 'pending', output: '' }; const result = normalizeToolResult(value.result); tool.status = value.isError ? 'error' : 'success'; tool.output = result.output; tool.details = result.details; tool.images = result.images; tools.set(tool.id, tool); event({ type: 'chat-tool', ...toolLocations.get(tool.id), tool: { ...tool } }); break;
    }
    case 'extension_error': event({ type: 'chat-notice', level: 'error', message: `扩展错误：${typeof value.error === 'string' ? value.error : '未知错误'}` }); break;
    case 'compaction_end': if (value.errorMessage) event({ type: 'chat-notice', level: 'error', message: `上下文压缩失败：${value.errorMessage}` }); break;
    case 'auto_retry_end': if (value.success === false) event({ type: 'chat-notice', level: 'error', message: `自动重试失败：${typeof value.finalError === 'string' ? value.finalError : ''}` }); break;
    default: diagnostics.append(`Ignored Pi RPC event: ${String(value.type)}\n`); break;
  }
}

async function start(message: StartMessage): Promise<void> {
  if (child) return;
  sessionId = message.id;
  child = spawn(message.executable, [...message.args, '--mode', 'rpc'], { cwd: message.cwd, env: message.env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  writer = new RpcWriter(child.stdin);
  if (child.pid) post({ type: 'child-pid', pid: child.pid });
  child.stderr.on('data', chunk => stderr.append(chunk));
  const decoder = new JsonlDecoder(value => { if (isRecord(value)) handleEvent(value); });
  child.stdout.on('data', chunk => { try { decoder.push(chunk); } catch (error) { fail(error); void shutdown(1); } });
  child.stdout.on('end', () => { try { decoder.end(); } catch (error) { fail(error); } });
  child.on('error', fail);
  child.on('exit', code => {
    flushDeltas();
    const error = new Error(`Pi RPC process exited (${code ?? 0})`); for (const request of pending.values()) { if (request.timer) clearTimeout(request.timer); request.reject(error); } pending.clear();
    event({ type: 'exit', exitCode: code ?? 0 });
    if (!closing && code) fail(error);
    if (!closing) void shutdown(code ?? 0);
  });
  await new Promise<void>((resolve, reject) => { child!.once('spawn', resolve); child!.once('error', reject); });
  const [stateValue, messagesValue, commandsValue] = await Promise.all([send({ type: 'get_state' }, 15_000), send({ type: 'get_messages' }, 15_000), send({ type: 'get_commands' }, 15_000)]);
  if (!isRecord(stateValue) || !isRecord(messagesValue) || !Array.isArray(messagesValue.messages) || !isRecord(commandsValue) || !Array.isArray(commandsValue.commands)) throw new Error('Pi RPC capability handshake returned an incompatible snapshot');
  const state = stateValue;
  runtimeState = {
    ...runtimeState,
    activity: dialogs.waiting ? 'waiting-input' : observedActivity ? underlyingActivity : state.isCompacting ? 'compacting' : state.isStreaming ? 'responding' : 'idle',
    model: isRecord(state.model) && typeof state.model.provider === 'string' && typeof state.model.id === 'string' ? { provider: state.model.provider, id: state.model.id } : undefined,
    thinkingLevel: typeof state.thinkingLevel === 'string' ? state.thinkingLevel : undefined,
  };
  if (!dialogs.waiting) underlyingActivity = runtimeState.activity;
  const messages = normalizeHistory(messagesValue.messages);
  for (const message of messages) for (let index = 0; index < message.blocks.length; index++) { const block = message.blocks[index]; if (block.type === 'tool') { tools.set(block.tool.id, block.tool); toolLocations.set(block.tool.id, { messageId: message.id, blockIndex: index }); } }
  const commands: ChatCommand[] = commandsValue.commands.flatMap(item => isRecord(item) && typeof item.name === 'string' && (item.source === 'extension' || item.source === 'prompt' || item.source === 'skill') ? [{ name: item.name, description: typeof item.description === 'string' ? item.description : undefined, source: item.source }] : []);
  event({ type: 'chat-snapshot', snapshot: { ...runtimeState, messages, commands } });
  event({ type: 'session-info', processStatus: 'running', activity: runtimeState.activity });
}

port.on('message', ({ data }: { data: HostMessage }) => {
  if (!data || typeof data !== 'object') return;
  if (data.type === 'start') { void start(data).catch(error => { fail(`原生对话启动失败：${(error as Error).message}`); void shutdown(1); }); return; }
  if (data.type === 'close') { void shutdown(); return; }
  if (data.type === 'extension-response') { void sendExtensionResponse(data.response).then(() => post({ type: 'response', requestId: data.requestId, success: true })).catch(error => post({ type: 'response', requestId: data.requestId, success: false, error: String(error) })); return; }
  if (data.type === 'stop') {
    void send({ type: 'clear_queue' }).then(async queue => { const value = isRecord(queue) ? queue : {};
      event({ type: 'chat-queue-recovered', requestId: data.requestId, queue: { steering: Array.isArray(value.steering) ? value.steering.filter((x): x is string => typeof x === 'string') : [], followUp: Array.isArray(value.followUp) ? value.followUp.filter((x): x is string => typeof x === 'string') : [] } });
      await send({ type: 'abort' }); post({ type: 'response', requestId: data.requestId, success: true }); }).catch(error => post({ type: 'response', requestId: data.requestId, success: false, error: String(error) })); return;
  }
  if (data.type === 'command') void send(data.command).then(result => post({ type: 'response', requestId: data.requestId, success: true, data: result })).catch(error => post({ type: 'response', requestId: data.requestId, success: false, error: String(error) }));
});
